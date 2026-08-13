"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarCheck, CalendarX, CheckCircle2, Clock, ListChecks, Plus, X } from "lucide-react";
import type { TeamRecord } from "./TeamManagement";

type Drill = { id?: string; name: string; focus: string | null; durationMinutes: number; description: string | null };
type Training = {
  id: string; teamId: string; teamName: string; category: string; title: string;
  objective: string; sessionDate: string; durationMinutes: number;
  status: "planned" | "completed" | "cancelled"; notes: string | null; drills: Drill[];
};

export function TrainingManagement({ teams, notify }: { teams: TeamRecord[]; notify: (message: string) => void }) {
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Training | "new" | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/trainings");
      const payload = (await response.json()) as { trainings?: Training[]; error?: string };
      if (!response.ok) throw new Error(payload.error);
      setTrainings(payload.trainings ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível carregar os treinos."); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  async function remove(training: Training) {
    if (!window.confirm(`Excluir o treino “${training.title}”?`)) return;
    const response = await fetch(`/api/trainings/${training.id}`, { method: "DELETE" });
    if (!response.ok) return notify("Não foi possível excluir o treino.");
    notify("Treino excluído."); await load();
  }
  const planned = trainings.filter((item) => item.status === "planned");
  const completed = trainings.filter((item) => item.status === "completed");
  const minutes = trainings.reduce((sum, item) => sum + item.durationMinutes, 0);
  return <>
    <div className="section-heading"><div><span className="eyebrow">METODOLOGIA M6 FUTEBOL CLUBE</span><h1>Treinos</h1><p>Planeje sessões completas e mantenha o histórico por turma.</p></div><button className="primary-button" onClick={() => setModal("new")}><Plus size={16} strokeWidth={2} /> Planejar treino</button></div>
    <section className="training-metrics">
      <article className="metric-card"><div className="metric-icon green"><CalendarCheck size={19} strokeWidth={1.75} /></div><div><span>PLANEJADOS</span><strong>{planned.length}</strong><small>próximas sessões</small></div></article>
      <article className="metric-card"><div className="metric-icon blue"><CheckCircle2 size={19} strokeWidth={1.75} /></div><div><span>CONCLUÍDOS</span><strong>{completed.length}</strong><small>no histórico</small></div></article>
      <article className="metric-card"><div className="metric-icon orange"><Clock size={19} strokeWidth={1.75} /></div><div><span>VOLUME TOTAL</span><strong>{minutes} min</strong><small>planejamento registrado</small></div></article>
    </section>
    <section className="training-board">
      {trainings.map((training) => <article className="card training-session-card" key={training.id}>
        <header><span className={`training-status ${training.status}`}>{training.status === "planned" ? "Planejado" : training.status === "completed" ? "Concluído" : "Cancelado"}</span><small>{new Date(`${training.sessionDate}T12:00:00`).toLocaleDateString("pt-BR")}</small></header>
        <span className="eyebrow">{training.teamName} · {training.category}</span><h2>{training.title}</h2><p>{training.objective}</p>
        <div className="session-meta"><span><Clock size={13} strokeWidth={1.75} /> {training.durationMinutes} min</span><span><ListChecks size={13} strokeWidth={1.75} /> {training.drills.length} exercícios</span></div>
        <div className="session-drills">{training.drills.slice(0, 4).map((drill, index) => <div key={drill.id ?? index}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{drill.name}</strong><small>{drill.focus || "Exercício"} · {drill.durationMinutes} min</small></span></div>)}</div>
        <footer><button onClick={() => setModal(training)}>Abrir planejamento</button><button onClick={() => void remove(training)}>Excluir</button></footer>
      </article>)}
      {!loading && trainings.length === 0 && <div className="card class-empty"><span><CalendarX size={22} strokeWidth={1.75} /></span><strong>Nenhum treino planejado</strong><small>Crie uma sessão e organize os exercícios em sequência.</small><button className="primary-button" onClick={() => setModal("new")}>Planejar primeiro treino</button></div>}
    </section>
    {modal && <TrainingModal teams={teams} training={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={async () => { setModal(null); notify("Planejamento de treino salvo."); await load(); }} />}
  </>;
}

function TrainingModal({ teams, training, onClose, onSaved }: { teams: TeamRecord[]; training: Training | null; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [drills, setDrills] = useState<Drill[]>(training?.drills.length ? training.drills : [{ name: "Aquecimento com bola", focus: "Mobilidade e condução", durationMinutes: 12, description: "" }]);
  function update(index: number, field: keyof Drill, value: string | number) { setDrills((current) => current.map((drill, position) => position === index ? { ...drill, [field]: value } : drill)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try {
      const response = await fetch(training ? `/api/trainings/${training.id}` : "/api/trainings", {
        method: training ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: form.get("teamId"), title: form.get("title"), objective: form.get("objective"), sessionDate: form.get("sessionDate"), durationMinutes: Number(form.get("durationMinutes")), status: form.get("status"), notes: form.get("notes"), drills }),
      });
      const payload = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(payload.error); onSaved();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="training-modal" role="dialog" aria-modal="true" aria-labelledby="training-modal-title" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="eyebrow">PLANEJAMENTO DE SESSÃO</span><h2 id="training-modal-title">{training ? "Editar treino" : "Novo treino"}</h2><p>Organize objetivo, duração e sequência metodológica.</p></div><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button></header>
    <form onSubmit={submit}>
      <div className="form-row"><label>Turma<select name="teamId" required defaultValue={training?.teamId ?? ""}><option value="" disabled>Selecione</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.category}</option>)}</select></label><label>Data<input name="sessionDate" type="date" required defaultValue={training?.sessionDate ?? new Date().toISOString().slice(0, 10)} /></label></div>
      <label>Título<input name="title" required defaultValue={training?.title ?? ""} placeholder="Ex.: Domínio e progressão" /></label>
      <label>Objetivo principal<input name="objective" required defaultValue={training?.objective ?? ""} placeholder="O que os atletas devem desenvolver nesta sessão?" /></label>
      <div className="form-row"><label>Duração total<input name="durationMinutes" type="number" min="15" max="240" required defaultValue={training?.durationMinutes ?? 75} /></label><label>Situação<select name="status" defaultValue={training?.status ?? "planned"}><option value="planned">Planejado</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label></div>
      <div className="drill-editor"><div><strong>Sequência de exercícios</strong><button type="button" onClick={() => setDrills((current) => [...current, { name: "", focus: "", durationMinutes: 10, description: "" }])}><Plus size={14} strokeWidth={2} /> Adicionar</button></div>
        <div className="drill-editor-list">
          {drills.map((drill, index) => <section key={index}><b>{String(index + 1).padStart(2, "0")}</b><input aria-label="Nome do exercício" required value={drill.name} onChange={(event) => update(index, "name", event.target.value)} placeholder="Nome do exercício" /><input aria-label="Foco" value={drill.focus ?? ""} onChange={(event) => update(index, "focus", event.target.value)} placeholder="Foco metodológico" /><input aria-label="Duração" type="number" min="1" value={drill.durationMinutes} onChange={(event) => update(index, "durationMinutes", Number(event.target.value))} /><button type="button" disabled={drills.length === 1} onClick={() => setDrills((current) => current.filter((_, position) => position !== index))}><X size={14} strokeWidth={1.75} /></button></section>)}
        </div>
      </div>
      <label>Observações<textarea name="notes" defaultValue={training?.notes ?? ""} placeholder="Materiais, adaptações ou observações para o professor..." /></label>
      <button className="primary-button full" disabled={saving || !teams.length}>{saving ? "Salvando..." : "Salvar planejamento"}</button>
    </form>
  </div></div>;
}
