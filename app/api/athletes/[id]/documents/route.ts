import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { getFilesBucket } from "../../../../../db/storage";
import { athleteDocuments, athletes } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const allowedKinds = new Set([
  "identity",
  "medical",
  "authorization",
  "other",
]);
const maxFileSize = 5 * 1024 * 1024;

async function authorizeAthlete(request: Request, athleteId: string) {
  const context = await getApiContext(request);
  if (!context) return null;

  const db = getDb();
  const [athlete] = await db
    .select({ id: athletes.id })
    .from(athletes)
    .where(
      and(
        eq(athletes.id, athleteId),
        eq(athletes.organizationId, context.membership.organizationId),
        eq(athletes.active, true),
      ),
    )
    .limit(1);

  return athlete ? context : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await authorizeAthlete(request, id);
    if (!context) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(athleteDocuments)
      .where(
        and(
          eq(athleteDocuments.athleteId, id),
          eq(
            athleteDocuments.organizationId,
            context.membership.organizationId,
          ),
        ),
      )
      .orderBy(desc(athleteDocuments.createdAt));

    return Response.json({
      documents: rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        downloadUrl: `/api/athletes/${id}/documents/${row.id}`,
      })),
    });
  } catch (error) {
    console.error("Failed to list athlete documents", error);
    return Response.json(
      { error: "Não foi possível carregar os documentos." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await authorizeAthlete(request, id);
    if (!context) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const requestedKind = String(formData.get("kind") || "other");
    const kind = allowedKinds.has(requestedKind) ? requestedKind : "other";

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { error: "Selecione um documento." },
        { status: 400 },
      );
    }
    if (file.size > maxFileSize) {
      return Response.json(
        { error: "O documento deve ter no máximo 5 MB." },
        { status: 400 },
      );
    }
    if (!allowedTypes.has(file.type)) {
      return Response.json(
        { error: "Envie um arquivo PDF, JPG ou PNG." },
        { status: 400 },
      );
    }

    const documentId = crypto.randomUUID();
    const extension =
      file.type === "application/pdf"
        ? "pdf"
        : file.type === "image/png"
          ? "png"
          : "jpg";
    const objectKey = `${context.membership.organizationId}/${id}/${documentId}.${extension}`;
    const bucket = getFilesBucket();

    await bucket.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    try {
      const db = getDb();
      const [created] = await db
        .insert(athleteDocuments)
        .values({
          id: documentId,
          organizationId: context.membership.organizationId,
          athleteId: id,
          objectKey,
          fileName: file.name.slice(0, 180),
          contentType: file.type,
          sizeBytes: file.size,
          kind: kind as "identity" | "medical" | "authorization" | "other",
          uploadedBy: context.user.email,
          createdAt: new Date(),
        })
        .returning();

      return Response.json(
        {
          document: {
            id: created.id,
            fileName: created.fileName,
            contentType: created.contentType,
            sizeBytes: created.sizeBytes,
            kind: created.kind,
            createdAt: created.createdAt.toISOString(),
            downloadUrl: `/api/athletes/${id}/documents/${created.id}`,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      await bucket.delete(objectKey);
      throw error;
    }
  } catch (error) {
    console.error("Failed to upload athlete document", error);
    return Response.json(
      { error: "Não foi possível enviar o documento agora." },
      { status: 500 },
    );
  }
}
