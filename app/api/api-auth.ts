import { getChatGPTUser } from "../chatgpt-auth";
import { getLocalSessionUser } from "./local-auth";
import { postgresConfigured } from "../../db/postgres";

export async function getApiContext(request: Request) {
  let user = await getChatGPTUser();
  let role: "admin" | "operator" = "admin";
  let localOrganizationId = "";

  if (!user) {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || postgresConfigured()) {
      user = await getLocalSessionUser(request);
      role = user?.role ?? "admin";
      localOrganizationId = user?.organizationId ?? "";
    }
  }

  if (!user) return null;
  if (role === "operator" && new URL(request.url).pathname.startsWith("/api/finance/")) {
    return null;
  }

  const membership = localOrganizationId
    ? { organizationId: localOrganizationId, role: role === "admin" ? "admin" : "coach" }
    : await (async () => {
        const database = await import("../../db");
        return database.getOrCreateOrganization(user);
      })();
  if (!membership) return null;

  return { user, membership, role };
}
