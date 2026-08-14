import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
import { athletes, teamAthletes, teams } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { isValidCategory } from "../categories/category-utils";
import {
  enqueueNotification,
  processNotificationQueue,
} from "../notifications/outbox";

export const dynamic = "force-dynamic";

type AthleteRow = typeof athletes.$inferSelect | {
  id: string;
  full_name: string;
  birth_year: number;
  birth_date: string | null;
  category: string;
  guardian_name: string;
  guardian_document: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  allergies: string | null;
  medications: string | null;
  medical_notes: string | null;
  image_authorized: number | boolean;
  attendance_rate: number;
  financial_status: string;
  created_at: number;
};

function readAthlete(row: AthleteRow) {
  if ("fullName" in row) return row;
  return {
    id: row.id,
    fullName: row.full_name,
    birthYear: row.birth_year,
    birthDate: row.birth_date,
    category: row.category,
    guardianName: row.guardian_name,
    guardianDocument: row.guardian_document,
    guardianPhone: row.guardian_phone,
    guardianEmail: row.guardian_email,
    emergencyName: row.emergency_name,
    emergencyPhone: row.emergency_phone,
    allergies: row.allergies,
    medications: row.medications,
    medicalNotes: row.medical_notes,
    imageAuthorized: Boolean(row.image_authorized),
    attendanceRate: row.attendance_rate,
    financialStatus: row.financial_status,
    createdAt: new Date(row.created_at * 1000),
  };
}

function toDto(row: AthleteRow) {
  const athlete = readAthlete(row);
  const age = athlete.birthDate
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(`${athlete.birthDate}T12:00:00`).getTime()) /
            31_557_600_000,
        ),
      )
    : Math.max(0, new Date().getFullYear() - athlete.birthYear);
  const initials = athlete.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return {
    id: athlete.id,
    name: athlete.fullName,
    initials,
    category: athlete.category,
    age,
    birthDate: athlete.birthDate,
    guardianName: athlete.guardianName,
    guardianDocument: athlete.guardianDocument,
    guardianPhone: athlete.guardianPhone,
    guardianEmail: athlete.guardianEmail,
    emergencyName: athlete.emergencyName,
    emergencyPhone: athlete.emergencyPhone,
    allergies: athlete.allergies,
    medications: athlete.medications,
    medicalNotes: athlete.medicalNotes,
    imageAuthorized: athlete.imageAuthorized,
    attendance: athlete.attendanceRate,
    status: athlete.financialStatus === "pending" ? "Pendente" : "Em dia",
    tone: "green",
    createdAt: athlete.createdAt.toISOString(),
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

    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const rows = await sql<AthleteRow[]>`
        SELECT id, full_name, birth_year, birth_date, category,
               guardian_name, guardian_document, guardian_phone, guardian_email,
               emergency_name, emergency_phone, allergies, medications,
               medical_notes, image_authorized, attendance_rate, financial_status,
               created_at
        FROM athletes
        WHERE organization_id = ${context.membership.organizationId}
          AND active = 1
        ORDER BY created_at DESC
        LIMIT 500
      `;

      return Response.json({ athletes: rows.map(toDto) });
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
    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const compatibleTeams = await sql<{
        id: string;
        name: string;
        category: string;
        capacity: number;
      }[]>`
        SELECT id, name, category, capacity
        FROM teams
        WHERE organization_id = ${organizationId}
          AND category = ${category}
          AND active = 1
      `;

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
          { error: "Selecione a turma em que o atleta serÃ¡ matriculado." },
          { status: 400 },
        );
      }

      const athleteId = crypto.randomUUID();
      const qrToken = crypto.randomUUID();
      const timestamp = Math.floor(now.getTime() / 1000);
      const created = await sql.begin(async (transaction) => {
        if (enrolledTeamId) {
          const selectedTeam = compatibleTeams.find((team) => team.id === enrolledTeamId)!;
          const [enrollmentSnapshot] = await transaction<{ value: number }[]>`
            SELECT COUNT(*)::int AS value
            FROM team_athletes
            WHERE team_id = ${enrolledTeamId}
              AND organization_id = ${organizationId}
              AND active = 1
          `;
          if ((enrollmentSnapshot?.value ?? 0) >= selectedTeam.capacity) {
            throw new Error("TEAM_CAPACITY_REACHED");
          }
        }

        const [inserted] = await transaction<AthleteRow[]>`
          INSERT INTO athletes (
            id, organization_id, full_name, birth_year, category,
            guardian_name, guardian_phone, attendance_rate, financial_status,
            qr_token, active, created_by, created_at, updated_at
          )
          VALUES (
            ${athleteId}, ${organizationId}, ${name}, ${now.getFullYear() - age}, ${category},
            ${guardianName}, ${guardianPhone}, 100, 'paid',
            ${qrToken}, 1, ${context.user.email}, ${timestamp}, ${timestamp}
          )
          RETURNING id, full_name, birth_year, birth_date, category,
                    guardian_name, guardian_document, guardian_phone, guardian_email,
                    emergency_name, emergency_phone, allergies, medications,
                    medical_notes, image_authorized, attendance_rate, financial_status,
                    created_at
        `;

        if (enrolledTeamId) {
          await transaction`
            INSERT INTO team_athletes (organization_id, team_id, athlete_id, active, enrolled_at)
            VALUES (${organizationId}, ${enrolledTeamId}, ${athleteId}, 1, ${timestamp})
          `;
        }

        return inserted;
      }).catch((error) => {
        if (error instanceof Error && error.message === "TEAM_CAPACITY_REACHED") {
          return null;
        }
        throw error;
      });

      if (!created) {
        return Response.json({ error: "A turma selecionada atingiu a capacidade." }, { status: 409 });
      }

      return Response.json(
        {
          athlete: toDto(created),
          enrolledTeamId: enrolledTeamId || null,
          enrollmentNotification: { created: false, processed: 0 },
        },
        { status: 201 },
      );
    }

    const db = getDb();
    const compatibleTeams = await db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, organizationId),
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
