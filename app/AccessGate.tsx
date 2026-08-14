"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { X } from "lucide-react";

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  fullName: string | null;
  role: "admin" | "operator";
  organizationId: string;
};

type AccessState =
  | { status: "loading"; user: null; needsSetup: false }
  | { status: "anonymous"; user: null; needsSetup: boolean }
  | { status: "authenticated"; user: SessionUser; needsSetup: false };

type LoginOrganization = { id: string; name: string };
type PendingLogin = {
  username: string;
  password: string;
  rememberMe: boolean;
};

function unitCardTitle(organization: LoginOrganization, index: number) {
  const normalized = organization.name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  if (normalized.includes("tenis")) return "Unidade Tênis Clube";
  if (normalized.includes("condominio") || normalized.includes("condom")) return "Unidade Condomínio";
  return index === 0 ? "Unidade Tênis Clube" : index === 1 ? "Unidade Condomínio" : organization.name;
}

function unitCardHint(organization: LoginOrganization, index: number) {
  const title = unitCardTitle(organization, index);
  if (title.includes("Tênis")) return "Alunos, turmas e financeiro da unidade Tênis Clube.";
  if (title.includes("Condomínio")) return "Alunos, turmas e financeiro da unidade Condomínio.";
  return "Acessar os cadastros separados desta unidade.";
}

export function AccessGate({
  children,
}: {
  children: (access: { user: SessionUser; signOut: () => Promise<void> }) => ReactNode;
}) {
  const [access, setAccess] = useState<AccessState>({
    status: "loading",
    user: null,
    needsSetup: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [organizations, setOrganizations] = useState<LoginOrganization[]>([]);
  const [pendingLogin, setPendingLogin] = useState<PendingLogin | null>(null);
  const [savedUsername, setSavedUsername] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem("m6_remembered_username") ?? "",
  );
  const [savedPassword, setSavedPassword] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem("m6_remembered_password") ?? "",
  );

  useEffect(() => {
    let active = true;
    const startedAt = Date.now();
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = (await response.json()) as {
          authenticated?: boolean;
          needsSetup?: boolean;
          user?: SessionUser;
        };
        const wait = Math.max(0, 1450 - (Date.now() - startedAt));
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        if (!active) return;
        if (response.ok && payload.authenticated && payload.user) {
          setAccess({ status: "authenticated", user: payload.user, needsSetup: false });
        } else {
          setAccess({ status: "anonymous", user: null, needsSetup: Boolean(payload.needsSetup) });
        }
      } catch {
        if (active) {
          setAccess({ status: "anonymous", user: null, needsSetup: false });
          setError("Não foi possível iniciar a sessão local. Reinicie o aplicativo.");
        }
      }
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const endpoint = access.status === "anonymous" && access.needsSetup
      ? "/api/auth/setup"
      : "/api/auth/login";
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const shouldRemember = form.get("rememberMe") === "on";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: String(form.get("displayName") || ""),
          username,
          password,
          rememberMe: shouldRemember,
        }),
      });
      const responseText = await response.text();
      let payload: { user?: SessionUser; error?: string; requiresOrganization?: boolean; organizations?: { id: string; name: string }[] } = {};
      try {
        payload = responseText ? (JSON.parse(responseText) as typeof payload) : {};
      } catch {
        throw new Error(`O servidor retornou uma resposta inválida (${response.status}).`);
      }
      if (payload.requiresOrganization && payload.organizations?.length) {
        setOrganizations(payload.organizations);
        setPendingLogin({ username, password, rememberMe: shouldRemember });
        setError("");
        return;
      }
      if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível entrar.");
      if (shouldRemember) {
        window.localStorage.setItem("m6_remembered_username", username);
        window.localStorage.setItem("m6_remembered_password", password);
        setSavedUsername(username);
        setSavedPassword(password);
      } else {
        window.localStorage.removeItem("m6_remembered_username");
        window.localStorage.removeItem("m6_remembered_password");
        setSavedUsername("");
        setSavedPassword("");
      }
      setAccess({ status: "authenticated", user: payload.user, needsSetup: false });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseOrganization(organizationId: string) {
    if (!pendingLogin) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: pendingLogin.username,
          password: pendingLogin.password,
          rememberMe: pendingLogin.rememberMe,
          organizationId,
        }),
      });
      const responseText = await response.text();
      let payload: { user?: SessionUser; error?: string } = {};
      try {
        payload = responseText ? (JSON.parse(responseText) as typeof payload) : {};
      } catch {
        throw new Error(`O servidor retornou uma resposta inválida (${response.status}).`);
      }
      if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível entrar nesta unidade.");
      if (pendingLogin.rememberMe) {
        window.localStorage.setItem("m6_remembered_username", pendingLogin.username);
        window.localStorage.setItem("m6_remembered_password", pendingLogin.password);
        setSavedUsername(pendingLogin.username);
        setSavedPassword(pendingLogin.password);
      } else {
        window.localStorage.removeItem("m6_remembered_username");
        window.localStorage.removeItem("m6_remembered_password");
        setSavedUsername("");
        setSavedPassword("");
      }
      setOrganizations([]);
      setPendingLogin(null);
      setAccess({ status: "authenticated", user: payload.user, needsSetup: false });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível entrar nesta unidade.");
    } finally {
      setSubmitting(false);
    }
  }

  function backToLogin() {
    setOrganizations([]);
    setPendingLogin(null);
    setError("");
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setOrganizations([]);
    setPendingLogin(null);
    setAccess({ status: "anonymous", user: null, needsSetup: false });
  }

  async function recoverPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("recoveryUsername") || "").trim();
    const password = String(form.get("recoveryPassword") || "");
    const confirmation = String(form.get("recoveryConfirmation") || "");
    setRecoveryError("");
    if (password !== confirmation) { setRecoveryError("As senhas não conferem."); return; }
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível redefinir a senha.");
      setRecoveryOpen(false);
      setError("Senha redefinida. Entre com a nova senha.");
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "Não foi possível redefinir a senha.");
    }
  }

  if (access.status === "loading") {
    return (
      <main className="system-splash" aria-label="Carregando sistema">
        <div className="splash-shade" />
        <div className="splash-brand">
          <span className="splash-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpeg" alt="" />
          </span>
          <div>
            <small>ESCOLA DE FUTEBOL</small>
            <strong>M6 FUTEBOL CLUBE</strong>
          </div>
        </div>
        <div className="splash-loading">
          <span>Preparando sua gestão esportiva</span>
          <div><i /></div>
          <small>Carregando dados, turmas e financeiro...</small>
        </div>
      </main>
    );
  }

  if (access.status === "anonymous") {
    const setup = access.needsSetup;
    if (!setup && pendingLogin && organizations.length > 0) {
      return (
        <main className="login-screen">
          <section className="login-visual" aria-hidden="true" />
          <section className="login-panel">
            <div className="login-card unit-picker-card">
              <header>
                <span className="login-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.jpeg" alt="M6 Futebol Clube" />
                </span>
                <div>
                  <small>M6 FUTEBOL CLUBE</small>
                  <strong>Gestão Esportiva</strong>
                </div>
              </header>
              <div className="login-heading">
                <span>ESCOLHA A UNIDADE</span>
                <h2>Onde você vai trabalhar agora?</h2>
                <p>Cada unidade tem seus próprios alunos, turmas e financeiro. O fluxo do sistema é o mesmo.</p>
              </div>
              <div className="unit-card-grid">
                {organizations.map((organization, index) => (
                  <button
                    key={organization.id}
                    type="button"
                    className="unit-card"
                    disabled={submitting}
                    onClick={() => void chooseOrganization(organization.id)}
                  >
                    <span className="unit-card-icon">{index + 1}</span>
                    <span>
                      <strong>{unitCardTitle(organization, index)}</strong>
                      <small>{unitCardHint(organization, index)}</small>
                    </span>
                  </button>
                ))}
              </div>
              {error && <div className="login-error">{error}</div>}
              <button type="button" className="unit-back-button" onClick={backToLogin} disabled={submitting}>
                Voltar para o login
              </button>
            </div>
          </section>
        </main>
      );
    }
    return (
      <main className="login-screen">
        <section className="login-visual" aria-hidden="true" />
        <section className="login-panel">
          <form className="login-card" onSubmit={submit}>
            <header>
              <span className="login-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.jpeg" alt="M6 Futebol Clube" />
              </span>
              <div>
                <small>M6 FUTEBOL CLUBE</small>
                <strong>Gestão Esportiva</strong>
              </div>
            </header>
            <div className="login-heading">
              <span>{setup ? "PRIMEIRO ACESSO" : "ÁREA RESTRITA"}</span>
              <h2>{setup ? "Configure o administrador" : "Bem-vindo de volta"}</h2>
              <p>{setup ? "Crie o acesso do responsável por administrar a escolinha." : "Entre com os dados cadastrados neste computador."}</p>
            </div>
            {setup && (
              <label>Nome do administrador<input name="displayName" required minLength={3} autoComplete="name" placeholder="Ex.: Bruno Martins" autoFocus /></label>
            )}
            <label>
              Usuário de acesso
              <input
                name="username"
                type="text"
                required
                minLength={3}
                autoComplete="username"
                defaultValue={setup ? "" : savedUsername}
                placeholder="Ex.: bruno"
                autoFocus={!setup}
              />
            </label>
            <label>
              Senha
              <span className="login-password-field">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete={setup ? "new-password" : "current-password"}
                  defaultValue={setup ? "" : savedPassword}
                  placeholder="Mínimo de 8 caracteres"
                />
                <button
                  type="button"
                  className="password-visibility"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.3A10.8 10.8 0 0112 4c5.5 0 9 5.3 9 5.3a16 16 0 01-2.1 2.6M6.2 6.2A16.8 16.8 0 003 9.3s3.5 5.3 9 5.3c1 0 2-.2 2.9-.5" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 12s3.5-5.3 9-5.3 9 5.3 9 5.3-3.5 5.3-9 5.3S3 12 3 12z" />
                      <circle cx="12" cy="12" r="2.4" />
                    </svg>
                  )}
                </button>
              </span>
            </label>
            <label className="login-remember">
              <input
                name="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              <span>
                <strong>Lembrar-me</strong>
                <small>Manter o acesso neste computador</small>
              </span>
            </label>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Verificando..." : setup ? "Criar acesso e entrar" : "Entrar no sistema"}
            </button>
            <footer>Dados protegidos neste computador</footer>
          </form>
          {recoveryOpen && <div className="login-recovery-backdrop"><form className="login-recovery-card" role="dialog" aria-modal="true" aria-labelledby="login-recovery-title" onSubmit={recoverPassword}><button type="button" className="login-recovery-close" onClick={() => setRecoveryOpen(false)} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button><span className="eyebrow">RECUPERAÇÃO DE ACESSO</span><h3 id="login-recovery-title">Redefinir senha</h3><p>Essa alteração vale somente para este computador.</p><label>Usuário<input name="recoveryUsername" defaultValue={savedUsername} required /></label><label>Nova senha<input name="recoveryPassword" type="password" minLength={8} required /></label><label>Confirmar nova senha<input name="recoveryConfirmation" type="password" minLength={8} required /></label>{recoveryError && <div className="login-error">{recoveryError}</div>}<button type="submit">Salvar nova senha</button></form></div>}
        </section>
      </main>
    );
  }

  return children({ user: access.user, signOut });
}
