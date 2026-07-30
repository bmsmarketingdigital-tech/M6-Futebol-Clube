"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AthleteRecord } from "./AthleteProfileModal";

type Evaluation = {
  id: string;
  athleteId: string;
  athleteName: string;
  category: string;
  evaluationDate: string;
  technicalScore: number;
  physicalScore: number;
  tacticalScore: number;
  behavioralScore: number;
  strengths: string | null;
  improvements: string | null;
  nextGoals: string | null;
  evaluatedBy: string;
  overallScore: number;
};

export function EvaluationManagement({
  athletes,
  notify,
}: {
  athletes: AthleteRecord[];
  notify: (message: string) => void;
}) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Evaluation | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/evaluations");
      const payload = (await response.json()) as { evaluations?: Evaluation[]; error?: string };
      if (!response.ok) throw new Error(payload.error);
      setEvaluations(payload.evaluations ?? []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível carregar as avaliações.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const latest = useMemo(() => {
    const map = new Map<string, Evaluation>();
    for (const evaluation of evaluations) {
      if (!map.has(evaluation.athleteId)) map.set(evaluation.athleteId, evaluation);
    }
    return [...map.values()];
  }, [evaluations]);
  const average = latest.length
    ? latest.reduce((sum, item) => sum + item.overallScore, 0) / latest.length
    : 0;

  async function remove(evaluation: Evaluation) {
    if (!window.confirm(`Excluir a avaliação de ${evaluation.athleteName}?`)) return;
    const response = await fetch(`/api/evaluations/${evaluation.id}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) return notify(payload.error || "Não foi possível excluir.");
    notify("Avaliação excluída.");
    await load();
  }

  return (
    <>
      <div className="section-heading">
        <div><span className="eyebrow">DESENVOLVIMENTO ESPORTIVO</span><h1>Avaliações</h1><p>Acompanhe a evolução técnica, física, tática e comportamental.</p></div>
        <button className="primary-button" onClick={() => setModal("new")}>＋ Nova avaliação</button>
      </div>
      <section className="evaluation-metrics">
        <article className="metric-card"><div className="metric-icon green">↗</div><div><span>ATLETAS AVALIADOS</span><strong>{latest.length}</strong><small>de {athletes.length} ativos</small></div></article>
        <article className="metric-card"><div className="metric-icon blue">★</div><div><span>MÉDIA GERAL</span><strong>{average.toFixed(1)} / 5</strong><small>última avaliação</small></div></article>
        <article className="metric-card"><div className="metric-icon orange">○</div><div><span>SEM AVALIAÇÃO</span><strong>{Math.max(0, athletes.length - latest.length)}</strong><small>precisam de acompanhamento</small></div></article>
      </section>
      <section className="card evaluation-panel">
        <div className="card-header"><div><h2>Histórico de avaliações</h2><p>{evaluations.length} registros salvos</p></div><span className={loading ? "finance-loading" : "finance-ready"}>{loading ? "Carregando..." : "Atualizado"}</span></div>
        <div className="evaluation-list">
          {evaluations.map((item) => (
            <article key={item.id}>
              <div className="evaluation-person"><i>{item.athleteName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</i><span><strong>{item.athleteName}</strong><small>{item.category} · {new Date(`${item.evaluationDate}T12:00:00`).toLocaleDateString("pt-BR")}</small></span></div>
              <Score label="Técnica" value={item.technicalScore} />
              <Score label="Física" value={item.physicalScore} />
              <Score label="Tática" value={item.tacticalScore} />
              <Score label="Comportamento" value={item.behavioralScore} />
              <b className="overall-score">{item.overallScore.toFixed(1)}</b>
              <div className="evaluation-actions"><button onClick={() => setModal(item)}>Editar</button><button onClick={() => void remove(item)}>Excluir</button></div>
            </article>
          ))}
          {!loading && evaluations.length === 0 && <div className="finance-empty"><span>↗</span><strong>Nenhuma avaliação registrada</strong><small>Crie a primeira avaliação para iniciar o histórico.</small></div>}
        </div>
      </section>
      {modal && <EvaluationModal athletes={athletes} evaluation={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={async () => { setModal(null); notify("Avaliação salva com sucesso."); await load(); }} />}
    </>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return <div className="evaluation-score"><small>{label}</small><span><i style={{ width: `${value * 20}%` }} /></span><strong>{value}</strong></div>;
}

function EvaluationModal({ athletes, evaluation, onClose, onSaved }: { athletes: AthleteRecord[]; evaluation: Evaluation | null; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch(evaluation ? `/api/evaluations/${evaluation.id}` : "/api/evaluations", {
        method: evaluation ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error);
      onSaved();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="evaluation-modal" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="eyebrow">AVALIAÇÃO ESPORTIVA</span><h2>{evaluation ? "Editar avaliação" : "Nova avaliação"}</h2><p>Use a escala de 1 (inicial) a 5 (excelente).</p></div><button className="modal-close" onClick={onClose}>×</button></header>
    <form onSubmit={submit}>
      <div className="form-row"><label>Atleta<select name="athleteId" required defaultValue={evaluation?.athleteId ?? ""}><option value="" disabled>Selecione</option>{athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name} · {athlete.category}</option>)}</select></label><label>Data<input name="evaluationDate" type="date" required defaultValue={evaluation?.evaluationDate ?? new Date().toISOString().slice(0, 10)} /></label></div>
      <div className="score-grid">{(["technicalScore", "physicalScore", "tacticalScore", "behavioralScore"] as const).map((name, index) => <label key={name}>{["Técnica", "Física", "Tática", "Comportamento"][index]}<select name={name} defaultValue={evaluation?.[name] ?? 3}>{[1,2,3,4,5].map((score) => <option key={score} value={score}>{score} — {["","Inicial","Em desenvolvimento","Adequado","Muito bom","Excelente"][score]}</option>)}</select></label>)}</div>
      <label>Pontos fortes<textarea name="strengths" defaultValue={evaluation?.strengths ?? ""} placeholder="Fundamentos e atitudes que se destacaram..." /></label>
      <label>Pontos a desenvolver<textarea name="improvements" defaultValue={evaluation?.improvements ?? ""} placeholder="O que precisa de atenção no próximo ciclo..." /></label>
      <label>Próximas metas<textarea name="nextGoals" defaultValue={evaluation?.nextGoals ?? ""} placeholder="Metas objetivas para atleta e professor..." /></label>
      <button className="primary-button full" disabled={saving}>{saving ? "Salvando..." : "Salvar avaliação"}</button>
    </form>
  </div></div>;
}
