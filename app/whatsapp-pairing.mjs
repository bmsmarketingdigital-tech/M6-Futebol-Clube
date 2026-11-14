export const WHATSAPP_CONNECT_TIMEOUT_MS = 35_000;

export function createPairingRequestGate() {
  let generation = 0;
  let pendingToken = null;
  let failedGeneration = null;

  return {
    get generation() {
      return generation;
    },
    get pending() {
      return pendingToken !== null;
    },
    get failedGeneration() {
      return failedGeneration;
    },
    begin() {
      if (pendingToken !== null) return null;
      generation += 1;
      pendingToken = generation;
      failedGeneration = null;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    complete(token, { failed = false } = {}) {
      if (pendingToken !== token) return null;
      pendingToken = null;
      if (generation !== token) return { applied: false, generation, failedGeneration };
      generation += 1;
      failedGeneration = failed ? generation : null;
      return { applied: true, generation, failedGeneration };
    },
    invalidate({ failed = false } = {}) {
      generation += 1;
      failedGeneration = failed ? generation : null;
      return generation;
    },
  };
}

export function beginPairingGeneration(current) {
  return {
    ...current,
    status: "starting",
    pairingCode: null,
    qrCodeDataUrl: "",
    lastError: undefined,
  };
}

export function mergePairingPollingStatus(current, incoming, {
  requestGeneration,
  currentGeneration,
  pairingCodeGeneration,
  failedGeneration,
} = {}) {
  if (!incoming || requestGeneration !== currentGeneration) return null;

  if (incoming.status === "connected" || incoming.status === "open") {
    return { ...incoming, status: "connected", pairingCode: null, qrCodeDataUrl: "" };
  }

  if (incoming.status === "starting") {
    const currentGenerationCode = pairingCodeGeneration === currentGeneration
      && failedGeneration !== currentGeneration
      ? current?.pairingCode ?? null
      : null;
    return {
      ...incoming,
      status: currentGenerationCode ? "qr" : "starting",
      pairingCode: currentGenerationCode,
      qrCodeDataUrl: currentGenerationCode ? current?.qrCodeDataUrl ?? "" : "",
    };
  }

  if (incoming.status === "qr") {
    if (failedGeneration === currentGeneration) {
      return { ...incoming, pairingCode: null, qrCodeDataUrl: "" };
    }
    if (incoming.pairingCode) return incoming;
    const currentGenerationCode = pairingCodeGeneration === currentGeneration
      ? current?.pairingCode ?? null
      : null;
    return {
      ...incoming,
      pairingCode: currentGenerationCode,
      qrCodeDataUrl: currentGenerationCode ? current?.qrCodeDataUrl ?? "" : incoming.qrCodeDataUrl ?? "",
    };
  }

  return { ...incoming, pairingCode: null, qrCodeDataUrl: "" };
}

export function clearPairingCodeOnOpen(status) {
  return { ...status, status: "connected", pairingCode: null, qrCodeDataUrl: "" };
}

export function pairingFailureStatus(current, error) {
  return {
    ...current,
    status: "error",
    pairingCode: null,
    qrCodeDataUrl: "",
    lastError: error instanceof Error ? error.message : "Não foi possível gerar o código. Tente novamente.",
  };
}

export async function copyPairingCodeToClipboard(code, clipboard = globalThis.navigator?.clipboard) {
  if (typeof code !== "string" || !code || typeof clipboard?.writeText !== "function") {
    throw new Error("Não foi possível copiar o código neste aparelho.");
  }
  try {
    await clipboard.writeText(code);
  } catch {
    throw new Error("Não foi possível copiar o código neste aparelho.");
  }
}
