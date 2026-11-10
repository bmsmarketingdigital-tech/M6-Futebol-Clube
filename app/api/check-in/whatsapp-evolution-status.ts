import { verifyEvolutionPhone, type PhoneVerification } from "./evolution-provider";

export type EvolutionStatusResult = {
  configured: true;
  status: "disconnected" | "starting" | "connected" | "error";
  qrCodeDataUrl: "";
  pairingCode: null;
  connectedPhone: string;
  phoneVerification: PhoneVerification;
  phoneMismatch?: boolean;
  lastError: string;
  lastMessage: string;
  updatedAt: string;
};

export type EvolutionStatusDependencies = {
  getState: (organizationId: string) => Promise<"open" | "connecting" | "close" | "unknown">;
  getConnectedPhone: (organizationId: string) => Promise<string | null>;
  getStoredPhones: (organizationId: string) => Promise<{ expectedPhone: string | null }>;
  now?: () => string;
};

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") || "";
  return digits ? `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : "";
}

export function canSendEvolution(status: Pick<EvolutionStatusResult, "status" | "phoneVerification">) {
  return status.status === "connected" && status.phoneVerification === "confirmed";
}

export async function readEvolutionWhatsAppStatus(
  organizationId: string,
  dependencies: EvolutionStatusDependencies,
): Promise<EvolutionStatusResult> {
  const state = await dependencies.getState(organizationId);
  const updatedAt = (dependencies.now ?? (() => new Date().toISOString()))();
  if (state === "open") {
    const phones = await dependencies.getStoredPhones(organizationId);
    const connectedPhone = await dependencies.getConnectedPhone(organizationId);
    const phoneVerification = verifyEvolutionPhone(phones.expectedPhone, connectedPhone);
    return {
      configured: true,
      status: "connected",
      qrCodeDataUrl: "",
      pairingCode: null,
      connectedPhone: maskPhone(connectedPhone),
      phoneVerification,
      phoneMismatch: phoneVerification === "mismatch",
      lastError: "",
      lastMessage: phoneVerification === "confirmed"
        ? "WhatsApp conectado e telefone confirmado."
        : phoneVerification === "mismatch"
          ? "O telefone conectado diverge do esperado; envios bloqueados."
          : "WhatsApp conectado; telefone ainda não confirmado.",
      updatedAt,
    };
  }
  if (state === "connecting") {
    return { configured: true, status: "starting", qrCodeDataUrl: "", pairingCode: null, connectedPhone: "", phoneVerification: "unknown", lastError: "", lastMessage: "Aguardando conexão do WhatsApp.", updatedAt };
  }
  if (state === "close") {
    return { configured: true, status: "disconnected", qrCodeDataUrl: "", pairingCode: null, connectedPhone: "", phoneVerification: "unknown", lastError: "", lastMessage: "WhatsApp desconectado.", updatedAt };
  }
  return { configured: true, status: "error", qrCodeDataUrl: "", pairingCode: null, connectedPhone: "", phoneVerification: "unknown", lastError: "Não foi possível consultar a Evolution API.", lastMessage: "Status indisponível.", updatedAt };
}
