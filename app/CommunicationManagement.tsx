"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, Check, CheckCircle2, MessageCircle, Plus, X } from "lucide-react";
import type { TeamRecord } from "./TeamManagement";
import { readApiResponse } from "./api-response";

type Recipient = { id: string; athleteId: string; guardianName: string; guardianEmail: string | null; guardianPhone: string | null; readAt: string | null };
type Communication = {
  id: string; title: string; message: string; audienceType: "all" | "team";
  teamId: string | null; teamName: string | null; priority: "normal" | "important" | "urgent";
  status: "draft" | "scheduled" | "sent" | "cancelled"; scheduledAt: string | null;
  sentAt: string | null; createdBy: string; recipientCount: number; readCount: number; recipients: Recipient[];
};

const statusLabels = { draft: "Rascunho", scheduled: "Agendado", sent: "Enviado", cancelled: "Cancelado" };

export function CommunicationManagement({ teams, notify, onBack }: { teams: TeamRecord[]; notify: (message: string) => void; onBack: () => void }) {
  const [items, setItems] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Communication | "new" | null>(null);
  const [details, setDetails] = useState<Communication | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/communications");
      const payload = await readApiResponse<{ communications?: Communication[] }>(response);
      if (!response.ok) throw new Error(payload.error);
      setItems(payload.communications ?? []);
      setDetails((current) =>
        current
          ? (payload.communications ?? []).find((item) => item.id === current.id) ?? null
          : null,
      );
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível carregar os comunicados."); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  async function cancel(item: Communication) {
    if (!window.confirm(`Cancelar o comunicado “${item.title}”?`)) return;
    const response = await fetch(`/api/communications/${item.id}`, { method: "DELETE" });
    if (!response.ok) return notify("Não foi possível cancelar.");
    notify("Comunicado cancelado e mantido no histórico."); await load();
  }
  async function toggleRead(item: Communication, recipient: Recipient) {
    const response = await fetch(`/api/communications/${item.id}/read`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: recipient.id, read: !recipient.readAt }) });
    if (!response.ok) return notify("Não foi possível atualizar a leitura.");
    await load();
  }
  const sent = items.filter((item) => item.status === "sent");
  const totalRecipients = sent.reduce((sum, item) => sum + item.recipientCount, 0);
  const totalReads = sent.reduce((sum, item) => sum + item.readCount, 0);
  const readingRate = totalRecipients ? Math.round((totalReads / totalRecipients) * 100) : 0;
  return <>
    <div className="section-heading section-heading-with-back"><button type="button" className="section-back-button" onClick={onBack} aria-label="Voltar para o início"><ArrowLeft size={20} strokeWidth={2} /></button><div><span className="eyebrow">RELACIONAMENTO COM FAMÍLIAS</span><h1>Comunicação</h1><p>Crie avisos segmentados e acompanhe a confirmação de leitura.</p></div><button className="primary-button" onClick={() => setModal("new")}><Plus size={16} strokeWidth={2} /> Novo comunicado</button></div>
 <WhatsAppCommunicationCard notify={notify} />
 <section className="communication-metrics">
      <article className="metric-card"><div className="metric-icon green"><MessageCircle size={19} strokeWidth={1.75} /></div><div><span>COMUNICADOS</span><strong>{items.length}</strong><small>histórico completo</small></div></article>
      <article className="metric-card"><div className="metric-icon blue"><CheckCircle2 size={19} strokeWidth={1.75} /></div><div><span>TAXA DE LEITURA</span><strong>{readingRate}%</strong><small>{totalReads} confirmações</small></div></article>
      <article className="metric-card"><div className="metric-icon orange"><CalendarClock size={19} strokeWidth={1.75} /></div><div><span>AGENDADOS</span><strong>{items.filter((item) => item.status === "scheduled").length}</strong><small>próximos envios</small></div></article>
    </section>
    <section className="card communication-panel">
      <div className="card-header"><div><h2>Central de comunicados</h2><p>{items.length} mensagens registradas</p></div><span className={loading ? "finance-loading" : "finance-ready"}>{loading ? "Carregando..." : "Atualizado"}</span></div>
      <div className="communication-list">
        {items.map((item) => {
          const rate = item.recipientCount ? Math.round((item.readCount / item.recipientCount) * 100) : 0;
          return <article key={item.id}>
            <div className={`communication-priority ${item.priority}`}>!</div>
            <div className="communication-copy"><div><span className={`communication-status ${item.status}`}>{statusLabels[item.status]}</span><small>{item.audienceType === "all" ? "Todos os responsáveis" : item.teamName}</small></div><h3>{item.title}</h3><p>{item.message}</p></div>
            <div className="read-progress"><strong>{item.readCount}/{item.recipientCount}</strong><small>leituras</small><span><i style={{ width: `${rate}%` }} /></span></div>
            <div className="communication-actions"><button onClick={() => setDetails(item)}>Destinatários</button>{item.status !== "sent" && item.status !== "cancelled" && <button onClick={() => setModal(item)}>Editar</button>}{item.status !== "cancelled" && <button onClick={() => void cancel(item)}>Cancelar</button>}</div>
          </article>;
        })}
        {!loading && !items.length && <div className="finance-empty"><span><MessageCircle size={22} strokeWidth={1.75} /></span><strong>Nenhum comunicado criado</strong><small>Crie o primeiro aviso para responsáveis.</small></div>}
      </div>
    </section>
    {modal && <CommunicationModal teams={teams} item={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={async () => { setModal(null); notify("Comunicado salvo."); await load(); }} />}
    {details && <div className="modal-backdrop" onMouseDown={() => setDetails(null)}><div className="recipient-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">CONFIRMAÇÕES DE LEITURA</span><h2>{details.title}</h2><p>{details.readCount} de {details.recipientCount} responsáveis confirmaram.</p></div><button className="modal-close" onClick={() => setDetails(null)}><X size={18} strokeWidth={1.75} /></button></header><div className="recipient-list">{details.recipients.map((recipient) => <button key={recipient.id} onClick={() => void toggleRead(details, recipient)}><span className={recipient.readAt ? "read-check active" : "read-check"}><Check size={13} strokeWidth={2} /></span><span><strong>{recipient.guardianName}</strong><small>{recipient.guardianPhone || recipient.guardianEmail || "Contato não informado"}</small></span><b>{recipient.readAt ? "Leitura confirmada" : "Marcar como lido"}</b></button>)}</div></div></div>}
  </>;
}

type CommunicationWhatsAppStatus = { status: string; configured: boolean; qrCodeDataUrl?: string; connectedPhone?: string };

function WhatsAppCommunicationCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<CommunicationWhatsAppStatus>({ status: "disconnected", configured: false, qrCodeDataUrl: "" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/check-in/whatsapp");
    const payload = await readApiResponse<{ whatsapp?: CommunicationWhatsAppStatus }>(response);
    if (payload.whatsapp) setStatus(payload.whatsapp);
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function action(path: string, message: string, bridgeAction?: "connect" | "disconnect") {
    setBusy(true);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: bridgeAction ? JSON.stringify({ action: bridgeAction }) : undefined });
      const payload = await readApiResponse<{ whatsapp?: CommunicationWhatsAppStatus }>(response);
      if (!response.ok) throw new Error(payload.error || "Falha na operação.");
      if (payload.whatsapp) setStatus(payload.whatsapp);
      notify(message);
    } catch (error) { notify(error instanceof Error ? error.message : "Falha na operação."); }
    finally { setBusy(false); }
  }

  return <section className={`card whatsapp-connector-card communication-whatsapp-card ${status.status}`}>
    <div className="whatsapp-connector-copy"><span className="whatsapp-logo"><MessageCircle size={20} strokeWidth={1.75} /></span><div>
      <span className="eyebrow">NOTIFICAÇÕES AUTOMÁTICAS</span><h2>WhatsApp da comunicação</h2>
      <p>{status.status === "connected" ? `Conectado${status.connectedPhone ? ` · ${status.connectedPhone}` : ""}. Pronto para enviar avisos.` : "Conecte o WhatsApp para enviar confirmações e avisos aos responsáveis."}</p>
    </div></div>
    {status.status === "qr" && status.qrCodeDataUrl && <div className="whatsapp-qr"><img src={status.qrCodeDataUrl} alt="QR Code para conectar o WhatsApp" /><span><strong>Escaneie no WhatsApp</strong><small>Aparelhos conectados → Conectar aparelho</small></span></div>}
    <div className="whatsapp-connector-actions">
      {status.status !== "connected" && <button className="whatsapp-connect-button" onClick={() => void action("/api/check-in/whatsapp", "Conector iniciado. Aguarde o QR Code.", "connect")} disabled={busy}>{busy ? "Preparando..." : "Conectar WhatsApp"}</button>}
      {status.status === "connected" && <><button className="whatsapp-connect-button" onClick={() => void action("/api/check-in/whatsapp/test", "Mensagem de teste enviada para 18981518787.")} disabled={busy}>{busy ? "Enviando..." : "Enviar teste (18981518787)"}</button><button className="disconnect-button" onClick={() => void action("/api/check-in/whatsapp", "WhatsApp desconectado.", "disconnect")} disabled={busy}>Desconectar</button></>}
    </div>
  </section>;
}

function CommunicationModal({ teams, item, onClose, onSaved }: { teams: TeamRecord[]; item: Communication | null; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [audience, setAudience] = useState(item?.audienceType ?? "all");
  const [status, setStatus] = useState<"draft" | "scheduled" | "sent">(item?.status === "scheduled" ? "scheduled" : item?.status === "sent" ? "sent" : "draft");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try {
      const response = await fetch(item ? `/api/communications/${item.id}` : "/api/communications", { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: form.get("title"), message: form.get("message"), audienceType: audience, teamId: form.get("teamId"), priority: form.get("priority"), status, scheduledAt: form.get("scheduledAt") }) });
      const payload = await readApiResponse<Record<string, never>>(response); if (!response.ok) throw new Error(payload.error); onSaved();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="communication-modal" role="dialog" aria-modal="true" aria-labelledby="communication-modal-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">NOVO AVISO</span><h2 id="communication-modal-title">{item ? "Editar comunicado" : "Criar comunicado"}</h2><p>O sistema salvará a lista exata de destinatários.</p></div><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button></header><form onSubmit={submit}>
    <label>Título<input name="title" required defaultValue={item?.title ?? ""} placeholder="Ex.: Alteração no treino de sexta-feira" /></label>
    <label>Mensagem<textarea name="message" required defaultValue={item?.message ?? ""} placeholder="Escreva uma mensagem clara para os responsáveis..." /></label>
    <div className="form-row"><label>Destinatários<select value={audience} onChange={(event) => setAudience(event.target.value as "all" | "team")}><option value="all">Todos os responsáveis</option><option value="team">Uma turma específica</option></select></label><label>Turma<select name="teamId" disabled={audience === "all"} required={audience === "team"} defaultValue={item?.teamId ?? ""}><option value="">Selecione</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.category}</option>)}</select></label></div>
    <div className="form-row"><label>Prioridade<select name="priority" defaultValue={item?.priority ?? "normal"}><option value="normal">Normal</option><option value="important">Importante</option><option value="urgent">Urgente</option></select></label><label>Situação<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">Salvar como rascunho</option><option value="scheduled">Agendar</option><option value="sent">Registrar como enviado</option></select></label></div>
    {status === "scheduled" && <label>Data e horário do envio<input name="scheduledAt" type="datetime-local" required defaultValue={item?.scheduledAt ?? ""} /></label>}
    <button className="primary-button full" disabled={saving}>{saving ? "Salvando..." : status === "sent" ? "Salvar e registrar envio" : "Salvar comunicado"}</button>
  </form></div></div>;
}
