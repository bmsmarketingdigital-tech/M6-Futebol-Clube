"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CheckCircle2, MessageCircle, QrCode, Search, TrendingUp, X } from "lucide-react";
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

type Tab = "cards" | "history";

type WhatsAppStatus = {
  configured: boolean;
  status:
    | "unavailable"
    | "disconnected"
    | "starting"
    | "qr"
    | "authenticated"
    | "connected"
    | "error";
  qrCodeDataUrl: string;
  connectedPhone: string;
  lastError: string;
  lastMessage: string;
  updatedAt: string | null;
};

const unavailableWhatsApp: WhatsAppStatus = {
  configured: false,
  status: "unavailable",
  qrCodeDataUrl: "",
  connectedPhone: "",
  lastError: "",
  lastMessage: "Disponível somente no aplicativo Windows.",
  updatedAt: null,
};

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
}: {
  teams: TeamRecord[];
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("cards");
  const [history, setHistory] = useState<CheckIn[]>([]);
  const [cards, setCards] = useState<QrCard[]>([]);
  const [selectedQrCard, setSelectedQrCard] = useState<QrCard | null>(null);
  const [cardQuery, setCardQuery] = useState("");
  const [cardTeamId, setCardTeamId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [whatsapp, setWhatsapp] =
    useState<WhatsAppStatus>(unavailableWhatsApp);
  const [controllingWhatsApp, setControllingWhatsApp] = useState(false);

  const filteredCards = useMemo(() => {
    const query = cardQuery.trim().toLocaleLowerCase("pt-BR");
    const selectedTeam = cardTeamId === "all"
      ? null
      : teams.find((team) => team.id === cardTeamId);

    return cards.filter((card) => {
      if (selectedTeam && !selectedTeam.athleteIds.includes(card.id)) return false;
      if (!query) return true;
      const athleteTeams = teams
        .filter((team) => team.athleteIds.includes(card.id))
        .map((team) => team.name)
        .join(" ");
      return `${card.name} ${card.category} ${athleteTeams}`
        .toLocaleLowerCase("pt-BR")
        .includes(query);
    });
  }, [cardQuery, cardTeamId, cards, teams]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/check-in");
      const payload = (await response.json()) as {
        checkIns?: CheckIn[];
        whatsapp?: WhatsAppStatus;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Falha ao carregar entradas.");
      }
      setHistory(payload.checkIns ?? []);
      setWhatsapp(payload.whatsapp ?? unavailableWhatsApp);
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

  const loadWhatsAppStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/check-in/whatsapp");
      const payload = (await response.json()) as {
        whatsapp?: WhatsAppStatus;
        error?: string;
      };
      if (response.ok && payload.whatsapp) setWhatsapp(payload.whatsapp);
    } catch {
      // A tela mantém o último estado conhecido durante uma reconexão curta.
    }
  }, []);

  useEffect(() => {
    if (!["starting", "qr", "authenticated"].includes(whatsapp.status)) return;
    const interval = window.setInterval(
      () => void loadWhatsAppStatus(),
      1800,
    );
    return () => window.clearInterval(interval);
  }, [loadWhatsAppStatus, whatsapp.status]);

  const loadCards = useCallback(async () => {
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
  }, [cards.length, notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadCards(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadCards]);

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

  async function sendWhatsAppTest() {
    setControllingWhatsApp(true);
    try {
      const response = await fetch("/api/check-in/whatsapp/test", { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Falha ao enviar o teste.");
      notify("Mensagem de teste enviada para 18981518787.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao enviar o teste.");
    } finally {
      setControllingWhatsApp(false);
    }
  }

  async function controlWhatsApp(action: "connect" | "disconnect") {
    setControllingWhatsApp(true);
    try {
      const response = await fetch("/api/check-in/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as {
        whatsapp?: WhatsAppStatus;
        error?: string;
      };
      if (!response.ok || !payload.whatsapp) {
        throw new Error(payload.error || "Falha ao controlar o WhatsApp.");
      }
      setWhatsapp(payload.whatsapp);
      notify(
        action === "connect"
          ? "Conector iniciado. Aguarde o QR Code."
          : "WhatsApp desconectado deste computador.",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Falha ao controlar o WhatsApp.",
      );
    } finally {
      setControllingWhatsApp(false);
    }
  }

  const todayCount = history.filter(
    (item) => localDateFromIso(item.scannedAt) === localDate(),
  ).length;
  const pendingCount = history.filter(
    (item) => item.notificationStatus === "pending",
  ).length;

  return (
    <>
      <div className="section-heading checkin-heading">
        <div>
          <span className="eyebrow">GESTÃO DE ENTRADAS</span>
          <h1>QR Codes dos atletas</h1>
          <p>Consulte os cartões e acompanhe as entradas registradas pelo aplicativo móvel.</p>
        </div>
        <div className="checkin-heading-actions">
          {whatsapp.status === "connected" && pendingCount > 0 && (
            <button className="queue-button" onClick={() => void retryNotifications()} disabled={retrying}>
              {retrying ? "Enviando fila..." : `Enviar fila (${pendingCount})`}
            </button>
          )}
        </div>
      </div>

      <section className="checkin-metrics">
        <article className="metric-card">
          <div className="metric-icon green"><CheckCircle2 size={19} strokeWidth={1.75} /></div>
          <div><span>ENTRADAS HOJE</span><strong>{todayCount}</strong><small>presenças por QR</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon blue"><MessageCircle size={19} strokeWidth={1.75} /></div>
 <div><span>CARTÕES ATIVOS</span><strong>{cards.length}</strong><small>cartões disponíveis</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon orange"><TrendingUp size={19} strokeWidth={1.75} /></div>
 <div><span>FILTRE POR TURMA</span><strong>{teams.length}</strong><small>turmas cadastradas</small></div>
        </article>
      </section>

 {false && <section className={`card whatsapp-connector-card ${whatsapp.status}`}>
        <div className="whatsapp-connector-copy">
          <span className="whatsapp-logo">◌</span>
          <div>
            <span className="eyebrow">NOTIFICAÇÕES AUTOMÁTICAS</span>
            <h2>Avisos automáticos por WhatsApp</h2>
            <p>
              {whatsapp.lastError || whatsapp.lastMessage}
              {whatsapp.status !== "connected" && " Conecte para confirmar a chegada ao responsável."}
            </p>
          </div>
        </div>
        {whatsapp.status === "qr" && whatsapp.qrCodeDataUrl && (
          <div className="whatsapp-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={whatsapp.qrCodeDataUrl} alt="QR Code para conectar o WhatsApp" />
            <span><strong>Escaneie no WhatsApp</strong><small>Aparelhos conectados → Conectar aparelho</small></span>
          </div>
        )}
        <div className="whatsapp-connector-actions">
          {!whatsapp.configured && (
            <small>Esta função fica disponível ao abrir o sistema da Escola de Futebol M6 Futebol Clube instalado no PC.</small>
          )}
          {whatsapp.configured &&
            ["disconnected", "error"].includes(whatsapp.status) && (
              <button className="whatsapp-connect-button" onClick={() => void controlWhatsApp("connect")} disabled={controllingWhatsApp}>
                {controllingWhatsApp ? "Preparando conexão..." : "Conectar para enviar avisos"}
              </button>
            )}
          {["starting", "authenticated"].includes(whatsapp.status) && (
            <span className="whatsapp-waiting"><i /> Preparando conexão...</span>
          )}
          {whatsapp.status === "connected" && (
            <>
              <span className="whatsapp-ready">✓ Pronto para enviar</span>
<button className="whatsapp-connect-button" onClick={() => void sendWhatsAppTest()} disabled={controllingWhatsApp}>
  {controllingWhatsApp ? "Enviando..." : "Enviar teste (18981518787)"}
</button>
<button className="disconnect-button" onClick={() => void controlWhatsApp("disconnect")} disabled={controllingWhatsApp}>
                Desconectar
              </button>
            </>
          )}
        </div>
 </section>}

 <section className="card checkin-panel">
        <div className="checkin-tabs">
          <button className={tab === "cards" ? "active" : ""} onClick={() => void loadCards()}>Cartões dos atletas</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Histórico</button>
        </div>

        {tab === "cards" && (
          <div className="qr-cards-panel">
            <div className="qr-print-toolbar">
              <div><strong>Cartões individuais</strong><small>{cards.length} atletas ativos</small></div>
              <div className="qr-card-filters">
                <label className="qr-card-search">
                  <span><Search size={14} strokeWidth={1.75} /></span>
                  <input
                    aria-label="Buscar cartão por atleta, categoria ou turma"
                    value={cardQuery}
                    onChange={(event) => setCardQuery(event.target.value)}
                    placeholder="Buscar atleta..."
                  />
                  {cardQuery && (
                    <button type="button" aria-label="Limpar busca" onClick={() => setCardQuery("")}><X size={14} strokeWidth={1.75} /></button>
                  )}
                </label>
                <select
                  aria-label="Filtrar cartões por turma"
                  value={cardTeamId}
                  onChange={(event) => setCardTeamId(event.target.value)}
                >
                  <option value="all">Todas as turmas</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name} · {team.category}</option>
                  ))}
                </select>
                <strong>{filteredCards.length} resultado(s)</strong>
              </div>
              <button onClick={() => window.print()} disabled={loadingCards || filteredCards.length === 0}>Imprimir cartões</button>
            </div>
            <div className="qr-purpose-note">
              <span><QrCode size={18} strokeWidth={1.75} /></span>
              <div>
                <strong>Cartão de entrada do atleta</strong>
                <small>
                  O aplicativo móvel escaneia este QR, identifica o atleta e registra sua presença.
                  O computador recebe a entrada e pode avisar o responsável pelo WhatsApp.
                </small>
              </div>
            </div>
            {loadingCards && <div className="checkin-empty">Gerando QR Codes seguros...</div>}
            {!loadingCards && cards.length === 0 && <div className="checkin-empty">Nenhum atleta ativo para gerar cartões.</div>}
            <div className="qr-card-grid">
              {filteredCards.map((card) => (
                <article key={card.id} className="athlete-qr-card">
                  <div className="qr-card-brand">
                    <span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/logo.jpeg" alt="Escola de Futebol M6 Futebol Clube" />
                    </span>
                    <strong>M6 Futebol Clube</strong>
                  </div>
                  {card.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.image} alt={`QR Code de ${card.name}`} />
                  )}
                  <strong>{card.name}</strong>
                  <small>{card.category} · Cartão de entrada</small>
                  <p>Apresente este código ao chegar à escolinha.</p>
                  <button type="button" className="qr-view-button" onClick={() => setSelectedQrCard(card)}>
                    Ver QR Code
                  </button>
                </article>
              ))}
            </div>
            {!loadingCards && cards.length > 0 && filteredCards.length === 0 && (
              <div className="checkin-empty">
                Nenhum cartão encontrado. Ajuste a busca ou selecione outra turma.
              </div>
            )}
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
      {selectedQrCard && (
        <div className="modal-backdrop qr-card-modal-backdrop" onMouseDown={() => setSelectedQrCard(null)}>
          <div className="qr-card-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">CARTÃO DE ENTRADA</span>
                <h2>{selectedQrCard.name}</h2>
                <p>{selectedQrCard.category} · identificação individual do atleta</p>
              </div>
              <button className="modal-close" onClick={() => setSelectedQrCard(null)} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button>
            </header>
            <div className="qr-card-modal-content">
              <div className="qr-card-brand">
                <span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.jpeg" alt="Escola de Futebol M6 Futebol Clube" />
                </span>
                <strong>M6 Futebol Clube</strong>
              </div>
              {selectedQrCard.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedQrCard.image} alt={`QR Code de ${selectedQrCard.name}`} />
              )}
              <strong>{selectedQrCard.name}</strong>
              <small>{selectedQrCard.category} · Cartão de entrada</small>
              <p>A escola deve escanear este código na chegada do atleta.</p>
            </div>
            <footer className="qr-card-modal-actions">
              <button className="filter-button" onClick={() => setSelectedQrCard(null)}>Fechar</button>
              <button className="primary-button" onClick={() => window.print()}>Imprimir este cartão</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
