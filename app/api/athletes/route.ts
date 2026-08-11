import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
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
      .select({ id: teams.id, name: teams.name })
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

    const [created] = await db
      .insert(athletes)
      .values({
        id: crypto.randomUUID(),
        organizationId: context.membership.organizationId,
        fullName: name,
        birthYear: now.getFullYear() - age,
        category,
        guardianName,
        guardianPhone,
        attendanceRate: 100,
        financialStatus: "paid",
        qrToken: crypto.randomUUID(),
        active: true,
        createdBy: context.user.email,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (enrolledTeamId) {
      await db.insert(teamAthletes).values({
        organizationId: context.membership.organizationId,
        teamId: enrolledTeamId,
        athleteId: created.id,
        active: true,
        enrolledAt: now,
      });
    }

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
