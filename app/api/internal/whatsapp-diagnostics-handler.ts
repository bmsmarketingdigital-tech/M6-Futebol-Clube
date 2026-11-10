export type DiagnosticsContext = { membership: { organizationId: string } };

export type WhatsAppDiagnosticsDependencies<Env, Evolution> = {
  getContext: (request: Request) => Promise<DiagnosticsContext | null>;
  getEnv: () => Env;
  getEvolution: (organizationId: string, env: Env) => Evolution | null;
  evolutionIsConfigured: (organizationId: string, env: Env) => boolean;
  selectProvider: (organizationId: string, env: Env) => "local" | "evolution" | "none";
  bridgeIsConfigured: (organizationId: string, env: Env) => boolean;
  getRuntimePresence: (env: Env) => Record<string, boolean>;
  getInstanceName: (config: Evolution | null) => string | null;
};

export function createWhatsAppDiagnosticsGet<Env, Evolution>(dependencies: WhatsAppDiagnosticsDependencies<Env, Evolution>) {
  return async function GET(request: Request) {
    const context = await dependencies.getContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const organizationId = context.membership.organizationId;
    const env = dependencies.getEnv();
    const evolution = dependencies.getEvolution(organizationId, env);
    return Response.json({
      organizationId,
      runtime: dependencies.getRuntimePresence(env),
      evolution: {
        configuredForOrganization: dependencies.evolutionIsConfigured(organizationId, env),
        instanceName: dependencies.getInstanceName(evolution),
      },
      providerSelection: {
        selected: dependencies.selectProvider(organizationId, env),
        bridgeConfigured: dependencies.bridgeIsConfigured(organizationId, env),
      },
    });
  };
}
