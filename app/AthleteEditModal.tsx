"use client";

import { FormEvent, useMemo, useState } from "react";
import { Settings, X } from "lucide-react";
import type { AthleteRecord } from "./AthleteProfileModal";
import { AthleteFinancialSection } from "./AthleteFinancialSection";
import type { CategoryRecord } from "./CategoryManagerModal";
import type { TeamRecord } from "./TeamManagement";

export function AthleteEditModal({
  athlete,
  categories,
  teams,
  onClose,
  onSaved,
  onDeleted,
  onTeamChanged,
  onManageCategories,
  notify,
}: {
  athlete: AthleteRecord;
  categories: CategoryRecord[];
  teams: TeamRecord[];
  onClose: () => void;
  onSaved: (athlete: AthleteRecord) => void;
  onDeleted: (athleteId: string) => void;
  onTeamChanged: () => void;
  onManageCategories: () => void;
  notify: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [category, setCategory] = useState(athlete.category);

  const currentTeam = useMemo(
    () => teams.find((team) => team.athleteIds.includes(athlete.id)) ?? null,
    [teams, athlete.id],
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
    currentTeam?.id ?? null,
  );

  // Só listamos turmas compatíveis com a categoria escolhida no formulário
  // (não a categoria original do atleta) — a categoria pode ter mudado.
  const compatibleTeams = useMemo(
    () => teams.filter((team) => team.category === category),
    [teams, category],
  );

  const categoryChangedAwayFromCurrentTeam =
    currentTeam !== null && currentTeam.category !== category;

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory);
    // Se a turma atual não pertence mais à nova categoria, ela deixa de ser
    // uma opção válida no seletor — a seleção volta para "Sem turma" e o
    // usuário precisa escolher explicitamente uma turma nova ou confirmar
    // que o atleta ficará sem turma. Nunca trocamos automaticamente por
    // outra turma.
    if (currentTeam && currentTeam.category !== nextCategory) {
      setSelectedTeamId(null);
    }
  }

  async function saveAthlete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch(`/api/athletes/${athlete.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") || ""),
          category,
          birthDate: String(form.get("birthDate") || ""),
          guardianName: String(form.get("guardianName") || ""),
          guardianDocument: String(form.get("guardianDocument") || ""),
          guardianPhone: String(form.get("guardianPhone") || ""),
          guardianEmail: String(form.get("guardianEmail") || ""),
          emergencyName: String(form.get("emergencyName") || ""),
          emergencyPhone: String(form.get("emergencyPhone") || ""),
          allergies: athlete.allergies ?? "",
          medications: athlete.medications ?? "",
          medicalNotes: athlete.medicalNotes ?? "",
          imageAuthorized: athlete.imageAuthorized ?? false,
        }),
      });
      const payload = (await response.json()) as {
        athlete?: AthleteRecord;
        error?: string;
      };
      if (!response.ok || !payload.athlete) {
        throw new Error(payload.error || "Não foi possível salvar o atleta.");
      }
      onSaved(payload.athlete);

      if (selectedTeamId !== (currentTeam?.id ?? null)) {
        const teamResponse = await fetch(`/api/athletes/${athlete.id}/team`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: selectedTeamId }),
        });
        const teamPayload = (await teamResponse.json()) as { error?: string };
        if (!teamResponse.ok) {
          throw new Error(
            teamPayload.error || "Não foi possível atualizar a turma do atleta.",
          );
        }
        onTeamChanged();
      }

      notify("Dados do atleta atualizados.");
      onClose();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o atleta.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteAthlete() {
    if (
      !window.confirm(
        `Excluir ${athlete.name} da lista de atletas? O histórico será preservado.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch(`/api/athletes/${athlete.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível excluir o atleta.");
      }
      onDeleted(athlete.id);
      notify(`${athlete.name} foi excluído da lista.`);
      onClose();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o atleta.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="athlete-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="athlete-edit-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">CADASTRO DO ATLETA</span>
            <h2 id="athlete-edit-title">Editar atleta</h2>
            <p>Atualize os dados cadastrais e do responsável.</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <form onSubmit={saveAthlete}>
          <label className="wide">
            Nome completo
            <input name="name" defaultValue={athlete.name} required autoFocus />
          </label>
          <label>
            Data de nascimento
            <input
              name="birthDate"
              type="date"
              defaultValue={athlete.birthDate ?? ""}
            />
          </label>
          <label className="category-field">
            <span className="category-label">
              Categoria
              <button
                type="button"
                className="category-settings-button"
                onClick={onManageCategories}
                aria-label="Configurar categorias"
                title="Configurar categorias"
              >
                <Settings size={14} strokeWidth={1.75} />
              </button>
            </span>
            <select
              name="category"
              value={category}
              onChange={(event) => handleCategoryChange(event.target.value)}
            >
              {categories.map((option) => (
                <option key={option.id} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          <label className="wide">
            Turma
            <select
              name="teamId"
              value={selectedTeamId ?? ""}
              onChange={(event) => setSelectedTeamId(event.target.value || null)}
            >
              <option value="">Sem turma</option>
              {compatibleTeams.map((team) => {
                const isCurrent = team.id === currentTeam?.id;
                const isFull = team.players >= team.capacity && !isCurrent;
                return (
                  <option key={team.id} value={team.id} disabled={isFull}>
                    {team.name} · {team.scheduleDays.join("/")} {team.startTime}
                    –{team.endTime} · {team.players}/{team.capacity} ocupadas
                    {isFull ? " (cheia)" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          {categoryChangedAwayFromCurrentTeam && currentTeam && (
            <p className="wide form-warning">
              A turma atual pertence à categoria {currentTeam.category}. Ao
              alterar o atleta para {category}, ele precisará sair dessa
              turma. Selecione uma turma compatível com {category} acima ou
              mantenha &quot;Sem turma&quot;.
            </p>
          )}

          <AthleteFinancialSection
            athleteId={athlete.id}
            athleteCategory={category}
            notify={notify}
          />

          <label>
            Nome do responsável
            <input
              name="guardianName"
              defaultValue={athlete.guardianName ?? ""}
              required
            />
          </label>
          <label>
            CPF ou CNPJ
            <input
              name="guardianDocument"
              inputMode="numeric"
              defaultValue={athlete.guardianDocument ?? ""}
              placeholder="Somente números"
            />
          </label>
          <label>
            Telefone
            <input
              name="guardianPhone"
              type="tel"
              required
              inputMode="tel"
              autoComplete="tel"
              defaultValue={athlete.guardianPhone ?? ""}
              placeholder="(11) 99999-9999"
            />
          </label>
          <label>
            E-mail
            <input
              name="guardianEmail"
              type="email"
              defaultValue={athlete.guardianEmail ?? ""}
              placeholder="responsavel@email.com"
            />
          </label>
          <label>
            Contato de emergência
            <input
              name="emergencyName"
              defaultValue={athlete.emergencyName ?? ""}
            />
          </label>
          <label>
            Telefone de emergência
            <input
              name="emergencyPhone"
              type="tel"
              defaultValue={athlete.emergencyPhone ?? ""}
            />
          </label>

          <footer className="wide">
            <button
              type="button"
              className="archive-button"
              onClick={() => void deleteAthlete()}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir atleta"}
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
