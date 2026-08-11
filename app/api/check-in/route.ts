import { and, desc, eq, gte } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import {
  athleteCheckIns,
  athletes,
  attendanceRecords,
  attendanceSessions,
  teamAthletes,
  teams,
} from "../../../db/schema";
import { getApiContext } from "../api-auth";
import {
  sendWhatsAppMessage,
  getWhatsAppBridgeStatus,
} from "./whatsapp-bridge";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function extractToken(value: string) {
  const clean = value.trim();
  if (/^BF1:[0-9a-f-]{36}$/i.test(clean)) return clean.slice(4);
  if (/^[0-9a-f-]{36}$/i.test(clean)) return clean;
  return "";
}

function formatArrival(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para acessar as entradas." },
        { status: 401 },
      );
    }

    const rows = await getDb()
      .select({
        id: athleteCheckIns.id,
        athleteId: athleteCheckIns.athleteId,
        athleteName: athletes.fullName,
        category: athletes.category,
        teamId: athleteCheckIns.teamId,
        teamName: teams.name,
        scannedAt: athleteCheckIns.scannedAt,
        guardianPhone: athleteCheckIns.guardianPhone,
        notificationStatus: athleteCheckIns.notificationStatus,
        notificationError: athleteCheckIns.notificationError,
      })
      .from(athleteCheckIns)
      .innerJoin(
        athletes,
        and(
          eq(athleteCheckIns.athleteId, athletes.id),
          eq(athletes.organizationId, athleteCheckIns.organizationId),
        ),
      )
      .innerJoin(
        teams,
        and(
          eq(athleteCheckIns.teamId, teams.id),
          eq(teams.organizationId, athleteCheckIns.organizationId),
        ),
      )
      .where(
        eq(
          athleteCheckIns.organizationId,
          context.membership.organizationId,
        ),
      )
      .orderBy(desc(athleteCheckIns.scannedAt))
      .limit(100);

    return Response.json({
      checkIns: rows.map((row) => ({
        ...row,
        scannedAt: row.scannedAt.toISOString(),
      })),
      whatsapp: await getWhatsAppBridgeStatus(),
    });
  } catch (error) {
    console.error("Failed to list check-ins", error);
    return Response.json(
      { error: "Não foi possível carregar o histórico de entradas." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para registrar entradas." },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as {
      code?: string;
      teamId?: string;
      date?: string;
    };
    const token = extractToken(payload.code ?? "");
    const teamId = payload.teamId?.trim() ?? "";
    const date = payload.date?.trim() ?? "";
    if (!token) {
      return Response.json(
        { error: "Este QR Code não pertence à Escola de Futebol M6 Futebol Clube." },
        { status: 400 },
      );
    }
    if (!teamId || !validDate(date)) {
      return Response.json(
        { error: "Selecione a turma e informe uma data válida." },
        { status: 400 },
      );
    }

    const db = getDb();
    const organizationId = context.membership.organizationId;
    const [athlete] = await db
      .select({
        id: athletes.id,
        name: athletes.fullName,
        category: athletes.category,
        guardianName: athletes.guardianName,
        guardianPhone: athletes.guardianPhone,
      })
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, organizationId),
          eq(athletes.qrToken, token),
          eq(athletes.active, true),
        ),
      )
      .limit(1);
    if (!athlete) {
      return Response.json(
        { error: "Atleta não encontrado ou QR Code desativado." },
        { status: 404 },
      );
    }

    const [enrollment] = await db
      .select({ teamName: teams.name })
      .from(teamAthletes)
      .innerJoin(
        teams,
        and(
          eq(teamAthletes.teamId, teams.id),
          eq(teams.organizationId, teamAthletes.organizationId),
        ),
      )
      .where(
        and(
          eq(teamAthletes.organizationId, organizationId),
          eq(teamAthletes.teamId, teamId),
          eq(teamAthletes.athleteId, athlete.id),
          eq(teamAthletes.active, true),
          eq(teams.active, true),
        ),
      )
      .limit(1);
    if (!enrollment) {
      return Response.json(
        { error: `${athlete.name} não está matriculado nesta turma.` },
        { status: 409 },
      );
    }

    const duplicateThreshold = new Date(Date.now() - 2 * 60 * 1000);
    const [duplicate] = await db
      .select({ id: athleteCheckIns.id, scannedAt: athleteCheckIns.scannedAt })
      .from(athleteCheckIns)
      .where(
        and(
          eq(athleteCheckIns.organizationId, organizationId),
          eq(athleteCheckIns.athleteId, athlete.id),
          eq(athleteCheckIns.teamId, teamId),
          gte(athleteCheckIns.scannedAt, duplicateThreshold),
        ),
      )
      .orderBy(desc(athleteCheckIns.scannedAt))
      .limit(1);
    if (duplicate) {
      return Response.json({
        duplicate: true,
        athlete: {
          id: athlete.id,
          name: athlete.name,
          category: athlete.category,
        },
        teamName: enrollment.teamName,
        scannedAt: duplicate.scannedAt.toISOString(),
        message: "Entrada já registrada nos últimos dois minutos.",
      });
    }

    let [session] = await db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.teamId, teamId),
          eq(attendanceSessions.organizationId, organizationId),
          eq(attendanceSessions.sessionDate, date),
        ),
      )
      .limit(1);
    if (session && session.status === "canceled") {
      return Response.json(
        {
          error: `O treino da turma ${enrollment.teamName} nesta data foi cancelado.`,
        },
        { status: 409 },
      );
    }
    if (!session) {
      [session] = await db
        .insert(attendanceSessions)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          teamId,
          sessionDate: date,
          recordedBy: context.user.email,
          createdAt: new Date(),
        })
        .returning();
    }

    await db
      .insert(attendanceRecords)
      .values({
        sessionId: session.id,
        athleteId: athlete.id,
        present: true,
        note: "Entrada registrada por QR Code.",
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.sessionId, attendanceRecords.athleteId],
        set: {
          present: true,
          note: "Entrada registrada por QR Code.",
        },
      });

    const scannedAt = new Date();
    const message =
      `Olá, ${athlete.guardianName}! A entrada de ${athlete.name} ` +
      `na Escola de Futebol M6 Futebol Clube foi registrada em ${formatArrival(scannedAt)} ` +
      `para a turma ${enrollment.teamName}.`;
    const initialStatus = athlete.guardianPhone ? "pending" : "skipped";
    let checkIn;
    try {
      [checkIn] = await db
        .insert(athleteCheckIns)
        .values({
        id: crypto.randomUUID(),
        organizationId,
        athleteId: athlete.id,
        teamId,
        attendanceSessionId: session.id,
        scannedAt,
        scannedBy: context.user.email,
        guardianPhone: athlete.guardianPhone,
        notificationMessage: message,
        notificationStatus: initialStatus,
        notificationError: athlete.guardianPhone
          ? null
          : "Responsável sem telefone cadastrado.",
        })
        .returning();
    } catch (error) {
      if (error instanceof Error && /unique constraint failed.*athlete_check_ins/i.test(error.message)) {
        const [existing] = await db
          .select({ id: athleteCheckIns.id, scannedAt: athleteCheckIns.scannedAt })
          .from(athleteCheckIns)
          .where(and(
            eq(athleteCheckIns.organizationId, organizationId),
            eq(athleteCheckIns.athleteId, athlete.id),
            eq(athleteCheckIns.teamId, teamId),
            eq(athleteCheckIns.attendanceSessionId, session.id),
          ))
          .limit(1);
        if (existing) {
          return Response.json({
            duplicate: true,
            athlete: { id: athlete.id, name: athlete.name, category: athlete.category },
            teamName: enrollment.teamName,
            scannedAt: existing.scannedAt.toISOString(),
            message: "Entrada jÃ¡ registrada nesta sessÃ£o.",
          });
        }
      }
      throw error;
    }

    let notificationStatus = initialStatus;
    let notificationError = checkIn.notificationError;
    if (athlete.guardianPhone) {
      const delivery = await sendWhatsAppMessage(
        athlete.guardianPhone,
        message,
      );
      const persistedStatus =
        delivery.status === "delivery_unknown" ? "failed" : delivery.status;
      notificationStatus = persistedStatus;
      notificationError = delivery.error;
      await db
        .update(athleteCheckIns)
        .set({
          notificationStatus: persistedStatus,
          notificationError: delivery.error,
          notifiedAt: delivery.status === "sent" ? new Date() : null,
        })
        .where(eq(athleteCheckIns.id, checkIn.id));
    }

    const d1 = getD1();
    await d1
      .prepare(`UPDATE athletes
        SET attendance_rate = COALESCE((
          SELECT ROUND(100.0 * SUM(CASE WHEN present = 1 THEN 1 ELSE 0 END) / COUNT(*))
          FROM attendance_records
          WHERE athlete_id = ?
        ), attendance_rate),
        updated_at = ?
        WHERE id = ? AND organization_id = ?`)
      .bind(
        athlete.id,
        Math.floor(Date.now() / 1000),
        athlete.id,
        organizationId,
      )
      .run();

    return Response.json(
      {
        duplicate: false,
        athlete: {
          id: athlete.id,
          name: athlete.name,
          category: athlete.category,
        },
        teamName: enrollment.teamName,
        scannedAt: scannedAt.toISOString(),
        notification: {
          status: notificationStatus,
          error: notificationError,
          phone: athlete.guardianPhone,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to register QR check-in", error);
    return Response.json(
      { error: "Não foi possível registrar a entrada agora." },
      { status: 500 },
    );
  }
}
