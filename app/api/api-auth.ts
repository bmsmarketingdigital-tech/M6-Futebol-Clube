import { getChatGPTUser } from "../chatgpt-auth";
import { getOrCreateOrganization } from "../../db";

export async function getApiContext(request: Request) {
  let user = await getChatGPTUser();

  if (!user) {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      user = {
        email: "administrador@baseforte.local",
        displayName: "Administrador local",
        fullName: "Administrador local",
      };
    }
  }

  if (!user) return null;

  const membership = await getOrCreateOrganization(user);
  if (!membership) return null;

  return { user, membership };
}
