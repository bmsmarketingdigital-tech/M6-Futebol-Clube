import { getApiContext } from "../../api-auth";
import { controlWhatsAppBridge, getWhatsAppBridgeStatus } from "../whatsapp-bridge";
import { createWhatsAppConnectionHandlers } from "../whatsapp-connection-handler";

export const dynamic = "force-dynamic";

const handlers = createWhatsAppConnectionHandlers({
  getContext: getApiContext,
  getStatus: getWhatsAppBridgeStatus,
  control: controlWhatsAppBridge,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
