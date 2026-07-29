"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AthleteRecord } from "./AthleteProfileModal";

export type TeamRecord = {
  id: string;
  name: string;
  category: string;
  coachName: string;
  scheduleDays: string[];
  startTime: string;
  endTime: string;
  place: string;
  capacity: number;
  athleteIds: string[];
  players: number;
  color: string;
};

export function TeamModal({
  team,
  athletes,
  onClose,
  onSaved,
  onArchived,
  notify,
}: {
  team: TeamRecord | null;
  athletes: AthleteRecord[];
  onClose: () => void;
  onSaved: (team: TeamRecord) => void;
  onArchived: (teamId: string) => void;
  notify: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [category, setCategory] = useState(team?.category ?? "Sub-11");
  const [selectedAthletes, setSelectedAthletes] = useState<Set<string>>(
    new Set(team?.athleteIds ?? []),
  );

  const categoryAthletes = useMemo(
    () => athletes.filter((athlete) => athlete.category === category),
    [athletes, category],
  );

  function toggleAthlete(athleteId: string) {
    setSelectedAthletes((current) => {
      const next = new Set(current);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
  }

  function changeCategory(nextCategory: string) {
    setCategory(nextCategory);
    const allowedIds = new Set(
      athletes
        .filter((athlete) => athlete.category === nextCategory)
        .map((athlete) => athlete.id),
    );
    setSelectedAthletes(
      (current) =>
        new Set(Array.from(current).filter((athleteId) => allowedIds.has(athleteId))),
    );
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);

    try {
      const response = await fetch(team ? `/api/teams/${team.id}` : "/api/teams", {
        method: team ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") || ""),
          category,
          coachName: String(form.get("coachName") || ""),
          scheduleDays: form.getAll("scheduleDays").map(String),
          startTime: String(form.get("startTime") || ""),
          endTime: String(form.get("endTime") || ""),
          place: String(form.get("place") || ""),
          capacity: Number(form.get("capacity")),
          athleteIds: Array.from(selectedAthletes),
        }),
      });
      const payload = (await response.json()) as {
        team?: TeamRecord;
        error?: string;
      };
      if (!response.ok || !payload.team) {
        throw new Error(payload.error || "Não foi possível salvar a turma.");
      }
      onSaved(payload.team);
      notify(team ? "Turma atualizada com sucesso." : "Turma criada com sucesso.");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar a turma.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveTeam() {
    if (!team) return;
    if (
      !window.confirm(
        `Arquivar a turma ${team.name}? As chamadas anteriores serão preservadas.`,
      )
    ) {
      return;
    }

    setArchiving(true);
    try {
      const response = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Falha ao arquivar turma.");
      onArchived(team.id);
      notify("Turma arquivada; o histórico foi preservado.");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao arquivar turma.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="team-modal-header">
          <div><span className="eyebrow">{team ? "EDITAR TURMA" : "NOVA TURMA"}</span><h2 id="team-modal-title">{team ? team.name : "Criar turma"}</h2><p>Defina horários, professor, capacidade e atletas matriculados.</p></div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <form className="team-form" onSubmit={saveTeam}>
          <label>Nome da turma<input name="name" defaultValue={team?.name ?? "Turma principal"} required /></label>
          <label>Categoria<select name="category" value={category} onChange={(event) => changeCategory(event.target.value)}><option>Sub-7</option><option>Sub-9</option><option>Sub-11</option><option>Sub-13</option><option>Sub-15</option><option>Sub-17</option></select></label>
          <label className="wide">Professor responsável<input name="coachName" defaultValue={team?.coachName ?? ""} placeholder="Ex.: Prof. Diego" required /></label>
          <div className="wide">
            <span className="field-label">Dias de treino</span>
            <div className="weekday-picker">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
                <label key={day}><input name="scheduleDays" type="checkbox" value={day} defaultChecked={team?.scheduleDays.includes(day)} /><span>{day}</span></label>
              ))}
            </div>
          </div>
          <label>Início<input name="startTime" type="time" defaultValue={team?.startTime ?? "08:00"} required /></label>
          <label>Término<input name="endTime" type="time" defaultValue={team?.endTime ?? "09:00"} required /></label>
          <label>Local<input name="place" defaultValue={team?.place ?? "Campo 1"} required /></label>
          <label>Capacidade<input name="capacity" type="number" min="1" max="100" defaultValue={team?.capacity ?? 24} required /></label>
          <div className="roster-picker wide">
            <div><strong>Atletas da categoria {category}</strong><small>{selectedAthletes.size} selecionados</small></div>
            {categoryAthletes.length === 0 ? (
              <p>Nenhum atleta ativo nesta categoria.</p>
            ) : (
              <div className="roster-options">
                {categoryAthletes.map((athlete) => (
                  <label key={athlete.id}>
                    <input type="checkbox" checked={selectedAthletes.has(athlete.id)} onChange={() => toggleAthlete(athlete.id)} />
                    <span className={`mini-avatar ${athlete.tone}`}>{athlete.initials}</span>
                    <span><strong>{athlete.name}</strong><small>{athlete.age} anos</small></span>
                    <b>{selectedAthletes.has(athlete.id) ? "✓" : "+"}</b>
                  </label>
                ))}
              </div>
            )}
          </div>
          <footer className="profile-actions wide">
            {team ? <button type="button" className="archive-button" onClick={archiveTeam} disabled={archiving}>{archiving ? "Arquivando..." : "Arquivar turma"}</button> : <span />}
            <button className="primary-button" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar turma"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

type AttendanceAthlete = {
  id: string;
  name: string;
  initials: string;
  category: string;
  attendance: number;
  present: boolean;
  note: string;
};

function todayLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

export function AttendanceModal({
  team,
  onClose,
  onSaved,
  notify,
}: {
  team: TeamRecord;
  onClose: () => void;
  onSaved: () => void;
  notify: (message: string) => void;
}) {
  const [date, setDate] = useState(todayLocal);
  const [roster, setRoster] = useState<AttendanceAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);

  useEffect(() => {
    void loadAttendance();
  }, [date, team.id]);

  async function loadAttendance() {
    setLoading(true);
    try {
      const response = await fetch(`/api/teams/${team.id}/attendance?date=${encodeURIComponent(date)}`);
      const payload = (await response.json()) as {
        athletes?: AttendanceAthlete[];
        saved?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar chamada.");
      setRoster(payload.athletes ?? []);
      setAlreadySaved(Boolean(payload.saved));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao carregar chamada.");
    } finally {
      setLoading(false);
    }
  }

  function updateAthlete(athleteId: string, patch: Partial<AttendanceAthlete>) {
    setRoster((current) =>
      current.map((athlete) =>
        athlete.id === athleteId ? { ...athlete, ...patch } : athlete,
      ),
    );
  }

  async function saveAttendance() {
    setSaving(true);
    try {
      const response = await fetch(`/api/teams/${team.id}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          records: roster.map((athlete) => ({
            athleteId: athlete.id,
            present: athlete.present,
            note: athlete.note,
          })),
        }),
      });
      const payload = (await response.json()) as {
        present?: number;
        absent?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar chamada.");
      setAlreadySaved(true);
      onSaved();
      notify(`Chamada salva: ${payload.present ?? 0} presentes e ${payload.absent ?? 0} ausentes.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao salvar chamada.");
    } finally {
      setSaving(false);
    }
  }

  const presentCount = roster.filter((athlete) => athlete.present).length;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="attendance-panel" role="dialog" aria-modal="true" aria-labelledby="attendance-panel-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="attendance-panel-header">
          <div><span className="eyebrow">CHAMADA DA TURMA</span><h2 id="attendance-panel-title">{team.name} · {team.category}</h2><p>{team.coachName} · {team.startTime} · {team.place}</p></div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="attendance-toolbar">
          <label>Data da aula<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div><span><b>{presentCount}</b> presentes</span><span><b>{roster.length - presentCount}</b> ausentes</span>{alreadySaved && <em>Chamada já registrada</em>}</div>
        </div>
        <div className="attendance-roster">
          {loading && <div className="document-empty">Carregando atletas...</div>}
          {!loading && roster.length === 0 && <div className="document-empty"><span>◎</span><strong>Turma sem atletas</strong><small>Edite a turma e adicione atletas antes da chamada.</small></div>}
          {!loading && roster.map((athlete) => (
            <article key={athlete.id} className={athlete.present ? "attendance-person present" : "attendance-person absent"}>
              <button onClick={() => updateAthlete(athlete.id, { present: !athlete.present })} aria-label={`${athlete.present ? "Marcar ausência de" : "Marcar presença de"} ${athlete.name}`}><span>{athlete.present ? "✓" : "×"}</span></button>
              <span className="mini-avatar green">{athlete.initials}</span>
              <div><strong>{athlete.name}</strong><small>Frequência histórica: {athlete.attendance}%</small></div>
              <input value={athlete.note} onChange={(event) => updateAthlete(athlete.id, { note: event.target.value })} placeholder={athlete.present ? "Observação opcional" : "Motivo da ausência"} maxLength={240} />
            </article>
          ))}
        </div>
        <footer className="attendance-footer">
          <button className="filter-button" onClick={onClose}>Cancelar</button>
          <button className="primary-button" onClick={saveAttendance} disabled={saving || roster.length === 0}>{saving ? "Salvando..." : alreadySaved ? "Atualizar chamada" : "Salvar chamada"}</button>
        </footer>
      </section>
    </div>
  );
}
