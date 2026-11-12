import { getApiContext } from "../../api-auth";
import { describeDatabaseUrl } from "./diagnostic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const context = await getApiContext(request);
  if (!context || context.role !== "admin") {
    return Response.json({ error: "Forbidden" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const diagnostic = describeDatabaseUrl(
    process.env.DATABASE_URL || process.env.POSTGRES_URL,
    Boolean(process.env.DIRECT_URL),
    Boolean(process.env.POSTGRES_URL),
  );
  return Response.json(diagnostic, {
    headers: { "Cache-Control": "no-store" },
  });
}
