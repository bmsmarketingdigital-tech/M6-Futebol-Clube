import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { athletes } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { isValidCategory } from "../../categories/category-utils";
import { isValidCpfCnpj, onlyDigits } from "../document-utils";

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

  return {
    id: row.id,
    name: row.fullName,
    initials: row.fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase(),
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const payload = (await request.json()) as {
      name?: string;
      category?: string;
      birthDate?: string | null;
      guardianName?: string;
      guardianDocument?: string | null;
      guardianPhone?: string | null;
      guardianEmail?: string | null;
      emergencyName?: string | null;
      emergencyPhone?: string | null;
      allergies?: string | null;
      medications?: string | null;
      medicalNotes?: string | null;
      imageAuthorized?: boolean;
    };

    const name = payload.name?.trim() ?? "";
    const category = payload.category?.trim() ?? "";
    const guardianName = payload.guardianName?.trim() ?? "";
    const guardianPhone = payload.guardianPhone?.trim() ?? "";
    const birthDate = payload.birthDate?.trim() || null;
    const guardianDocument = onlyDigits(payload.guardianDocument);

    if (name.length < 3 || name.length > 120) {
      return Response.json(
        { error: "Informe o nome completo do atleta." },
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
    if (guardianDocument && !isValidCpfCnpj(guardianDocument)) {
      return Response.json(
        { error: "Informe um CPF ou CNPJ válido para o responsável." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existingAthlete] = await db
      .select({ birthYear: athletes.birthYear, category: athletes.category })
      .from(athletes)
      .where(
        and(
          eq(athletes.id, id),
          eq(athletes.organizationId, context.membership.organizationId),
          eq(athletes.active, true),
        ),
      )
      .limit(1);

    if (!existingAthlete) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }
    const categoryChanged = existingAthlete.category !== category;

    let birthYear = existingAthlete.birthYear;
    if (birthDate) {
      const parsed = new Date(`${birthDate}T12:00:00`);
      const age = Math.floor(
        (Date.now() - parsed.getTime()) / 31_557_600_000,
      );
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
        Number.isNaN(parsed.getTime()) ||
        age < 4 ||
        age > 18
      ) {
        return Response.json(
          { error: "A data de nascimento deve corresponder à idade de 4 a 18 anos." },
          { status: 400 },
        );
      }
      birthYear = parsed.getFullYear();
    }

    const organizationId = context.membership.organizationId;
    const d1 = getD1();
    const now = Math.floor(Date.now() / 1000);
    const statements = [
      d1
        .prepare(
          `UPDATE athletes SET
             full_name = ?, category = ?, birth_year = ?, birth_date = ?,
             guardian_name = ?, guardian_document = ?, guardian_phone = ?,
             guardian_email = ?, emergency_name = ?, emergency_phone = ?,
             allergies = ?, medications = ?, medical_notes = ?,
             image_authorized = ?, updated_at = ?
           WHERE id = ? AND organization_id = ? AND active = 1`,
        )
        .bind(
          name, category, birthYear, birthDate,
          guardianName, guardianDocument || null, guardianPhone,
          payload.guardianEmail?.trim().toLowerCase() || null,
          payload.emergencyName?.trim() || null,
          payload.emergencyPhone?.trim() || null,
          payload.allergies?.trim() || null,
          payload.medications?.trim() || null,
          payload.medicalNotes?.trim() || null,
          Boolean(payload.imageAuthorized) ? 1 : 0,
          now, id, organizationId,
        ),
    ];
    // Mudança de categoria: turmas antigas incompatíveis não podem seguir
    // com o vínculo ativo — a vaga é liberada, mas o histórico é preservado
    // (soft-deactivate; nenhuma linha de team_athletes é apagada).
    if (categoryChanged) {
      statements.push(
        d1
          .prepare(
            `UPDATE team_athletes SET active = 0
             WHERE athlete_id = ? AND organization_id = ? AND active = 1
               AND EXISTS (
                 SELECT 1 FROM teams t
                 WHERE t.id = team_athletes.team_id AND t.category != ?
               )`,
          )
          .bind(id, organizationId, category),
      );
    }
    const results = await d1.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }

    const [updated] = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.id, id), eq(athletes.organizationId, organizationId)))
      .limit(1);
    if (!updated) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }

    return Response.json({ athlete: toDto(updated) });
  } catch (error) {
    console.error("Failed to update athlete", error);
    return Response.json(
      { error: "Não foi possível atualizar o atleta agora." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const db = getDb();
    const [archived] = await db
      .update(athletes)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(athletes.id, id),
          eq(athletes.organizationId, context.membership.organizationId),
          eq(athletes.active, true),
        ),
      )
      .returning({ id: athletes.id });

    if (!archived) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }

    return Response.json({ archived: true, id: archived.id });
  } catch (error) {
    console.error("Failed to archive athlete", error);
    return Response.json(
      { error: "Não foi possível arquivar o atleta agora." },
      { status: 500 },
    );
  }
}
