import { getChatGPTUser } from "../chatgpt-auth";
import { getOrCreateOrganization } from "../../db";
import { getLocalSessionUser } from "./local-auth";

export async function getApiContext(request: Request) {
  let user = await getChatGPTUser();
  let role: "admin" | "operator" = "admin";

  if (!user) {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      user = await getLocalSessionUser(request);
      role = user?.role ?? "admin";
    }
  }

  if (!user) return null;
  if (role === "operator" && new URL(request.url).pathname.startsWith("/api/finance/")) {
    return null;
  }

  const membership = await getOrCreateOrganization(user);
  if (!membership) return null;

  return { user, membership, role };
}
