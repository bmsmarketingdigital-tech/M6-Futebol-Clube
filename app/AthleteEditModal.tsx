"use client";

import { FormEvent, useState } from "react";
import type { AthleteRecord } from "./AthleteProfileModal";
import type { CategoryRecord } from "./CategoryManagerModal";

export function AthleteEditModal({
  athlete,
  categories,
  onClose,
  onSaved,
  onDeleted,
  notify,
}: {
  athlete: AthleteRecord;
  categories: CategoryRecord[];
  onClose: () => void;
  onSaved: (athlete: AthleteRecord) => void;
  onDeleted: (athleteId: string) => void;
  notify: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
          category: String(form.get("category") || ""),
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
            ×
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
          <label>
            Categoria
            <select name="category" defaultValue={athlete.category}>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
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
