import { createLocalSession, listUserOrganizations, verifyLocalCredentials } from "../../local-auth";
import { postgresConfigured } from "../../../../db/postgres";

export async function POST(request: Request) {
  try {
    const hostname = new URL(request.url).hostname;
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && !postgresConfigured()) {
      return Response.json({ error: "Login local indisponível." }, { status: 403 });
    }

    const body = (await request.json()) as {
      username?: string;
      password?: string;
      rememberMe?: boolean;
      organizationId?: string;
    };
    const user = await verifyLocalCredentials(body.username ?? "", body.password ?? "");
    if (!user) {
      return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
    }

    const organizations = await listUserOrganizations(user.id);
    if (!organizations.length) return Response.json({ error: "Usuário sem organização autorizada." }, { status: 403 });
    if (!body.organizationId && organizations.length > 1) {
      return Response.json({ requiresOrganization: true, organizations, identity: { username: user.username } }, { status: 409 });
    }
    const organizationId = body.organizationId || organizations[0].id;
    const selected = organizations.find((item) => item.id === organizationId);
    if (!selected) return Response.json({ error: "Organização não autorizada." }, { status: 403 });
    const session = await createLocalSession(user.id, organizationId, Boolean(body.rememberMe));
    return Response.json(
      {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          fullName: user.displayName,
          role: selected.role,
          organizationId,
        },
      },
      { headers: { "Set-Cookie": session.cookie } },
    );
  } catch (error) {
    console.error("Failed to log in locally", error);
    return Response.json(
      { error: "Não foi possível acessar o banco local. Feche e reabra o sistema." },
      { status: 500 },
    );
  }
}
