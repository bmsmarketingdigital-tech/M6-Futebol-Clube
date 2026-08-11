import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { athletes, teamAthletes, teams } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { isValidCategory } from "../categories/category-utils";
import {
  enqueueNotification,
  processNotificationQueue,
} from "../notifications/outbox";

export const dynamic = "force-dynamic";

function toDto(row: typeof athletes.$inferSelect) {
  const age = row.birthDate
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(`${row.birthDate}T12:00:00`).getTime()) /
            31_557_600_000,
        ),
      )
    : Math.max(0, new Date().getFullYear() - row.birthYear);
  const initials = row.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return {
    id: row.id,
    name: row.fullName,
    initials,
    category: row.category,
    age,
    birthDate: row.birthDate,
    guardianName: row.guardianName,
    guardianDocument: row.guardianDocument,
    guardianPhone: row.guardianPhone,
    guardianEmail: row.guardianEmail,
    emergencyName: row.emergencyName,
    emergencyPhone: row.emergencyPhone,
    allergies: row.allergies,
    medications: row.medications,
    medicalNotes: row.medicalNotes,
    imageAuthorized: row.imageAuthorized,
    attendance: row.attendanceRate,
    status: row.financialStatus === "pending" ? "Pendente" : "Em dia",
    tone: "green",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para acessar os atletas." },
        { status: 401 },
      );
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, context.membership.organizationId),
          eq(athletes.active, true),
        ),
      )
      .orderBy(desc(athletes.createdAt))
      .limit(500);

    return Response.json({ athletes: rows.map(toDto) });
  } catch (error) {
    console.error("Failed to list athletes", error);
    return Response.json(
      { error: "Não foi possível carregar os atletas agora." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para cadastrar atletas." },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as {
      name?: string;
      age?: number;
      category?: string;
      guardianName?: string;
      guardianPhone?: string;
      teamId?: string;
    };

    const name = payload.name?.trim() ?? "";
    const age = Number(payload.age);
    const category = payload.category?.trim() ?? "";
    const guardianName = payload.guardianName?.trim() ?? "";
    const guardianPhone = payload.guardianPhone?.trim() ?? "";
    const requestedTeamId = payload.teamId?.trim() ?? "";

    if (name.length < 3 || name.length > 120) {
      return Response.json(
        { error: "Informe o nome completo do atleta." },
        { status: 400 },
      );
    }
    if (!Number.isInteger(age) || age < 4 || age > 18) {
      return Response.json(
        { error: "A idade deve estar entre 4 e 18 anos." },
        { status: 400 },
      );
    }
    if (
      !(await isValidCategory(
        context.membership.organizationId,
        category,
      ))
    ) {
      return Response.json(
        { error: "Selecione uma categoria válida." },
        { status: 400 },
      );
    }
    if (guardianName.length < 3 || guardianName.length > 120) {
      return Response.json(
        { error: "Informe o nome do responsável." },
        { status: 400 },
      );
    }
    if (!/^\d{10,11}$/.test(guardianPhone.replace(/\D/g, ""))) {
      return Response.json(
        { error: "Informe um telefone válido do responsável, com DDD." },
        { status: 400 },
      );
    }

    const now = new Date();
    const db = getDb();
    const compatibleTeams = await db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, context.membership.organizationId),
          eq(teams.category, category),
          eq(teams.active, true),
        ),
      );
    let enrolledTeamId = requestedTeamId;
    if (enrolledTeamId) {
      if (!compatibleTeams.some((team) => team.id === enrolledTeamId)) {
        return Response.json(
          { error: "Selecione uma turma ativa da mesma categoria do atleta." },
          { status: 400 },
        );
      }
    } else if (compatibleTeams.length === 1) {
      enrolledTeamId = compatibleTeams[0].id;
    } else if (compatibleTeams.length > 1) {
      return Response.json(
        { error: "Selecione a turma em que o atleta será matriculado." },
        { status: 400 },
      );
    }

    const organizationId = context.membership.organizationId;
    const athleteId = crypto.randomUUID();
    const qrToken = crypto.randomUUID();
    const timestamp = Math.floor(now.getTime() / 1000);
    const d1 = getD1();
    const athleteColumns = `(id, organization_id, full_name, birth_year, category,
      guardian_name, guardian_phone, attendance_rate, financial_status, qr_token,
      active, created_by, created_at, updated_at)`;
    const athleteBindings = [
      athleteId, organizationId, name, now.getFullYear() - age, category,
      guardianName, guardianPhone, qrToken, context.user.email, timestamp, timestamp,
    ];
    const statements = [];
    let marker: string | null = null;
    if (enrolledTeamId) {
      const selectedTeam = compatibleTeams.find((team) => team.id === enrolledTeamId)!;
      const currentEnrollments = await db
        .select({ athleteId: teamAthletes.athleteId })
        .from(teamAthletes)
        .where(
          and(
            eq(teamAthletes.teamId, enrolledTeamId),
            eq(teamAthletes.organizationId, organizationId),
            eq(teamAthletes.active, true),
          ),
        );
      if (currentEnrollments.length >= selectedTeam.capacity) {
        return Response.json({ error: "A turma selecionada atingiu a capacidade." }, { status: 409 });
      }
      marker = `__team_enroll__${crypto.randomUUID()}`;
      statements.push(
        d1.prepare(`UPDATE teams SET name = ? WHERE id = ? AND organization_id = ?
          AND active = 1 AND name = ? AND category = ? AND capacity = ?
          AND (SELECT COUNT(*) FROM team_athletes ta WHERE ta.team_id = ?
               AND ta.organization_id = ? AND ta.active = 1) = ?`).bind(
          marker, enrolledTeamId, organizationId, selectedTeam.name,
          selectedTeam.category, selectedTeam.capacity, enrolledTeamId,
          organizationId, currentEnrollments.length,
        ),
      );
      statements.push(
        d1.prepare(`INSERT INTO athletes ${athleteColumns}
          SELECT ?, ?, ?, ?, ?, ?, ?, 100, 'paid', ?, 1, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND name = ?)`)
          .bind(...athleteBindings, enrolledTeamId, organizationId, marker),
        d1.prepare(`INSERT INTO team_athletes
          (organization_id, team_id, athlete_id, active, enrolled_at)
          SELECT ?, ?, ?, 1, ? WHERE EXISTS
            (SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND name = ?)`)
          .bind(organizationId, enrolledTeamId, athleteId, timestamp, enrolledTeamId, organizationId, marker),
        d1.prepare("UPDATE teams SET name = ? WHERE id = ? AND organization_id = ? AND name = ?")
          .bind(selectedTeam.name, enrolledTeamId, organizationId, marker),
      );
    } else {
      statements.push(
        d1.prepare(`INSERT INTO athletes ${athleteColumns}
          VALUES (?, ?, ?, ?, ?, ?, ?, 100, 'paid', ?, 1, ?, ?, ?)`)
          .bind(...athleteBindings),
      );
    }
    const results = await d1.batch(statements);
    if (marker && (results[0].meta.changes ?? 0) !== 1) {
      return Response.json(
        { error: "A turma foi alterada por outra operação." },
        { status: 409 },
      );
    }
    const [created] = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.id, athleteId), eq(athletes.organizationId, organizationId)))
      .limit(1);
    if (!created) throw new Error("O atleta criado não pôde ser carregado.");

    let enrollmentNotification = { created: false, processed: 0 };
    try {
      const teamName = compatibleTeams.find((team) => team.id === enrolledTeamId)?.name;
      const queued = await enqueueNotification({
        organizationId: context.membership.organizationId,
        athleteId: created.id,
        teamId: enrolledTeamId || null,
        eventType: "enrollment",
        idempotencyKey:
          `enrollment:${context.membership.organizationId}:${created.id}:` +
          (enrolledTeamId || "unassigned"),
        phone: guardianPhone,
        message:
          `Olá, ${guardianName}! A inscrição de ${name}` +
          `${teamName ? ` na turma ${teamName}` : ""} foi confirmada.\n\n` +
          "M6 Futebol Clube",
      });
      const processed = await processNotificationQueue(
        context.membership.organizationId,
        "enrollment",
      );
      enrollmentNotification = {
        created: queued.created,
        processed: processed.processed,
      };
    } catch (notificationError) {
      console.error("Failed to enqueue enrollment notification", notificationError);
    }

    return Response.json(
      {
        athlete: toDto(created),
        enrolledTeamId: enrolledTeamId || null,
        enrollmentNotification,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create athlete", error);
    return Response.json(
      { error: "Não foi possível cadastrar o atleta agora." },
      { status: 500 },
    );
  }
}
