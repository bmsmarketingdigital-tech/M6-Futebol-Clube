"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Html5Qrcode } from "html5-qrcode";
import type { TeamRecord } from "./TeamManagement";

type QrCard = {
  id: string;
  name: string;
  category: string;
  value: string;
  image?: string;
};

type CheckIn = {
  id: string;
  athleteId: string;
  athleteName: string;
  category: string;
  teamId: string;
  teamName: string;
  scannedAt: string;
  guardianPhone: string | null;
  notificationStatus: "pending" | "sent" | "failed" | "skipped";
  notificationError: string | null;
};

type ScanResult = {
  duplicate?: boolean;
  athlete?: { id: string; name: string; category: string };
  teamName?: string;
  scannedAt?: string;
  message?: string;
  notification?: {
    status: CheckIn["notificationStatus"];
    error: string | null;
    phone: string | null;
  };
  error?: string;
};

type Tab = "scanner" | "cards" | "history";

function localDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function localDateFromIso(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

const notificationLabels = {
  pending: "Na fila do WhatsApp",
  sent: "WhatsApp enviado",
  failed: "Falha no WhatsApp",
  skipped: "Sem telefone",
};

export function CheckInManagement({
  teams,
  notify,
  onAttendanceChanged,
}: {
  teams: TeamRecord[];
  notify: (message: string) => void;
  onAttendanceChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("scanner");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [date, setDate] = useState(localDate);
  const [history, setHistory] = useState<CheckIn[]>([]);
  const [cards, setCards] = useState<QrCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [whatsappConfigured, setWhatsappConfigured] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/check-in");
      const payload = (await response.json()) as {
        checkIns?: CheckIn[];
        whatsapp?: { configured?: boolean };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Falha ao carregar entradas.");
      }
      setHistory(payload.checkIns ?? []);
      setWhatsappConfigured(Boolean(payload.whatsapp?.configured));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as entradas.",
      );
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadHistory]);

  useEffect(() => {
    if (teamId || !teams[0]) return;
    const timeout = window.setTimeout(() => setTeamId(teams[0].id), 0);
    return () => window.clearTimeout(timeout);
  }, [teamId, teams]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    processingRef.current = false;
    setScanning(false);
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      await scanner.clear();
    } catch {
      // A câmera pode já ter sido encerrada pelo navegador.
    }
  }, []);

  useEffect(
    () => () => {
      void stopScanner();
    },
    [stopScanner],
  );

  const registerCode = useCallback(
    async (code: string) => {
      if (processingRef.current) return;
      if (!teamId) {
        notify("Selecione uma turma antes de ler o QR Code.");
        return;
      }
      processingRef.current = true;
      setRegistering(true);
      try {
        const response = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, teamId, date }),
        });
        const payload = (await response.json()) as ScanResult;
        if (!response.ok) {
          throw new Error(payload.error || "Não foi possível registrar a entrada.");
        }
        setLastResult(payload);
        notify(
          payload.duplicate
            ? payload.message || "Entrada já registrada."
            : `${payload.athlete?.name} teve a entrada registrada.`,
        );
        await stopScanner();
        await loadHistory();
        onAttendanceChanged();
      } catch (error) {
        processingRef.current = false;
        notify(
          error instanceof Error
            ? error.message
            : "Não foi possível registrar a entrada.",
        );
      } finally {
        setRegistering(false);
      }
    },
    [date, loadHistory, notify, onAttendanceChanged, stopScanner, teamId],
  );

  async function startScanner() {
    if (!teamId) {
      notify("Selecione a turma antes de ligar a câmera.");
      return;
    }
    setLastResult(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("baseforte-qr-reader");
      scannerRef.current = scanner;
      processingRef.current = false;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => {
            const size = Math.min(width, height, 260);
            return { width: size, height: size };
          },
        },
        (decodedText) => void registerCode(decodedText),
        () => undefined,
      );
      setScanning(true);
    } catch (error) {
      await stopScanner();
      notify(
        error instanceof Error
          ? `Não foi possível abrir a câmera: ${error.message}`
          : "Não foi possível abrir a câmera.",
      );
    }
  }

  async function loadCards() {
    setTab("cards");
    if (cards.length > 0) return;
    setLoadingCards(true);
    try {
      const [response, qrCode] = await Promise.all([
        fetch("/api/check-in/cards"),
        import("qrcode"),
      ]);
      const payload = (await response.json()) as {
        cards?: QrCard[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Falha ao gerar os cartões.");
      }
      const generated = await Promise.all(
        (payload.cards ?? []).map(async (card) => ({
          ...card,
          image: await qrCode.toDataURL(card.value, {
            width: 320,
            margin: 1,
            color: { dark: "#16392d", light: "#ffffff" },
            errorCorrectionLevel: "M",
          }),
        })),
      );
      setCards(generated);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar os QR Codes.",
      );
    } finally {
      setLoadingCards(false);
    }
  }

  async function retryNotifications() {
    setRetrying(true);
    try {
      const response = await fetch("/api/check-in/notifications", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        sent?: number;
        failed?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Falha ao processar a fila.");
      }
      notify(
        payload.sent
          ? `${payload.sent} notificação(ões) enviada(s) pelo WhatsApp.`
          : "A fila foi processada, mas nenhuma mensagem foi enviada.",
      );
      await loadHistory();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Falha ao processar a fila.",
      );
    } finally {
      setRetrying(false);
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await registerCode(String(form.get("code") || ""));
    event.currentTarget.reset();
  }

  const todayCount = history.filter(
    (item) => localDateFromIso(item.scannedAt) === localDate(),
  ).length;
  const sentCount = history.filter(
    (item) => item.notificationStatus === "sent",
  ).length;
  const pendingCount = history.filter(
    (item) => item.notificationStatus === "pending",
  ).length;

  return (
    <>
      <div className="section-heading checkin-heading">
        <div>
          <span className="eyebrow">CHEGADA SEGURA</span>
          <h1>QR e entrada</h1>
          <p>Registre a presença pela câmera e avise o responsável automaticamente.</p>
        </div>
        <div className="checkin-heading-actions">
          <span className={whatsappConfigured ? "bridge-status connected" : "bridge-status"}>
            <i />
            {whatsappConfigured
              ? "WhatsApp conectado"
              : "WhatsApp será conectado no aplicativo Windows"}
          </span>
          {whatsappConfigured && pendingCount > 0 && (
            <button className="queue-button" onClick={() => void retryNotifications()} disabled={retrying}>
              {retrying ? "Enviando fila..." : `Enviar fila (${pendingCount})`}
            </button>
          )}
          <button className="primary-button" onClick={() => void startScanner()}>
            ◎ Ler QR Code
          </button>
        </div>
      </div>

      <section className="checkin-metrics">
        <article className="metric-card">
          <div className="metric-icon green">✓</div>
          <div><span>ENTRADAS HOJE</span><strong>{todayCount}</strong><small>presenças por QR</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon blue">◌</div>
          <div><span>WHATSAPP ENVIADO</span><strong>{sentCount}</strong><small>responsáveis avisados</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon orange">↗</div>
          <div><span>NA FILA</span><strong>{pendingCount}</strong><small>aguardando o aplicativo</small></div>
        </article>
      </section>

      <section className="card checkin-panel">
        <div className="checkin-tabs">
          <button className={tab === "scanner" ? "active" : ""} onClick={() => setTab("scanner")}>Leitor</button>
          <button className={tab === "cards" ? "active" : ""} onClick={() => void loadCards()}>Cartões dos atletas</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Histórico</button>
        </div>

        {tab === "scanner" && (
          <div className="scanner-layout">
            <div className="scanner-stage">
              <div id="baseforte-qr-reader" className={scanning ? "active" : ""} />
              {!scanning && (
                <div className="scanner-placeholder">
                  <span>◎</span>
                  <strong>Câmera pronta para leitura</strong>
                  <small>Escolha a turma e aproxime o cartão do atleta.</small>
                  <button className="primary-button" onClick={() => void startScanner()} disabled={registering}>
                    Ativar câmera
                  </button>
                </div>
              )}
              {scanning && (
                <button className="scanner-stop" onClick={() => void stopScanner()}>
                  Encerrar câmera
                </button>
              )}
            </div>
            <div className="scanner-settings">
              <span className="eyebrow">CONFIGURAÇÃO DA LEITURA</span>
              <label>Turma
                <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                  <option value="">Selecione uma turma</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name} · {team.category}</option>
                  ))}
                </select>
              </label>
              <label>Data
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <form className="manual-code" onSubmit={submitManual}>
                <label>Código manual
                  <input name="code" placeholder="BF1:..." autoComplete="off" />
                </label>
                <button type="submit" disabled={registering}>{registering ? "Registrando..." : "Confirmar código"}</button>
              </form>
              {lastResult?.athlete && (
                <article className={`scan-success ${lastResult.duplicate ? "duplicate" : ""}`}>
                  <span>{lastResult.duplicate ? "↻" : "✓"}</span>
                  <div>
                    <strong>{lastResult.athlete.name}</strong>
                    <small>{lastResult.teamName} · {lastResult.duplicate ? "já registrado" : "entrada confirmada"}</small>
                    {lastResult.notification && (
                      <b className={`notification-result ${lastResult.notification.status}`}>
                        {notificationLabels[lastResult.notification.status]}
                      </b>
                    )}
                  </div>
                </article>
              )}
              {teams.length === 0 && (
                <div className="scanner-warning">Cadastre uma turma e matricule atletas antes de utilizar o leitor.</div>
              )}
            </div>
          </div>
        )}

        {tab === "cards" && (
          <div className="qr-cards-panel">
            <div className="qr-print-toolbar">
              <div><strong>Cartões individuais</strong><small>{cards.length} atletas ativos</small></div>
              <button onClick={() => window.print()} disabled={loadingCards || cards.length === 0}>Imprimir cartões</button>
            </div>
            {loadingCards && <div className="checkin-empty">Gerando QR Codes seguros...</div>}
            {!loadingCards && cards.length === 0 && <div className="checkin-empty">Nenhum atleta ativo para gerar cartões.</div>}
            <div className="qr-card-grid">
              {cards.map((card) => (
                <article key={card.id} className="athlete-qr-card">
                  <div className="qr-card-brand"><span>BF</span><strong>BaseForte</strong></div>
                  {card.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.image} alt={`QR Code de ${card.name}`} />
                  )}
                  <strong>{card.name}</strong>
                  <small>{card.category} · Cartão de entrada</small>
                  <p>Apresente este código ao chegar à escolinha.</p>
                </article>
              ))}
            </div>
          </div>
        )}

        {tab === "history" && (
          <div className="checkin-history">
            <div className="checkin-history-head">
              <span>ATLETA</span><span>TURMA</span><span>HORÁRIO</span><span>NOTIFICAÇÃO</span>
            </div>
            {history.map((item) => (
              <article key={item.id}>
                <span><strong>{item.athleteName}</strong><small>{item.category}</small></span>
                <span><strong>{item.teamName}</strong><small>presença confirmada</small></span>
                <span><strong>{new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(new Date(item.scannedAt))}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(item.scannedAt))}</small></span>
                <span><b className={`notification-result ${item.notificationStatus}`}>{notificationLabels[item.notificationStatus]}</b><small>{item.notificationError || item.guardianPhone || ""}</small></span>
              </article>
            ))}
            {!loading && history.length === 0 && <div className="checkin-empty">Nenhuma entrada registrada por QR Code.</div>}
            {loading && <div className="checkin-empty">Carregando histórico...</div>}
          </div>
        )}
      </section>
    </>
  );
}
