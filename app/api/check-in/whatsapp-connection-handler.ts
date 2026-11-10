export type WhatsAppConnectionContext = { membership: { organizationId: string } };

export type WhatsAppConnectionDependencies<Status = unknown> = {
  getContext: (request: Request) => Promise<WhatsAppConnectionContext | null>;
  getStatus: (organizationId: string) => Promise<Status>;
  control: (organizationId: string, action: "connect" | "disconnect", phone?: string) => Promise<Status>;
};

export function createWhatsAppConnectionHandlers<Status>(dependencies: WhatsAppConnectionDependencies<Status>) {
  return {
    async GET(request: Request) {
      const context = await dependencies.getContext(request);
      if (!context) return Response.json({ error: "Faça login para configurar o WhatsApp." }, { status: 401 });
      return Response.json({ whatsapp: await dependencies.getStatus(context.membership.organizationId) });
    },
    async POST(request: Request) {
      const context = await dependencies.getContext(request);
      if (!context) return Response.json({ error: "Faça login para configurar o WhatsApp." }, { status: 401 });
      try {
        const payload = await request.json() as { action?: string; phone?: string };
        if (payload.action !== "connect" && payload.action !== "disconnect") {
          return Response.json({ error: "Ação inválida." }, { status: 400 });
        }
        const whatsapp = await dependencies.control(context.membership.organizationId, payload.action, payload.phone);
        return Response.json({ whatsapp });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Não foi possível controlar o WhatsApp desta organização." }, { status: 500 });
      }
    },
  };
}
