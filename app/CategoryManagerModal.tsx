"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";

export type CategoryRecord = {
  id: string;
  name: string;
  sortOrder: number;
};

export function CategoryManagerModal({
  categories,
  onChanged,
  onClose,
  notify,
}: {
  categories: CategoryRecord[];
  onChanged: (categories: CategoryRecord[]) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((category) => [category.id, category.name])),
  );
  const [busyId, setBusyId] = useState("");

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusyId("new");
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as {
        category?: CategoryRecord;
        error?: string;
      };
      if (!response.ok || !payload.category) {
        throw new Error(payload.error || "Não foi possível incluir a categoria.");
      }
      const next = [...categories, payload.category].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      setDrafts((current) => ({
        ...current,
        [payload.category!.id]: payload.category!.name,
      }));
      onChanged(next);
      setNewName("");
      notify("Categoria incluída.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível incluir a categoria.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function saveCategory(category: CategoryRecord) {
    const name = (drafts[category.id] ?? "").trim();
    if (!name || name === category.name) return;
    setBusyId(category.id);
    try {
      const response = await fetch(`/api/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as {
        category?: CategoryRecord;
        error?: string;
      };
      if (!response.ok || !payload.category) {
        throw new Error(payload.error || "Não foi possível editar a categoria.");
      }
      onChanged(
        categories.map((item) =>
          item.id === category.id ? payload.category! : item,
        ),
      );
      notify("Categoria atualizada em atletas e turmas.");
    } catch (error) {
      setDrafts((current) => ({ ...current, [category.id]: category.name }));
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível editar a categoria.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function deleteCategory(category: CategoryRecord) {
    if (!window.confirm(`Excluir a categoria ${category.name}?`)) return;
    setBusyId(category.id);
    try {
      const response = await fetch(`/api/categories/${category.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível excluir a categoria.");
      }
      onChanged(categories.filter((item) => item.id !== category.id));
      notify("Categoria excluída.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir a categoria.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <div
      className="category-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="category-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">CONFIGURAÇÃO</span>
            <h2 id="category-modal-title">Categorias dos atletas</h2>
            <p>Inclua, renomeie ou exclua categorias que não estejam em uso.</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <form className="category-create" onSubmit={addCategory}>
          <label>
            Nova categoria
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: Sub-19 ou Feminino"
              maxLength={32}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={busyId === "new" || newName.trim().length < 2}
          >
            {busyId === "new" ? "Incluindo..." : "Incluir"}
          </button>
        </form>

        <div className="category-list">
          {categories.map((category) => {
            const changed =
              (drafts[category.id] ?? category.name).trim() !== category.name;
            return (
              <div className="category-row" key={category.id}>
                <input
                  aria-label={`Nome da categoria ${category.name}`}
                  value={drafts[category.id] ?? category.name}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [category.id]: event.target.value,
                    }))
                  }
                  maxLength={32}
                />
                <button
                  type="button"
                  className="category-save"
                  disabled={!changed || busyId === category.id}
                  onClick={() => void saveCategory(category)}
                >
                  {busyId === category.id ? "..." : "Salvar"}
                </button>
                <button
                  type="button"
                  className="category-delete"
                  disabled={busyId === category.id}
                  onClick={() => void deleteCategory(category)}
                  aria-label={`Excluir ${category.name}`}
                  title="Excluir categoria"
                >
                  Excluir
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
