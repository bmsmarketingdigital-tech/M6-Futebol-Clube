import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
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
      .select({ birthYear: athletes.birthYear })
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

    const [updated] = await db
      .update(athletes)
      .set({
        fullName: name,
        category,
        birthYear,
        birthDate,
        guardianName,
        guardianDocument: guardianDocument || null,
        guardianPhone,
        guardianEmail: payload.guardianEmail?.trim().toLowerCase() || null,
        emergencyName: payload.emergencyName?.trim() || null,
        emergencyPhone: payload.emergencyPhone?.trim() || null,
        allergies: payload.allergies?.trim() || null,
        medications: payload.medications?.trim() || null,
        medicalNotes: payload.medicalNotes?.trim() || null,
        imageAuthorized: Boolean(payload.imageAuthorized),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(athletes.id, id),
          eq(athletes.organizationId, context.membership.organizationId),
          eq(athletes.active, true),
        ),
      )
      .returning();

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
