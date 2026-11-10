export const dynamic = "force-dynamic";

// The former endpoint silently sent to a hard-coded recipient. Keep the route
// closed until a controlled, authenticated destination is supplied explicitly.
export async function POST() {
  return Response.json(
    { error: "Envio de teste legado desativado. Nenhuma mensagem foi enviada." },
    { status: 410 },
  );
}
