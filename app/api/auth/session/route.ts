import { getChatGPTUser } from "../../../chatgpt-auth";
import { getLocalSessionUser, localAccountExists } from "../../local-auth";
import { postgresConfigured } from "../../../../db/postgres";

export async function GET(request: Request) {
  const hostedUser = await getChatGPTUser();
  if (hostedUser) {
    return Response.json({
      authenticated: true,
      user: {
        ...hostedUser,
        id: "hosted-admin",
        username: hostedUser.email.split("@")[0] || "administrador",
        role: "admin",
      },
      needsSetup: false,
    });
  }

  const hostname = new URL(request.url).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && !postgresConfigured()) {
    return Response.json({ authenticated: false, needsSetup: false }, { status: 401 });
  }

  const user = await getLocalSessionUser(request);
  return Response.json({
    authenticated: Boolean(user),
    user,
    needsSetup: !(await localAccountExists()),
  });
}
