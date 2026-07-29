import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { getFilesBucket } from "../../../../../../db/storage";
import { athleteDocuments } from "../../../../../../db/schema";
import { getApiContext } from "../../../../api-auth";

export const dynamic = "force-dynamic";

async function findAuthorizedDocument(
  request: Request,
  athleteId: string,
  documentId: string,
) {
  const context = await getApiContext(request);
  if (!context) return null;

  const db = getDb();
  const [document] = await db
    .select()
    .from(athleteDocuments)
    .where(
      and(
        eq(athleteDocuments.id, documentId),
        eq(athleteDocuments.athleteId, athleteId),
        eq(
          athleteDocuments.organizationId,
          context.membership.organizationId,
        ),
      ),
    )
    .limit(1);

  return document ? { context, document } : null;
}

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const { id, documentId } = await params;
    const authorized = await findAuthorizedDocument(request, id, documentId);
    if (!authorized) {
      return Response.json(
        { error: "Documento não encontrado." },
        { status: 404 },
      );
    }

    const object = await getFilesBucket().get(authorized.document.objectKey);
    if (!object) {
      return Response.json(
        { error: "Arquivo não encontrado." },
        { status: 404 },
      );
    }

    const safeName = authorized.document.fileName.replace(/["\r\n]/g, "_");
    return new Response(object.body, {
      headers: {
        "Content-Type": authorized.document.contentType,
        "Content-Length": String(authorized.document.sizeBytes),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Failed to download athlete document", error);
    return Response.json(
      { error: "Não foi possível baixar o documento." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const { id, documentId } = await params;
    const authorized = await findAuthorizedDocument(request, id, documentId);
    if (!authorized) {
      return Response.json(
        { error: "Documento não encontrado." },
        { status: 404 },
      );
    }

    await getFilesBucket().delete(authorized.document.objectKey);
    const db = getDb();
    await db
      .delete(athleteDocuments)
      .where(
        and(
          eq(athleteDocuments.id, documentId),
          eq(
            athleteDocuments.organizationId,
            authorized.context.membership.organizationId,
          ),
        ),
      );

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete athlete document", error);
    return Response.json(
      { error: "Não foi possível excluir o documento." },
      { status: 500 },
    );
  }
}
