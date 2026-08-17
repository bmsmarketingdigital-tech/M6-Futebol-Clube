"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Plus, ShieldCheck, UserCheck, Users, X } from "lucide-react";
import { readApiResponse } from "./api-response";

type UserRole = "admin" | "operator";

type ManagedUser = {
  id: string;
  displayName: string;
  username: string;
  role: UserRole;
  createdAt: number;
  isCurrent: boolean;
};

export function UserManagement({
  notify,
  onBack,
}: {
  notify: (message: string) => void;
  onBack: () => void;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const payload = await readApiResponse<{ users?: ManagedUser[] }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os usuários.");
      setUsers(payload.users ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadUsers]);

  const adminCount = useMemo(
    () => users.filter((user) => user.role === "admin").length,
    [users],
  );
  const operatorCount = users.length - adminCount;

  function openNewUser() {
    setEditing(null);
    setError("");
    setModalOpen(true);
  }

  function openEditUser(user: ManagedUser) {
    setEditing(user);
    setError("");
    setModalOpen(true);
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      displayName: String(form.get("displayName") || ""),
      username: String(form.get("username") || ""),
      role: String(form.get("role") || "operator"),
      password: String(form.get("password") || ""),
    };
    try {
      const response = await fetch(editing ? `/api/users/${editing.id}` : "/api/users", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readApiResponse<{ user?: ManagedUser }>(response);
      if (!response.ok || !result.user) {
        throw new Error(result.error || "Não foi possível salvar o usuário.");
      }
      setModalOpen(false);
      setEditing(null);
      if (result.user.isCurrent) {
        window.location.reload();
        return;
      }
      await loadUsers();
      notify(editing ? "Usuário e permissões atualizados." : "Novo usuário criado com sucesso.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser() {
    if (!deleteTarget) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/users/${deleteTarget.id}`, { method: "DELETE" });
      const payload = await readApiResponse<{ deleted?: boolean }>(response);
      if (!response.ok || !payload.deleted) {
        throw new Error(payload.error || "Não foi possível excluir o usuário.");
      }
      setDeleteTarget(null);
      await loadUsers();
      notify("Usuário removido do sistema.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o usuário.");
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="users-management">
      <div className="section-heading section-heading-with-back users-heading">
        <button type="button" className="section-back-button" onClick={onBack} aria-label="Voltar para o início"><ArrowLeft size={20} strokeWidth={2} /></button>
        <div>
          <span className="eyebrow">SEGURANÇA E ACESSO</span>
          <h1>Usuários e permissões</h1>
          <p>Controle quem pode acessar o sistema e quais módulos cada pessoa pode utilizar.</p>
        </div>
        <button className="primary-button" onClick={openNewUser}><Plus size={16} strokeWidth={2} /> Novo usuário</button>
      </div>

      <div className="user-metrics">
        <article>
          <span className="user-metric-icon admin"><ShieldCheck size={19} strokeWidth={1.75} /></span>
          <div><small>ADMINISTRADORES</small><strong>{adminCount}</strong><p>Acesso completo ao sistema</p></div>
        </article>
        <article>
          <span className="user-metric-icon operator"><UserCheck size={19} strokeWidth={1.75} /></span>
          <div><small>OPERADORES</small><strong>{operatorCount}</strong><p>Operação sem dados financeiros</p></div>
        </article>
        <article>
          <span className="user-metric-icon total"><Users size={19} strokeWidth={1.75} /></span>
          <div><small>USUÁRIOS ATIVOS</small><strong>{users.length}</strong><p>Acessos cadastrados neste computador</p></div>
        </article>
      </div>

      <div className="card users-card">
        <header>
          <div><h2>Acessos cadastrados</h2><p>Senhas são protegidas e nunca ficam visíveis nesta tela.</p></div>
          <span>{users.length} usuário(s)</span>
        </header>

        <div className="permissions-explainer">
          <div><b>Administrador</b><span>Todos os módulos, Financeiro e gestão de usuários.</span></div>
          <div><b>Operador</b><span>Atletas, turmas, presença, QR Codes, treinos, avaliações e comunicação.</span></div>
        </div>

        {error && <div className="users-error" role="alert">{error}</div>}
        {loading ? (
          <div className="users-loading">Carregando usuários...</div>
        ) : (
          <div className="users-list">
            {users.map((user) => (
              <article key={user.id}>
                <span className={`user-avatar ${user.role}`}>
                  {user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                </span>
                <div className="user-identity">
                  <strong>{user.displayName}{user.isCurrent && <em>Você</em>}</strong>
                  <small>@{user.username}</small>
                </div>
                <span className={`role-badge ${user.role}`}>
                  {user.role === "admin" ? "Administrador" : "Operador"}
                </span>
                <div className="user-access-summary">
                  <strong>{user.role === "admin" ? "Acesso completo" : "Financeiro bloqueado"}</strong>
                  <small>{user.role === "admin" ? "Pode gerenciar usuários e permissões" : "Pode operar a rotina da escolinha"}</small>
                </div>
                <button className="user-edit-button" onClick={() => openEditUser(user)}>Editar</button>
                {!user.isCurrent && (
                  <button className="user-delete-button" onClick={() => setDeleteTarget(user)} aria-label={`Excluir ${user.displayName}`}><X size={14} strokeWidth={1.75} /></button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}>
          <form className="user-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title" onSubmit={saveUser} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">{editing ? "EDITAR ACESSO" : "NOVO ACESSO"}</span>
                <h2 id="user-modal-title">{editing ? "Usuário e permissões" : "Criar usuário"}</h2>
                <p>Defina os dados de entrada e o nível de acesso.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button>
            </header>
            <div className="user-modal-body">
              <label>Nome completo<input name="displayName" required minLength={3} defaultValue={editing?.displayName ?? ""} placeholder="Ex.: João da Silva" /></label>
              <label>Usuário de acesso<input name="username" required minLength={3} defaultValue={editing?.username ?? ""} placeholder="Ex.: joao" /></label>
              <label>
                Perfil de permissão
                <select name="role" defaultValue={editing?.role ?? "operator"}>
                  <option value="operator">Operador — sem Financeiro</option>
                  <option value="admin">Administrador — acesso completo</option>
                </select>
              </label>
              <label>
                {editing ? "Nova senha (opcional)" : "Senha provisória"}
                <input name="password" type="password" minLength={8} required={!editing} autoComplete="new-password" placeholder={editing ? "Deixe em branco para manter" : "Mínimo de 8 caracteres"} />
              </label>
              <div className="permission-preview">
                <span><CheckCircle2 size={18} strokeWidth={1.75} /></span>
                <p><strong>O bloqueio é aplicado no menu e no servidor.</strong><small>O operador não consegue abrir dados financeiros por endereço direto.</small></p>
              </div>
              {error && <div className="users-error" role="alert">{error}</div>}
            </div>
            <footer>
              <button type="button" className="filter-button" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button className="primary-button" disabled={saving}>{saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar usuário"}</button>
            </footer>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}>
          <div className="user-delete-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <span>!</span>
            <h2>Excluir usuário?</h2>
            <p><strong>{deleteTarget.displayName}</strong> perderá imediatamente o acesso ao sistema.</p>
            <footer>
              <button className="filter-button" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button className="danger-button" onClick={() => void deleteUser()} disabled={saving}>Excluir usuário</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
