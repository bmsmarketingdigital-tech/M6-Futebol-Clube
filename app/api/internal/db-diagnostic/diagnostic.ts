export type DatabaseDiagnostic = {
  databaseConfigured: boolean;
  protocol: string | null;
  provider: string | null;
  hostMasked: string | null;
  port: string | null;
  databaseMasked: string | null;
  directUrlPresent: boolean;
  postgresUrlPresent: boolean;
};

function isDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function classifyHost(host: string): { provider: string; hostMasked: string } {
  const labels = host.toLowerCase().split(".");

  if (isDomain(host, "supabase.co")) {
    const prefix = labels[0] === "db" && labels.length > 3 ? "db.****" : "****";
    return { provider: "Supabase", hostMasked: `${prefix}.supabase.co` };
  }
  if (isDomain(host, "pooler.supabase.com")) {
    return { provider: "Supabase", hostMasked: `****.pooler.supabase.com` };
  }
  if (isDomain(host, "neon.tech")) {
    const prefix = labels[0]?.startsWith("ep-") ? "ep-****" : "****";
    return { provider: "Neon", hostMasked: `${prefix}.neon.tech` };
  }
  if (isDomain(host, "vercel-storage.com")) {
    return { provider: "Vercel Postgres", hostMasked: "****.vercel-storage.com" };
  }
  if (isDomain(host, "railway.app") || isDomain(host, "rlwy.net")) {
    return { provider: "Railway", hostMasked: "****.railway.app" };
  }

  return { provider: "Other PostgreSQL", hostMasked: "****" };
}

export function describeDatabaseUrl(
  raw: string | undefined,
  directUrlPresent: boolean,
  postgresUrlPresent: boolean,
): DatabaseDiagnostic {
  const base: DatabaseDiagnostic = {
    databaseConfigured: Boolean(raw),
    protocol: null,
    provider: null,
    hostMasked: null,
    port: null,
    databaseMasked: null,
    directUrlPresent,
    postgresUrlPresent,
  };

  if (!raw) return base;

  try {
    const url = new URL(raw);
    if (!url.hostname || !["postgres:", "postgresql:"].includes(url.protocol)) {
      return base;
    }
    const { provider, hostMasked } = classifyHost(url.hostname.toLowerCase());
    return {
      ...base,
      protocol: url.protocol.slice(0, -1),
      provider,
      hostMasked,
      port: url.port || null,
      databaseMasked: url.pathname && url.pathname !== "/" ? "****" : null,
    };
  } catch {
    return base;
  }
}
