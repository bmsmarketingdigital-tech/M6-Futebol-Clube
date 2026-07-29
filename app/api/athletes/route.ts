import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb, getOrCreateOrganization } from "../../../db";
import { athletes } from "../../../db/schema";

export const dynamic = "force-dynamic";

const categories = new Set([
  "Sub-7",
  "Sub-9",
  "Sub-11",
  "Sub-13",
  "Sub-15",
  "Sub-17",
]);

async function getRequestUser(request: Request) {
  const user = await getChatGPTUser();
  if (user) return user;

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return {
      email: "administrador@baseforte.local",
      displayName: "Administrador local",
      fullName: "Administrador local",
    };
  }

  return null;
}

function toDto(row: typeof athletes.$inferSelect) {
  const age = Math.max(0, new Date().getFullYear() - row.birthYear);
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
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    attendance: row.attendanceRate,
    status: row.financialStatus === "pending" ? "Pendente" : "Em dia",
    tone: "green",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json(
        { error: "Faça login para acessar os atletas." },
        { status: 401 },
      );
    }

    const membership = await getOrCreateOrganization(user);
    if (!membership) {
      return Response.json(
        { error: "Não foi possível localizar a sua escolinha." },
        { status: 500 },
      );
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, membership.organizationId),
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
    const user = await getRequestUser(request);
    if (!user) {
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
    };

    const name = payload.name?.trim() ?? "";
    const age = Number(payload.age);
    const category = payload.category?.trim() ?? "";
    const guardianName = payload.guardianName?.trim() ?? "";
    const guardianPhone = payload.guardianPhone?.trim() || null;

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
    if (!categories.has(category)) {
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

    const membership = await getOrCreateOrganization(user);
    if (!membership) {
      return Response.json(
        { error: "Não foi possível localizar a sua escolinha." },
        { status: 500 },
      );
    }

    const now = new Date();
    const db = getDb();
    const [created] = await db
      .insert(athletes)
      .values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        fullName: name,
        birthYear: now.getFullYear() - age,
        category,
        guardianName,
        guardianPhone,
        attendanceRate: 100,
        financialStatus: "paid",
        active: true,
        createdBy: user.email,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return Response.json({ athlete: toDto(created) }, { status: 201 });
  } catch (error) {
    console.error("Failed to create athlete", error);
    return Response.json(
      { error: "Não foi possível cadastrar o atleta agora." },
      { status: 500 },
    );
  }
}
