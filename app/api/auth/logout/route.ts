import { destroyLocalSession } from "../../local-auth";

export async function POST(request: Request) {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": await destroyLocalSession(request) } },
  );
}
