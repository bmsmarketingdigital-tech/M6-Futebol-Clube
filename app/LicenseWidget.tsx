"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface LicenseStatus {
  installId: string;
  state: "unlicensed" | "blocked" | "grace" | "warning" | "active";
  expiresAt: number | null;
  graceDays: number;
  blocked: boolean;
  daysLeft: number;
  graceLeftDays?: number;
  message: string;
}

const POLL_INTERVAL_MS = 60_000;

export function LicenseWidget() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [token, setToken] = useState("");
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");
  const [copied, setCopied] = useState(false);
  const autoOpenedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/license/status");
      if (!response.ok) return;
      const data = (await response.json()) as LicenseStatus;
      setStatus(data);
    } catch {
      // falha pontual de rede; próxima checagem periódica tenta de novo
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca periódica de status externo (licença)
    void loadStatus();
    const interval = setInterval(() => void loadStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    if (status?.blocked && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setModalOpen(true);
    }
  }, [status]);

  const copyInstallId = useCallback(async () => {
    if (!status?.installId) return;
    try {
      await navigator.clipboard.writeText(status.installId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível; o ID já fica visível para cópia manual
    }
  }, [status]);

  const activate = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!token.trim()) return;
      setActivating(true);
      setActivateError("");
      try {
        const response = await fetch("/api/license/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          setActivateError(data.reason || "Código de ativação inválido.");
          return;
        }
        setStatus(data.status);
        setToken("");
        if (!data.status.blocked) {
          setModalOpen(false);
        }
      } catch {
        setActivateError("Não foi possível ativar. Verifique sua conexão.");
      } finally {
        setActivating(false);
      }
    },
    [token],
  );

  if (!status) return null;

  const badgeClass =
    status.state === "warning"
      ? "license-badge warn"
      : status.state === "active"
        ? "license-badge"
        : "license-badge danger";

  const badgeLabel =
    status.state === "unlicensed" || status.state === "blocked"
      ? "Licença bloqueada"
      : status.state === "grace"
        ? `Carência: ${status.graceLeftDays ?? 0}d`
        : `Licença: ${status.daysLeft}d`;

  const closable = !status.blocked;

  return (
    <>
      <button
        type="button"
        className={badgeClass}
        onClick={() => setModalOpen(true)}
        title={status.message}
      >
        <i /> <span className="license-badge-label">{badgeLabel}</span>
      </button>

      {modalOpen &&
        createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={() => closable && setModalOpen(false)}
          >
            <div
              className="modal license-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="license-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {closable && (
                <button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Fechar">
                  <X size={18} strokeWidth={1.75} />
                </button>
              )}
              <span className="eyebrow">LICENÇA DO SISTEMA</span>
              <h2 id="license-modal-title">
                {status.blocked ? "Sistema bloqueado" : "Gerenciar licença"}
              </h2>
              <p className="license-status-message">{status.message}</p>

              <label className="license-id-label">
                ID desta instalação
                <div className="license-id-box">
                  <code>{status.installId}</code>
                  <button type="button" onClick={() => void copyInstallId()}>
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </label>

              <form onSubmit={activate}>
                <label>
                  Código de ativação
 <textarea data-preserve-case="true"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Cole aqui o código recebido"
                    rows={4}
                    required
                  />
                </label>
                {activateError && <p className="license-error">{activateError}</p>}
                <button className="primary-button full" type="submit" disabled={activating}>
                  {activating ? "Ativando..." : "Ativar"}
                </button>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
