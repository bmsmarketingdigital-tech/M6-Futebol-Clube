import { createLocalSession, verifyLocalCredentials } from "../../local-auth";

export async function POST(request: Request) {
  try {
    const hostname = new URL(request.url).hostname;
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return Response.json({ error: "Login local indisponível." }, { status: 403 });
    }

    const body = (await request.json()) as {
      username?: string;
      password?: string;
      rememberMe?: boolean;
    };
    const user = await verifyLocalCredentials(body.username ?? "", body.password ?? "");
    if (!user) {
      return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
    }

    const session = await createLocalSession(user.id, Boolean(body.rememberMe));
    return Response.json(
      {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          fullName: user.displayName,
          role: user.role,
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
