import { and, eq, ne, notExists, sql } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  athletes,
  attendanceRecords,
  attendanceSessions,
  teamAthletes,
  teams,
} from "../../../../../../db/schema";
import { getApiContext } from "../../../../api-auth";
import { sendWhatsAppMessage } from "../../../../check-in/whatsapp-bridge";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function formatDateBR(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = (await request.json()) as {
      date?: string;
      canceled?: boolean;
      reason?: string;
    };
    const date = payload.date?.trim() ?? "";
    if (!validDate(date)) {
      return Response.json({ error: "Informe uma data válida." }, { status: 400 });
    }

    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para gerenciar a chamada." },
        { status: 401 },
      );
    }
    const organizationId = context.membership.organizationId;

    const db = getDb();
    const [team] = await db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.id, id),
          eq(teams.organizationId, organizationId),
          eq(teams.active, true),
        ),
      )
      .limit(1);
    if (!team) {
      return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.teamId, id),
          eq(attendanceSessions.sessionDate, date),
        ),
      )
      .limit(1);

    if (payload.canceled) {
      const reason = payload.reason?.trim().slice(0, 240) || "Chuva";
      const now = new Date();

      if (session) {
        // Atomic conditional UPDATE: only cancels if no attendance_records exist
        // for this session at the instant the statement runs. SQLite serializes
        // writers, so the NOT EXISTS subquery and the write happen as one step —
        // a concurrent POST /attendance can never sneak a record in between a
        // check and this write (that was the P1-ATT TOCTOU race).
        const [updated] = await db
          .update(attendanceSessions)
          .set({
            status: "canceled",
            canceledAt: now,
            canceledBy: context.user.email,
            cancelReason: reason,
          })
          .where(
            and(
              eq(attendanceSessions.id, session.id),
              eq(attendanceSessions.teamId, id),
              ne(attendanceSessions.status, "canceled"),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(attendanceRecords)
                  .where(eq(attendanceRecords.sessionId, attendanceSessions.id)),
              ),
            ),
          )
          .returning();

        if (!updated) {
          const [current] = await db
            .select({ status: attendanceSessions.status })
            .from(attendanceSessions)
            .where(eq(attendanceSessions.id, session.id))
            .limit(1);
          if (current?.status === "canceled") {
            // Already canceled (idempotent repeat call) — no-op, don't resend.
            return Response.json({ canceled: true, date, reason: session.cancelReason ?? reason, notified: 0 });
          }
          return Response.json(
            {
              error:
                "Já existe chamada registrada nesta data. Apague os registros antes de cancelar.",
            },
            { status: 409 },
          );
        }
      } else {
        try {
          await db.insert(attendanceSessions).values({
            id: crypto.randomUUID(),
            organizationId,
            teamId: id,
            sessionDate: date,
            recordedBy: context.user.email,
            status: "canceled",
            canceledAt: now,
            canceledBy: context.user.email,
            cancelReason: reason,
            createdAt: now,
          });
        } catch {
          // Unique (team_id, session_date) lost the race to a concurrent request
          // (either another cancel or the first attendance POST for the day).
          const [race] = await db
            .select({ status: attendanceSessions.status })
            .from(attendanceSessions)
            .where(
              and(
                eq(attendanceSessions.teamId, id),
                eq(attendanceSessions.sessionDate, date),
              ),
            )
            .limit(1);
          if (race?.status === "canceled") {
            return Response.json({ canceled: true, date, reason, notified: 0 });
          }
          return Response.json(
            {
              error:
                "Já existe chamada registrada nesta data. Apague os registros antes de cancelar.",
            },
            { status: 409 },
          );
        }
      }

      const roster = await db
        .select({ guardianPhone: athletes.guardianPhone })
        .from(teamAthletes)
        .innerJoin(athletes, eq(teamAthletes.athleteId, athletes.id))
        .where(
          and(
            eq(teamAthletes.teamId, id),
            eq(teamAthletes.organizationId, organizationId),
            eq(teamAthletes.active, true),
            eq(athletes.active, true),
          ),
        );

      const phones = new Set<string>();
      for (const athlete of roster) {
        if (athlete.guardianPhone) phones.add(athlete.guardianPhone);
      }

      const message = `Aviso: o treino da turma ${team.name} do dia ${formatDateBR(date)} foi cancelado. Motivo: ${reason}.`;
      let notified = 0;
      for (const phone of phones) {
        const delivery = await sendWhatsAppMessage(phone, message);
        if (delivery.status === "sent") notified += 1;
      }

      return Response.json({ canceled: true, date, reason, notified });
    }

    if (!session || session.status !== "canceled") {
      return Response.json(
        { error: "Esta data não está cancelada." },
        { status: 400 },
      );
    }

    await db
      .update(attendanceSessions)
      .set({
        status: "completed",
        canceledAt: null,
        canceledBy: null,
        cancelReason: null,
      })
      .where(eq(attendanceSessions.id, session.id));

    return Response.json({ canceled: false, date });
  } catch (error) {
    console.error("Failed to update attendance cancellation", error);
    return Response.json(
      { error: "Não foi possível atualizar o cancelamento." },
      { status: 500 },
    );
  }
}
