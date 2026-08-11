import { getLicenseStatus } from "../../../../db/license";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getLicenseStatus();
    return Response.json(status);
  } catch (error) {
    console.error("Failed to read license status", error);
    return Response.json(
      { error: "Não foi possível verificar a licença." },
      { status: 500 },
    );
  }
}
