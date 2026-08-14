"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AthleteProfileModal,
  type AthleteRecord,
} from "./AthleteProfileModal";
import {
  AttendanceModal,
  TeamModal,
  type TeamRecord,
} from "./TeamManagement";
import { FinanceManagement } from "./FinanceManagement";
import CombosManagement from "./CombosManagement";
import { EvaluationManagement } from "./EvaluationManagement";
import { TrainingManagement } from "./TrainingManagement";
import { CommunicationManagement } from "./CommunicationManagement";
import { CheckInManagement } from "./CheckInManagement";
import {
  CategoryManagerModal,
  type CategoryRecord,
} from "./CategoryManagerModal";
import { AthleteEditModal } from "./AthleteEditModal";
import { AccessGate, type SessionUser } from "./AccessGate";
import { LicenseWidget } from "./LicenseWidget";
import { UserManagement } from "./UserManagement";
import {
  type LucideIcon,
  Home as HomeIcon,
  Users,
  LayoutGrid,
  CheckSquare,
  QrCode,
  Wallet,
  Dumbbell,
  TrendingUp,
  MessageCircle,
  ChevronUp,
  ChevronDown,
  Search,
  HelpCircle,
  Bell,
  MoreVertical,
  CheckCircle2,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Sun,
  Contrast,
  Moon,
  Settings,
  Plus,
  UserPlus,
  X,
} from "lucide-react";
import { useTheme } from "./useTheme";

type Section =
  | "Visão geral"
  | "Atletas"
  | "Prontuário"
  | "Turmas"
  | "Presença"
  | "Cartões QR"
  | "QR e entrada"
  | "Financeiro"
  | "Mensalidades"
  | "Planos"
  | "Combos"
  | "Controle de gastos"
  | "Treinos"
  | "Avaliações"
  | "Comunicação"
  | "Usuários e permissões";

type Athlete = AthleteRecord;

type FinanceOverview = {
  receivedCents: number;
  pendingCents: number;
  overdueCents: number;
  expectedCents: number;
  paidCount: number;
  overdueCount: number;
  openCount: number;
  openCents: number;
  dueTodayCount: number;
  dueTodayCents: number;
  dueSoonCount: number;
  dueSoonCents: number;
  totalOverdueCount: number;
  totalOverdueCents: number;
  collectionRate: number;
};

type DashboardSummary = {
  revenueLast12Months: { month: string; receivedCents: number }[];
  evaluations: { total: number; lastEvaluationDate: string | null };
  nextCommunication: { title: string; scheduledAt: string | null } | null;
  documents: { total: number };
};

const navItems: { label: Section; icon: LucideIcon }[] = [
  { label: "Visão geral", icon: HomeIcon },
  { label: "Atletas", icon: Users },
  { label: "Turmas", icon: LayoutGrid },
  { label: "Presença", icon: CheckSquare },
  { label: "Cartões QR", icon: QrCode },
  { label: "Financeiro", icon: Wallet },
  { label: "Treinos", icon: Dumbbell },
  { label: "Avaliações", icon: TrendingUp },
  { label: "Comunicação", icon: MessageCircle },
];

const sectionPageClasses: Record<Exclude<Section, "Visão geral">, string> = {
  Atletas: "athletes-page",
  Prontuário: "records-page",
  Turmas: "teams-page",
  Presença: "attendance-page",
  "Cartões QR": "checkin-page",
  "QR e entrada": "checkin-page",
  Financeiro: "finance-page",
  Mensalidades: "finance-page",
  Planos: "finance-page",
  Combos: "finance-page",
  "Controle de gastos": "finance-page expenses-page",
  Treinos: "trainings-page",
  Avaliações: "evaluations-page",
  Comunicação: "communications-page",
  "Usuários e permissões": "users-page",
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "AD";
}

export default function Home() {
  return (
    <AccessGate>
      {({ user, signOut }) => (
        <ManagementApp user={user} onSignOut={signOut} />
      )}
    </AccessGate>
  );
}

function ManagementApp({ user, onSignOut }: { user: SessionUser; onSignOut: () => Promise<void> }) {
  useEffect(() => {
    const uppercaseText = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.dataset.preserveCase === "true" || target.closest("[data-preserve-case='true']")) return;
      if (["password", "email", "date", "datetime-local", "month", "time", "number", "tel"].includes(target.type)) return;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const upper = target.value.toLocaleUpperCase("pt-BR");
      if (upper === target.value) return;
      target.value = upper;
      if (start !== null && end !== null) target.setSelectionRange(start, end);
    };
    document.addEventListener("input", uppercaseText, true);
    return () => document.removeEventListener("input", uppercaseText, true);
  }, []);

  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<Section>("Visão geral");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [search, setSearch] = useState("");
  const [showAthleteModal, setShowAthleteModal] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [athletesMenuOpen, setAthletesMenuOpen] = useState(false);
  const [financeMenuOpen, setFinanceMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [profileAthlete, setProfileAthlete] = useState<Athlete | null>(null);
  const [qrAthlete, setQrAthlete] = useState<Athlete | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRecord | null>(null);
  const [attendanceTeam, setAttendanceTeam] = useState<TeamRecord | null>(null);
  const [toast, setToast] = useState("");
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [savingAthlete, setSavingAthlete] = useState(false);
  const [newAthleteCategory, setNewAthleteCategory] = useState("");
  const [newAthleteTeamId, setNewAthleteTeamId] = useState("");
  const [teamPreview, setTeamPreview] = useState<TeamRecord | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({
    revenueLast12Months: [],
    evaluations: { total: 0, lastEvaluationDate: null },
    nextCommunication: null,
    documents: { total: 0 },
  });
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview>({
    receivedCents: 0,
    pendingCents: 0,
    overdueCents: 0,
    expectedCents: 0,
    paidCount: 0,
    overdueCount: 0,
    openCount: 0,
    openCents: 0,
    dueTodayCount: 0,
    dueTodayCents: 0,
    dueSoonCount: 0,
    dueSoonCents: 0,
    totalOverdueCount: 0,
    totalOverdueCents: 0,
    collectionRate: 0,
  });

  const loadAthletes = useCallback(async () => {
    setLoadingAthletes(true);
    setLoadError("");
    try {
      const response = await fetch("/api/athletes", {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as {
        athletes?: Athlete[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar os atletas.");
      }
      setAthletes(payload.athletes ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os atletas.",
      );
    } finally {
      setLoadingAthletes(false);
    }
  }, []);

  const loadTeams = useCallback(async () => {
    setLoadingTeams(true);
    try {
      const response = await fetch("/api/teams", {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as {
        teams?: TeamRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar as turmas.");
      }
      setTeams(payload.teams ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as turmas.",
      );
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch("/api/categories", {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as {
        categories?: CategoryRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar as categorias.");
      }
      setCategories(payload.categories ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as categorias.",
      );
    }
  }, []);

  const loadFinanceOverview = useCallback(async () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const response = await fetch(`/api/finance/summary?month=${month}`);
      const payload = (await response.json()) as {
        summary?: FinanceOverview;
      };
      if (response.ok && payload.summary) setFinanceOverview(payload.summary);
    } catch {
      // O módulo financeiro exibe o erro completo quando for aberto.
    }
  }, []);

  const loadDashboardSummary = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/summary");
      const payload = (await response.json()) as Partial<DashboardSummary>;
      if (response.ok) {
        setDashboardSummary({
          revenueLast12Months: payload.revenueLast12Months ?? [],
          evaluations: payload.evaluations ?? { total: 0, lastEvaluationDate: null },
          nextCommunication: payload.nextCommunication ?? null,
          documents: payload.documents ?? { total: 0 },
        });
      }
    } catch {
      // Painel mostra estado vazio quando a agregação falha; não há fallback fictício.
    }
  }, []);

  const checkReminders = useCallback(async () => {
    try {
      await fetch("/api/reminders", { method: "GET" });
    } catch {
      // Consulta somente leitura; o scheduler interno processa os lembretes.
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAthletes();
      void loadTeams();
      void loadCategories();
      if (user.role === "admin") void loadFinanceOverview();
      void loadDashboardSummary();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadAthletes, loadCategories, loadDashboardSummary, loadFinanceOverview, loadTeams, user.role]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void checkReminders(), 0);
    const interval = window.setInterval(
      () => void checkReminders(),
      30 * 60 * 1000,
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [checkReminders]);

  useEffect(() => {
    if (section !== "QR e entrada") return;
    const timeout = window.setTimeout(() => setSection("Cartões QR"), 0);
    return () => window.clearTimeout(timeout);
  }, [section]);

  const filteredAthletes = useMemo(
    () =>
      athletes.filter((athlete) =>
        `${athlete.name} ${athlete.category}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [athletes, search],
  );
  const currentNewAthleteCategory =
    newAthleteCategory || categories[0]?.name || "";
  const compatibleNewAthleteTeams = useMemo(
    () => teams.filter((team) => team.category === currentNewAthleteCategory),
    [currentNewAthleteCategory, teams],
  );
  const selectedNewAthleteTeamId = compatibleNewAthleteTeams.some(
    (team) => team.id === newAthleteTeamId,
  )
    ? newAthleteTeamId
    : compatibleNewAthleteTeams[0]?.id || "";
  const selectedNewAthleteTeam =
    compatibleNewAthleteTeams.find((team) => team.id === selectedNewAthleteTeamId) || null;

  function closeAthleteModal() {
    setShowAthleteModal(false);
    setTeamPreview(null);
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function addAthlete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") || "Novo atleta");
    const category = String(form.get("category") || "Sub-11");
    setSavingAthlete(true);

    try {
      const response = await fetch("/api/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          age: Number(form.get("age")),
          guardianName: String(form.get("guardian") || ""),
          guardianPhone: String(form.get("guardianPhone") || ""),
          teamId: String(form.get("teamId") || ""),
        }),
      });
      const payload = (await response.json()) as {
        athlete?: Athlete;
        enrolledTeamId?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.athlete) {
        throw new Error(payload.error || "Não foi possível cadastrar o atleta.");
      }

      setAthletes((current) => [payload.athlete!, ...current]);
      if (payload.enrolledTeamId) {
        setTeams((current) =>
          current.map((team) =>
            team.id === payload.enrolledTeamId
              ? {
                  ...team,
                  athleteIds: [...team.athleteIds, payload.athlete!.id],
                  players: team.players + 1,
                }
              : team,
          ),
        );
      }
      formElement.reset();
      closeAthleteModal();
      setQrAthlete(payload.athlete);
      notify(`${name} foi cadastrado e o QR Code individual já está pronto.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar o atleta.",
      );
    } finally {
      setSavingAthlete(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpeg" alt="Escola de Futebol M6 Futebol Clube" />
          </span>
          <span>
            <strong>M6 Futebol Clube</strong>
            <small>ESCOLA DE FUTEBOL</small>
          </span>
        </div>

        <nav aria-label="Navegação principal">
          <p className="nav-label">GESTÃO</p>
          {navItems.slice(0, 6).filter((item) => user.role === "admin" || item.label !== "Financeiro").map((item) =>
            item.label === "Atletas" ? (
              <div className="nav-group" key={item.label}>
                <button
                  className={
                    section === "Atletas" || section === "Prontuário"
                      ? "nav-item expanded"
                      : "nav-item"
                  }
                  onClick={() => {
                    const isAthleteSection =
                      section === "Atletas" || section === "Prontuário";
                    setSection("Atletas");
                    setFinanceMenuOpen(false);
                    setAthletesMenuOpen((current) =>
                      isAthleteSection ? !current : true,
                    );
                  }}
                  aria-expanded={athletesMenuOpen}
                >
                  <span className="nav-icon"><item.icon size={18} strokeWidth={1.75} /></span>
                  Atletas
                  <span className="nav-chevron">
                    {athletesMenuOpen ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
                  </span>
                </button>
                {athletesMenuOpen && (
                  <div className="nav-group-items">
                    <button
                      className={
                        section === "Prontuário"
                          ? "nav-subitem active"
                          : "nav-subitem"
                      }
                      onClick={() => setSection("Prontuário")}
                    >
                      <span />
                      Prontuário
                    </button>
                  </div>
                )}
              </div>
            ) : item.label === "Financeiro" ? (
              <div className="nav-group" key={item.label}>
                <button
                  className={
                        section === "Financeiro" || section === "Mensalidades" || section === "Planos" || section === "Combos" || section === "Controle de gastos"
                      ? "nav-item expanded"
                      : "nav-item"
                  }
                  onClick={() => {
                    const isFinanceSection =
                      section === "Financeiro" || section === "Mensalidades" || section === "Planos" || section === "Combos" || section === "Controle de gastos";
                    setSection("Mensalidades");
                    setAthletesMenuOpen(false);
                    setFinanceMenuOpen((current) =>
                      isFinanceSection ? !current : true,
                    );
                  }}
                  aria-expanded={financeMenuOpen}
                >
                  <span className="nav-icon"><item.icon size={18} strokeWidth={1.75} /></span>
                  Financeiro
                        {financeOverview.totalOverdueCount > 0 && (
                          <span className="nav-badge">
                            {financeOverview.totalOverdueCount}
                          </span>
                        )}
                  <span className="nav-chevron">
                    {financeMenuOpen ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
                  </span>
                </button>
                {financeMenuOpen && (
                  <div className="nav-group-items">
                    <button
                      className={
                        section === "Mensalidades" || section === "Financeiro"
                          ? "nav-subitem active"
                          : "nav-subitem"
                      }
                      onClick={() => setSection("Mensalidades")}
                    >
                      <span />
                      Mensalidades
                    </button>
                    <button
                      className={section === "Controle de gastos" ? "nav-subitem active" : "nav-subitem"}
                      onClick={() => setSection("Controle de gastos")}
                    >
                      <span />
                      Controle de gastos
                    </button>
                    <button
                      className={
                        section === "Planos" ? "nav-subitem active" : "nav-subitem"
                      }
                      onClick={() => setSection("Planos")}
                    >
                      <span />
                      Planos
                    </button>
                    <button className={section === "Combos" ? "nav-subitem active" : "nav-subitem"} onClick={() => setSection("Combos")}><span />Combos</button>
                  </div>
                )}
              </div>
            ) : (
              <button
                key={item.label}
                className={
                  section === item.label ? "nav-item active" : "nav-item"
                }
                onClick={() => setSection(item.label)}
              >
                <span className="nav-icon"><item.icon size={18} strokeWidth={1.75} /></span>
                {item.label}
              </button>
            ),
          )}
          <p className="nav-label second">DESENVOLVIMENTO</p>
          {navItems.slice(6).map((item) => (
            <button
              key={item.label}
              className={section === item.label ? "nav-item active" : "nav-item"}
              onClick={() => setSection(item.label)}
            >
              <span className="nav-icon"><item.icon size={18} strokeWidth={1.75} /></span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-profile">
          <span className="avatar">{initials(user.displayName)}</span>
          <span>
            <strong>{user.displayName}</strong>
            <small>{user.role === "admin" ? "Administrador" : "Operador"}</small>
          </span>
          <button aria-label="Mais opções" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((current) => !current)}><MoreVertical size={16} strokeWidth={1.75} /></button>
          {profileMenuOpen && (
            <div className="profile-menu">
              <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
              {user.role === "admin" && (
                <button
                  type="button"
                  className="profile-settings"
                  onClick={() => {
                    setSection("Usuários e permissões");
                    setProfileMenuOpen(false);
                  }}
                >
                  Usuários e permissões
                </button>
              )}
              <button type="button" onClick={() => void onSignOut()}>Sair do sistema</button>
            </div>
          )}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setSection("Visão geral")} aria-label="Página inicial">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpeg" alt="Escola de Futebol M6 Futebol Clube" />
          </button>
          <label className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              aria-label="Buscar no sistema"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar atleta, turma ou responsável..."
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <span className={loadingAthletes || loadingTeams ? "sync-status loading" : "sync-status"}>
              <i /> {loadingAthletes || loadingTeams ? "Sincronizando" : "Dados salvos"}
            </span>
            <LicenseWidget />
            <div className="theme-picker" role="radiogroup" aria-label="Tema do sistema">
              <button
                type="button"
                role="radio"
                aria-checked={theme === "light"}
                className={theme === "light" ? "theme-picker-option active" : "theme-picker-option"}
                aria-label="Tema claro"
                title="Claro"
                onClick={() => setTheme("light")}
              >
                <Sun size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={theme === "mid"}
                className={theme === "mid" ? "theme-picker-option active" : "theme-picker-option"}
                aria-label="Tema intermediário"
                title="Intermediário"
                onClick={() => setTheme("mid")}
              >
                <Contrast size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={theme === "dark"}
                className={theme === "dark" ? "theme-picker-option active" : "theme-picker-option"}
                aria-label="Tema escuro"
                title="Escuro"
                onClick={() => setTheme("dark")}
              >
                <Moon size={15} strokeWidth={1.75} />
              </button>
            </div>
            <button className="icon-button" aria-label="Ajuda"><HelpCircle size={18} strokeWidth={1.75} /></button>
            <button className="icon-button notification" aria-label="Notificações"><Bell size={18} strokeWidth={1.75} /></button>
          </div>
        </header>

        <div
          className={
            section === "Visão geral"
              ? "page-content dashboard-page"
              : `page-content section-page ${sectionPageClasses[section]}`
          }
        >
          {loadError && (
            <div className="load-alert" role="alert">
              <span>!</span>
              <div>
                <strong>Não foi possível sincronizar os dados</strong>
                <small>{loadError}</small>
              </div>
              <button onClick={() => void loadAthletes()}>Tentar novamente</button>
            </div>
          )}
          {section === "Visão geral" ? (
            <Dashboard
              athletes={filteredAthletes}
              categories={categories}
              setSection={setSection}
              teams={teams}
              onAttendance={setAttendanceTeam}
              onOpenTeam={(team) => {
                setEditingTeam(team);
                setTeamModalOpen(true);
              }}
              onOpenAthlete={setProfileAthlete}
              finance={financeOverview}
              summary={dashboardSummary}
              canViewFinance={user.role === "admin"}
              userName={user.displayName}
            />
          ) : section === "Combos" ? (
            <CombosManagement athletes={athletes} notify={notify} />
          ) : section === "Financeiro" || section === "Mensalidades" || section === "Planos" || section === "Controle de gastos" ? (
            <FinanceManagement
              view={section === "Planos" ? "plans" : section === "Controle de gastos" ? "expenses" : "overview"}
              athletes={athletes}
              notify={notify}
              onChanged={() => {
                void loadAthletes();
                void loadFinanceOverview();
              }}
              onOpenPlans={() => setSection("Planos")}
            />
          ) : section === "Avaliações" ? (
            <EvaluationManagement athletes={filteredAthletes} notify={notify} />
          ) : section === "Treinos" ? (
            <TrainingManagement teams={teams} notify={notify} />
          ) : section === "Comunicação" ? (
            <CommunicationManagement teams={teams} notify={notify} />
          ) : section === "Usuários e permissões" && user.role === "admin" ? (
            <UserManagement notify={notify} />
          ) : section === "Cartões QR" || section === "QR e entrada" ? (
            <CheckInManagement
              teams={teams}
              notify={notify}
            />
          ) : (
            <SectionView
              key={section}
              section={section}
              athletes={athletes}
              categories={categories}
              teams={teams}
              setShowAthleteModal={setShowAthleteModal}
              onNewTeam={() => {
                setEditingTeam(null);
                setTeamModalOpen(true);
              }}
              onOpenTeam={(team) => {
                setEditingTeam(team);
                setTeamModalOpen(true);
              }}
              onAttendance={setAttendanceTeam}
              onOpenAthlete={
                section === "Atletas" ? setEditingAthlete : setProfileAthlete
              }
              onOpenQr={setQrAthlete}
              canViewFinance={user.role === "admin"}
              notify={notify}
            />
          )}
        </div>
      </section>

      {showAthleteModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeAthleteModal}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-athlete-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={closeAthleteModal} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button>
            {teamPreview && (
              <div className="modal-backdrop" role="presentation" onMouseDown={() => setTeamPreview(null)}>
                <div className="modal team-preview-modal" role="dialog" aria-modal="true" aria-labelledby="team-preview-title" onMouseDown={(event) => event.stopPropagation()}>
                  <button className="modal-close" onClick={() => setTeamPreview(null)} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button>
                  <span className="eyebrow">{teamPreview.category}</span>
                  <h2 id="team-preview-title">{teamPreview.name}</h2>
                  <div className="team-preview-details">
                    <p><strong>Dias:</strong> {teamPreview.scheduleDays.join(", ") || "—"}</p>
                    <p><strong>Horário:</strong> {teamPreview.startTime} às {teamPreview.endTime}</p>
                    <p><strong>Local:</strong> {teamPreview.place || "—"}</p>
                    <p><strong>Professor:</strong> {teamPreview.coachName || "—"}</p>
                    <p><strong>Vagas:</strong> {teamPreview.players}/{teamPreview.capacity}</p>
                  </div>
                </div>
              </div>
            )}
            <span className="eyebrow">NOVO CADASTRO</span>
            <h2 id="new-athlete-title">Adicionar atleta</h2>
            <p>Comece com os dados essenciais. O responsável poderá completar o perfil depois.</p>
            <form onSubmit={addAthlete}>
              <label>Nome completo<input name="name" required placeholder="Ex.: Matheus Oliveira" autoFocus /></label>
              <div className="form-row">
                <label>Idade<input name="age" type="number" min="4" max="18" required placeholder="10" /></label>
                <label className="category-field">
                  <span className="category-label">
                    Categoria
                    <button
                      type="button"
                      className="category-settings-button"
                      onClick={() => setCategoryManagerOpen(true)}
                      aria-label="Configurar categorias"
                      title="Configurar categorias"
                    >
                      <Settings size={14} strokeWidth={1.75} />
                    </button>
                  </span>
                  <select
                    name="category"
                    value={currentNewAthleteCategory}
                    onChange={(event) => setNewAthleteCategory(event.target.value)}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {compatibleNewAthleteTeams.length > 0 ? (
                <label className="category-field">
                  <span className="category-label">
                    Turma
                    <button
                      type="button"
                      className="category-settings-button"
                      onClick={() => selectedNewAthleteTeam && setTeamPreview(selectedNewAthleteTeam)}
                      disabled={!selectedNewAthleteTeam}
                      aria-label="Ver horários e vagas da turma"
                      title="Ver horários e vagas da turma"
                    >
                      <Plus size={14} strokeWidth={1.75} />
                    </button>
                  </span>
                  <select
                    name="teamId"
                    required
                    value={selectedNewAthleteTeamId}
                    onChange={(event) => setNewAthleteTeamId(event.target.value)}
                  >
                    {compatibleNewAthleteTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} · {team.startTime} · {team.players}/{team.capacity} vagas
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="field-hint">
                  Não há turma ativa nesta categoria. O atleta será cadastrado sem turma.
                </p>
              )}
              <label>Responsável<input name="guardian" required placeholder="Nome do responsável" /></label>
              <label>Telefone do responsável<input name="guardianPhone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" /></label>
              <button className="primary-button full" type="submit" disabled={savingAthlete || categories.length === 0}>
                {savingAthlete ? "Salvando..." : "Cadastrar e salvar atleta"}
              </button>
            </form>
          </div>
        </div>
      )}

      {editingAthlete && (
        <AthleteEditModal
          key={editingAthlete.id}
          athlete={editingAthlete}
          categories={categories}
          teams={teams}
          onClose={() => setEditingAthlete(null)}
          onSaved={(updated) => {
            setAthletes((current) =>
              current.map((athlete) =>
                athlete.id === updated.id ? updated : athlete,
              ),
            );
          }}
          onDeleted={(athleteId) => {
            setAthletes((current) =>
              current.filter((athlete) => athlete.id !== athleteId),
            );
          }}
          onTeamChanged={() => void loadTeams()}
          notify={notify}
        />
      )}

      {profileAthlete && (
        <AthleteProfileModal
          key={profileAthlete.id}
          athlete={profileAthlete}
          categories={categories}
          onClose={() => setProfileAthlete(null)}
          onSaved={(updated) => {
            setAthletes((current) =>
              current.map((athlete) =>
                athlete.id === updated.id ? updated : athlete,
              ),
            );
            setProfileAthlete(updated);
          }}
          onArchived={(athleteId) => {
            setAthletes((current) =>
              current.filter((athlete) => athlete.id !== athleteId),
            );
          }}
          notify={notify}
        />
      )}

      {qrAthlete && (
        <AthleteQrModal
          key={qrAthlete.id}
          athlete={qrAthlete}
          onClose={() => setQrAthlete(null)}
          notify={notify}
        />
      )}

      {teamModalOpen && (
        <TeamModal
          key={editingTeam?.id ?? "new-team"}
          team={editingTeam}
          athletes={athletes}
          categories={categories}
          teams={teams}
          onClose={() => {
            setTeamModalOpen(false);
            setEditingTeam(null);
          }}
          onSaved={(savedTeam) => {
            setTeams((current) => {
              const exists = current.some((team) => team.id === savedTeam.id);
              return exists
                ? current.map((team) =>
                    team.id === savedTeam.id ? savedTeam : team,
                  )
                : [...current, savedTeam].sort((a, b) =>
                    a.startTime.localeCompare(b.startTime),
                  );
            });
          }}
          onArchived={(teamId) =>
            setTeams((current) =>
              current.filter((team) => team.id !== teamId),
            )
          }
          notify={notify}
        />
      )}

      {categoryManagerOpen && (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setCategoryManagerOpen(false)}
          onChanged={(nextCategories) => {
            setCategories(nextCategories);
            void loadAthletes();
            void loadTeams();
          }}
          notify={notify}
        />
      )}

      {attendanceTeam && (
        <AttendanceModal
          key={attendanceTeam.id}
          team={attendanceTeam}
          onClose={() => setAttendanceTeam(null)}
          onSaved={() => void loadAthletes()}
          notify={notify}
        />
      )}

      {toast && <div className="toast" role="status"><span><CheckCircle2 size={16} strokeWidth={1.75} /></span>{toast}</div>}
    </main>
  );
}

function Dashboard({
  athletes,
  categories,
  teams,
  setSection,
  onAttendance,
  onOpenTeam,
  onOpenAthlete,
  finance,
  summary,
  canViewFinance,
  userName,
}: {
  athletes: Athlete[];
  categories: CategoryRecord[];
  teams: TeamRecord[];
  setSection: (section: Section) => void;
  onAttendance: (team: TeamRecord) => void;
  onOpenTeam: (team: TeamRecord) => void;
  onOpenAthlete: (athlete: Athlete) => void;
  finance: FinanceOverview;
  summary: DashboardSummary;
  canViewFinance: boolean;
  userName: string;
}) {
  const averageAttendance = athletes.length
    ? Math.round(
        athletes.reduce((total, athlete) => total + athlete.attendance, 0) /
          athletes.length,
      )
    : 0;
  const totalTeamAthletes = teams.reduce(
    (total, team) => total + team.players,
    0,
  );
  const categoryNames = useMemo(
    () =>
      categories.length
        ? categories.map((category) => category.name)
        : Array.from(new Set(teams.map((team) => team.category))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [categories, teams],
  );
  const [selectedCategory, setSelectedCategory] = useState(() => categoryNames[0] ?? "");
  const activeCategory = categoryNames.includes(selectedCategory)
    ? selectedCategory
    : categoryNames[0] ?? "";
  const quickTeams = teams
    .filter((team) => !activeCategory || team.category === activeCategory)
    .sort((a, b) => teamScheduleRank(a) - teamScheduleRank(b))
    .slice(0, 4);
  const formatMoney = (cents: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  const todayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  })
    .format(new Date())
    .toLocaleUpperCase("pt-BR");

  const revenueMonths = summary.revenueLast12Months;
  const maxReceivedCents = Math.max(1, ...revenueMonths.map((entry) => entry.receivedCents));
  const hasRevenueData = revenueMonths.some((entry) => entry.receivedCents > 0);
  const monthDate = (key: string) => {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1);
  };
  const monthShortLabel = (key: string) =>
    new Intl.DateTimeFormat("pt-BR", { month: "short" })
      .format(monthDate(key))
      .replace(".", "")
      .toUpperCase();
  const monthTooltip = (key: string) => {
    const label = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" }).format(monthDate(key));
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  };
  const formatDateBR = (value: string | null) => {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="dashboard-screen">
      <div className="welcome-row">
        <div>
          <span className="eyebrow">{todayLabel}</span>
          <h1>Olá, {userName.split(/\s+/)[0]}! <span>👋</span></h1>
          <p>Veja como está a operação da sua escolinha hoje.</p>
        </div>
        <div className="period-pill"><span className="status-dot" /> Temporada 2026 <b><ChevronDown size={13} strokeWidth={2} /></b></div>
      </div>

      <section className={canViewFinance ? "metrics-grid" : "metrics-grid operator-metrics"} aria-label="Indicadores principais">
        {canViewFinance && (
          <>
            <Metric icon={Wallet} label="A RECEBER" value={formatMoney(finance.openCents)} trend={`${finance.openCount} mensalidade(s) em aberto`} tone="orange" />
            <Metric icon={AlertTriangle} label="ATRASADO" value={formatMoney(finance.totalOverdueCents)} trend={`${finance.totalOverdueCount} mensalidade(s) vencida(s)`} tone="red" negative />
            <Metric icon={Wallet} label="RECEBIDO NO MÊS" value={formatMoney(finance.receivedCents)} trend={`${finance.paidCount} pagamento(s) recebido(s)`} tone="green" />
          </>
        )}
        <Metric icon={Users} label="CLIENTES / ATLETAS" value={String(athletes.length)} trend="cadastros ativos" tone="green" />
        <Metric icon={CheckCircle2} label="FREQUÊNCIA MÉDIA" value={`${averageAttendance}%`} trend="calculada pelas chamadas" tone="blue" />
      </section>

      <section className="quick-mobile-panel" aria-label="Menu rápido">
        <button onClick={() => setSection("Atletas")}>
          <Users size={18} strokeWidth={1.8} />
          <span><strong>Clientes</strong><small>Ver e cadastrar atletas</small></span>
        </button>
        <button onClick={() => setSection("Turmas")}>
          <LayoutGrid size={18} strokeWidth={1.8} />
          <span><strong>Categorias</strong><small>Turmas por categoria</small></span>
        </button>
        {canViewFinance && (
          <button onClick={() => setSection("Mensalidades")}>
            <Wallet size={18} strokeWidth={1.8} />
            <span><strong>Financeiro</strong><small>Mensalidades e atrasos</small></span>
          </button>
        )}
      </section>

      <section className="card quick-call-card">
        <CardHeader title="Chamada rápida" subtitle="Selecione a categoria e escolha a turma" action="Ver todas" onAction={() => setSection("Turmas")} />
        <div className="quick-category-tabs">
          {categoryNames.map((category) => (
            <button
              key={category}
              type="button"
              className={category === activeCategory ? "active" : ""}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <div className="quick-team-list">
          {quickTeams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="quick-team-card"
              onClick={() => team.players > 0 ? onAttendance(team) : onOpenTeam(team)}
            >
              <span className="quick-team-time">{team.startTime}</span>
              <span className="quick-team-copy">
                <strong>{team.category} · {team.place}</strong>
                <small>{team.scheduleDays.join(" · ")} · {team.coachName} · {team.players} atletas</small>
              </span>
              <b>{team.players > 0 ? "Chamada" : "Montar"}</b>
            </button>
          ))}
          {quickTeams.length === 0 && (
            <div className="agenda-empty">
              <strong>Nenhuma turma nesta categoria</strong>
              <small>Cadastre ou ajuste uma turma para iniciar chamadas.</small>
            </div>
          )}
        </div>
      </section>

      <section className={canViewFinance ? "dashboard-grid" : "dashboard-grid operator-dashboard-grid"}>
        <div className="card schedule-card">
          <CardHeader title="Turmas ativas" subtitle={`${teams.length} turmas · ${totalTeamAthletes} matrículas`} action="Ver turmas" onAction={() => setSection("Turmas")} />
          <div className="schedule-list">
            {teams.slice(0, 3).map((item, index) => (
              <div className="schedule-item" key={item.id}>
                <div className="time"><strong>{item.startTime}</strong><small>{item.scheduleDays.join(" · ")}</small></div>
                <span className="team-badge">{String(index + 1).padStart(2, "0")}</span>
                <div className="schedule-info">
                  <strong>{item.category} <span>{item.place}</span></strong>
                  <small>{item.coachName} · {item.players} atletas</small>
                </div>
                <button className={item.players > 0 ? "call-button active" : "call-button"} onClick={() => item.players > 0 ? onAttendance(item) : onOpenTeam(item)}>{item.players > 0 ? "Fazer chamada" : "Adicionar atletas"}</button>
              </div>
            ))}
            {teams.length === 0 && <div className="agenda-empty"><strong>Nenhuma turma cadastrada</strong><small>Crie uma turma para organizar horários e chamadas.</small></div>}
          </div>
        </div>

        {canViewFinance && <div className="card finance-card">
          <CardHeader title="Receita mensal" subtitle="Comparativo últimos 12 meses" action="Detalhes" onAction={() => setSection("Mensalidades")} />
          <div className="chart-head"><div><strong>{formatMoney(finance.receivedCents)}</strong><span>mês atual</span></div><small>Previsto: {formatMoney(finance.expectedCents)}</small></div>
          {hasRevenueData ? (
            <>
              <div className="bar-chart" aria-label="Gráfico de receita mensal">
                {revenueMonths.map((entry, index) => (
                  <span
                    key={entry.month}
                    className={index === revenueMonths.length - 1 ? "current" : ""}
                    title={`${monthTooltip(entry.month)}: ${formatMoney(entry.receivedCents)}`}
                    style={{ height: `${Math.max(2, Math.round((entry.receivedCents / maxReceivedCents) * 100))}%` }}
                  />
                ))}
              </div>
              <div className="chart-labels">
                {revenueMonths.map((entry, index) =>
                  index === revenueMonths.length - 1 ? (
                    <b key={entry.month}>{monthShortLabel(entry.month)}</b>
                  ) : index % 2 === 0 ? (
                    <span key={entry.month}>{monthShortLabel(entry.month)}</span>
                  ) : null,
                )}
              </div>
            </>
          ) : (
            <div className="agenda-empty"><strong>Nenhuma receita registrada</strong><small>Assim que houver pagamentos recebidos, o comparativo mensal aparece aqui.</small></div>
          )}
          <div className="finance-summary">
            <div><span className="legend received" /><p><small>RECEBIDO</small><strong>{formatMoney(finance.receivedCents)}</strong></p></div>
            <div><span className="legend pending" /><p><small>EM ABERTO</small><strong>{finance.openCount} · {formatMoney(finance.openCents)}</strong></p></div>
            <div><span className="legend overdue" /><p><small>VENCIDAS</small><strong>{finance.totalOverdueCount} · {formatMoney(finance.totalOverdueCents)}</strong></p></div>
          </div>
          <div className="dashboard-billing-alerts">
            <button onClick={() => setSection("Mensalidades")}>
              <span>HOJE</span>
              <strong>{finance.dueTodayCount}</strong>
              <small>{formatMoney(finance.dueTodayCents)}</small>
            </button>
            <button onClick={() => setSection("Mensalidades")}>
              <span>PRÓXIMOS 7 DIAS</span>
              <strong>{finance.dueSoonCount}</strong>
              <small>{formatMoney(finance.dueSoonCents)}</small>
            </button>
            <div>
              <span>RECEBIMENTO DO MÊS</span>
              <strong>{finance.collectionRate}%</strong>
              <small>do faturado já recebido</small>
            </div>
          </div>
        </div>}
      </section>

      <section className="lower-grid">
        <div className="card athletes-card">
          <CardHeader title="Atletas em destaque" subtitle="Frequência e evolução no mês" action="Ver todos" onAction={() => setSection("Atletas")} />
          <div className={canViewFinance ? "athlete-table" : "athlete-table operator-athlete-table"}>
            <div className="table-row table-head"><span>ATLETA</span><span>CATEGORIA</span><span>FREQUÊNCIA</span>{canViewFinance && <span>FINANCEIRO</span>}</div>
            {athletes.slice(0, 3).map((athlete) => <AthleteRow key={athlete.id} athlete={athlete} onOpen={onOpenAthlete} showFinance={canViewFinance} />)}
            {athletes.length === 0 && <EmptyAthletes compact />}
          </div>
        </div>

        <div className="card attention-card">
          <CardHeader title="Precisa de atenção" subtitle="Ações importantes para hoje" />
          {canViewFinance && <button onClick={() => setSection("Mensalidades")}><span className="attention-icon red"><AlertTriangle size={15} strokeWidth={1.75} /></span><p><strong>{finance.totalOverdueCount} mensalidade(s) vencida(s)</strong><small>{formatMoney(finance.totalOverdueCents)} em atraso no histórico completo</small></p><b>›</b></button>}
          {canViewFinance && finance.dueTodayCount > 0 && <button onClick={() => setSection("Mensalidades")}><span className="attention-icon orange"><Wallet size={15} strokeWidth={1.75} /></span><p><strong>{finance.dueTodayCount} mensalidade(s) vencem hoje</strong><small>{formatMoney(finance.dueTodayCents)} aguardando pagamento</small></p><b>›</b></button>}
          <button onClick={() => setSection("Avaliações")}>
            <span className="attention-icon orange"><TrendingUp size={15} strokeWidth={1.75} /></span>
            {summary.evaluations.total > 0 ? (
              <p><strong>{summary.evaluations.total} avaliação(ões) registrada(s)</strong><small>{summary.evaluations.lastEvaluationDate ? `Última em ${formatDateBR(summary.evaluations.lastEvaluationDate)}` : "Sem data de referência"}</small></p>
            ) : (
              <p><strong>Nenhuma avaliação registrada</strong><small>Cadastre a primeira avaliação da turma</small></p>
            )}
            <b>›</b>
          </button>
          <button onClick={() => setSection("Comunicação")}>
            <span className="attention-icon blue"><MessageCircle size={15} strokeWidth={1.75} /></span>
            {summary.nextCommunication ? (
              <p><strong>Próximo comunicado</strong><small>{summary.nextCommunication.title} · {summary.nextCommunication.scheduledAt ?? "sem horário definido"}</small></p>
            ) : (
              <p><strong>Nenhum comunicado agendado</strong><small>Agende um comunicado para as famílias</small></p>
            )}
            <b>›</b>
          </button>
          <div className="all-good"><span><CheckCircle2 size={15} strokeWidth={1.75} /></span><p><strong>{summary.documents.total} documento(s) cadastrado(s)</strong><small>Documentos enviados por atletas nesta organização</small></p></div>
        </div>
      </section>
    </div>
  );
}

const weekdayOrder: Record<string, number> = {
  Dom: 0, Seg: 1, Ter: 2, Qua: 3, Qui: 4, Sex: 5, Sáb: 6,
};

function teamScheduleRank(team: TeamRecord) {
  const earliestDay = team.scheduleDays.reduce(
    (min, day) => Math.min(min, weekdayOrder[day] ?? 7),
    7,
  );
  return earliestDay * 2400 + Number(team.startTime.replace(":", ""));
}

function SectionView({
  section,
  athletes,
  categories,
  teams,
  setShowAthleteModal,
  onNewTeam,
  onOpenTeam,
  onAttendance,
  onOpenAthlete,
  onOpenQr,
  canViewFinance,
  notify,
}: {
  section: Section;
  athletes: Athlete[];
  categories: CategoryRecord[];
  teams: TeamRecord[];
  setShowAthleteModal: (show: boolean) => void;
  onNewTeam: () => void;
  onOpenTeam: (team: TeamRecord) => void;
  onAttendance: (team: TeamRecord) => void;
  onOpenAthlete: (athlete: Athlete) => void;
  onOpenQr: (athlete: Athlete) => void;
  canViewFinance: boolean;
  notify: (message: string) => void;
}) {
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteCategory, setAthleteCategory] = useState("all");
  const [teamQuery, setTeamQuery] = useState("");
  const [teamCategory, setTeamCategory] = useState("all");
  const [teamDay, setTeamDay] = useState("all");
  const [teamSort, setTeamSort] = useState<"schedule" | "name" | "category">("schedule");
  const [attendanceQuery, setAttendanceQuery] = useState("");
  const [attendanceCategory, setAttendanceCategory] = useState("all");
  const [attendanceDay, setAttendanceDay] = useState("all");
  const [recordPickerOpen, setRecordPickerOpen] = useState(false);
  const [recordAthleteId, setRecordAthleteId] = useState("");
  const visibleAthletes = useMemo(
    () =>
      athletes.filter((athlete) => {
        const matchesName = athlete.name
          .toLocaleLowerCase("pt-BR")
          .includes(athleteQuery.trim().toLocaleLowerCase("pt-BR"));
        const matchesCategory =
          athleteCategory === "all" || athlete.category === athleteCategory;
        return matchesName && matchesCategory;
      }),
    [athleteCategory, athleteQuery, athletes],
  );
  const autocompleteAthletes = useMemo(() => {
    const query = athleteQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return athletes
      .filter((athlete) => {
        const name = athlete.name.toLocaleLowerCase("pt-BR");
        return name.includes(query) && name !== query;
      })
      .slice(0, 5);
  }, [athleteQuery, athletes]);

  const visibleTeams = useMemo(
    () =>
      teams
        .filter((team) => {
          const query = teamQuery.trim().toLocaleLowerCase("pt-BR");
          const matchesQuery =
            !query ||
            team.name.toLocaleLowerCase("pt-BR").includes(query) ||
            team.coachName.toLocaleLowerCase("pt-BR").includes(query);
          const matchesCategory = teamCategory === "all" || team.category === teamCategory;
          const matchesDay = teamDay === "all" || team.scheduleDays.includes(teamDay);
          return matchesQuery && matchesCategory && matchesDay;
        })
        .sort((a, b) => {
          if (teamSort === "name") return a.name.localeCompare(b.name, "pt-BR");
          if (teamSort === "category") return a.category.localeCompare(b.category, "pt-BR") || teamScheduleRank(a) - teamScheduleRank(b);
          return teamScheduleRank(a) - teamScheduleRank(b);
        }),
    [teams, teamQuery, teamCategory, teamDay, teamSort],
  );
  const visibleAttendanceTeams = useMemo(() => {
    const query = attendanceQuery.trim().toLocaleLowerCase("pt-BR");
    return teams.filter((team) => {
      const matchesQuery = !query || `${team.name} ${team.coachName} ${team.category}`.toLocaleLowerCase("pt-BR").includes(query);
      const matchesCategory = attendanceCategory === "all" || team.category === attendanceCategory;
      const matchesDay = attendanceDay === "all" || team.scheduleDays.includes(attendanceDay);
      return matchesQuery && matchesCategory && matchesDay;
    });
  }, [teams, attendanceQuery, attendanceCategory, attendanceDay]);

  const descriptions: Record<Section, string> = {
    "Visão geral": "",
    Atletas: "Cadastre, localize e mantenha os dados dos atletas organizados.",
    Prontuário: "Acesse informações médicas, autorizações, documentos e histórico individual.",
    Turmas: "Horários, categorias, professores e capacidade das turmas.",
    Presença: "Acompanhe frequência, ausências e reposições.",
    "Cartões QR": "Consulte os cartões individuais e acompanhe as entradas registradas pelo aplicativo.",
    "QR e entrada": "Consulte os cartões individuais e acompanhe as entradas registradas pelo aplicativo.",
    Financeiro: "Mensalidades, cobranças, fluxo de caixa e inadimplência.",
    Mensalidades: "Cobranças mensais, recebimentos, baixas e inadimplência.",
    Planos: "Planos de mensalidade, faturamento e vínculo de cobrança por atleta.",
    "Controle de gastos": "Contas a pagar, despesas parceladas, baixas e resultado realizado.",
    Treinos: "Planejamento de sessões e biblioteca de exercícios.",
    Avaliações: "Evolução técnica, física, tática e comportamental.",
    Comunicação: "Avisos segmentados para responsáveis, atletas e equipe.",
    "Usuários e permissões": "Gerencie acessos e restrições por função.",
  };

  const action =
    section === "Atletas"
      ? () => setShowAthleteModal(true)
      : section === "Turmas"
        ? onNewTeam
        : section === "Presença" && teams.length > 0
          ? () => onAttendance(teams[0])
          : section === "Presença"
            ? onNewTeam
          : () => notify(`Novo item de ${section.toLowerCase()} preparado.`);
  const actionLabel =
    section === "Presença"
      ? "Fazer chamada"
      : section === "Turmas"
        ? "Nova turma"
        : section === "Atletas"
          ? "Novo atleta"
          : "Novo registro";

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {section === "Atletas" ? "CADASTRO" : section === "Prontuário" ? "ATLETAS" : "M6 FUTEBOL CLUBE"}
          </span>
          <h1>{section}</h1>
          <p>{descriptions[section]}</p>
        </div>
        {section === "Prontuário" ? (
          <button className="primary-button" onClick={() => setRecordPickerOpen(true)}>
            <Plus size={16} strokeWidth={2} /> Adicionar prontuário
          </button>
        ) : (
          <button className="primary-button" onClick={action}><Plus size={16} strokeWidth={2} /> {actionLabel}</button>
        )}
      </div>
      {section === "Atletas" ? (
        <div className="card module-card athlete-records">
          <div
            className="athlete-tabs"
            role="tablist"
            aria-label="Listas de atletas"
          >
            <button className="active" role="tab" aria-selected="true">
              Todos <span>{athletes.length}</span>
            </button>
          </div>
          <div className="athlete-list-toolbar">
            <div className="athlete-search-wrap">
              <label className="athlete-list-search">
                <span><Search size={14} strokeWidth={1.75} /></span>
                <input
                  aria-label="Pesquisar atleta por nome"
                  value={athleteQuery}
                  onChange={(event) => setAthleteQuery(event.target.value)}
                  placeholder="Pesquisar por nome..."
                />
              </label>
              {autocompleteAthletes.length > 0 && (
                <div className="athlete-autocomplete" role="listbox" aria-label="Sugestões de atletas">
                  {autocompleteAthletes.map((athlete) => (
                    <button type="button" role="option" aria-selected="false" key={athlete.id} onClick={() => setAthleteQuery(athlete.name)}>
                      <span className="athlete-avatar small">{athlete.initials}</span>
                      <span><strong>{athlete.name}</strong><small>{athlete.category || "Sem categoria"}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="athlete-category-filter">
              <span>Categoria</span>
              <select
                value={athleteCategory}
                onChange={(event) => setAthleteCategory(event.target.value)}
              >
                <option value="all">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <strong>{visibleAthletes.length} resultado(s)</strong>
          </div>
          <div className={canViewFinance ? "athlete-table expanded" : "athlete-table expanded operator-athlete-table"}>
            <div className="table-row table-head"><span>ATLETA</span><span>CATEGORIA</span><span>FREQUÊNCIA</span><span>{canViewFinance ? "FINANCEIRO / QR" : "QR CODE"}</span></div>
            {visibleAthletes.map((athlete) => <AthleteRow key={athlete.id} athlete={athlete} onOpen={onOpenAthlete} onQr={onOpenQr} showFinance={canViewFinance} />)}
            {visibleAthletes.length === 0 && <EmptyAthletes />}
          </div>
        </div>
      ) : section === "Prontuário" ? (
        <div className="medical-record-browser">
          <div className="card record-toolbar-card">
            <div className="record-toolbar-copy">
              <strong>Prontuários dos atletas</strong>
              <span>Selecione um atleta para abrir o cadastro completo.</span>
            </div>
            <div className="record-toolbar">
              <div className="athlete-search-wrap">
                <label className="athlete-list-search">
                  <span><Search size={14} strokeWidth={1.75} /></span>
                  <input
                    aria-label="Pesquisar prontuário por nome"
                    value={athleteQuery}
                    onChange={(event) => setAthleteQuery(event.target.value)}
                    placeholder="Pesquisar atleta..."
                  />
                </label>
                {autocompleteAthletes.length > 0 && (
                  <div className="athlete-autocomplete" role="listbox" aria-label="Sugestões de prontuários">
                    {autocompleteAthletes.map((athlete) => (
                      <button type="button" role="option" aria-selected="false" key={athlete.id} onClick={() => setAthleteQuery(athlete.name)}>
                        <span className="athlete-avatar small">{athlete.initials}</span>
                        <span><strong>{athlete.name}</strong><small>{athlete.category || "Sem categoria"}</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label className="athlete-category-filter">
                <span>Categoria</span>
                <select value={athleteCategory} onChange={(event) => setAthleteCategory(event.target.value)}>
                  <option value="all">Todas</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.name}>{category.name}</option>
                  ))}
                </select>
              </label>
              <strong>{visibleAthletes.length} resultado(s)</strong>
            </div>
          </div>
          {visibleAthletes.length > 0 ? (
            <div className="record-grid">
              {visibleAthletes.map((athlete) => (
                <button className="record-card card" type="button" key={athlete.id} onClick={() => onOpenAthlete(athlete)}>
                  <span className="athlete-avatar">{athlete.initials}</span>
                  <span className="record-card-copy">
                    <strong>{athlete.name}</strong>
                    <small>{athlete.category || "Sem categoria"} · {athlete.age ? `${athlete.age} anos` : "Idade não informada"}</small>
                  </span>
                  <span className="record-open">Abrir prontuário →</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="card empty-state">
              <strong>Nenhum prontuário encontrado</strong>
              <p>Ajuste a busca ou o filtro de categoria.</p>
            </div>
          )}
        </div>
      ) : section === "Turmas" ? (
        <div className="teams-browser">
          <div className="card team-toolbar-card">
            <div className="team-toolbar">
              <label className="athlete-list-search">
                <span><Search size={14} strokeWidth={1.75} /></span>
                <input
                  aria-label="Pesquisar turma por nome ou professor"
                  value={teamQuery}
                  onChange={(event) => setTeamQuery(event.target.value)}
                  placeholder="Pesquisar turma ou professor..."
                />
              </label>
              <label className="athlete-category-filter">
                <span>Categoria</span>
                <select value={teamCategory} onChange={(event) => setTeamCategory(event.target.value)}>
                  <option value="all">Todas</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.name}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label className="athlete-category-filter">
                <span>Dia</span>
                <select value={teamDay} onChange={(event) => setTeamDay(event.target.value)}>
                  <option value="all">Todos</option>
                  <option value="Seg">Segunda</option>
                  <option value="Ter">Terça</option>
                  <option value="Qua">Quarta</option>
                  <option value="Qui">Quinta</option>
                  <option value="Sex">Sexta</option>
                  <option value="Sáb">Sábado</option>
                  <option value="Dom">Domingo</option>
                </select>
              </label>
              <label className="athlete-category-filter">
                <span>Ordenar</span>
                <select value={teamSort} onChange={(event) => setTeamSort(event.target.value as typeof teamSort)}>
                  <option value="schedule">Horário</option>
                  <option value="category">Categoria</option>
                  <option value="name">Nome</option>
                </select>
              </label>
              <strong>{visibleTeams.length} resultado(s)</strong>
            </div>
          </div>
          <div className="class-grid">
            {visibleTeams.map((team) => {
              const capacityPct = Math.round((team.players / team.capacity) * 100);
              const overCapacity = team.players > team.capacity;
              return (
                <div className="card class-card" key={team.id}>
                  <span className={`class-stripe ${team.color}`} />
                  <div className="class-top"><span>{team.category}</span><small>{team.place}</small></div>
                  <h3>{team.name}</h3>
                  <p>{team.coachName} · {team.scheduleDays.join(" e ")} · {team.startTime}</p>
                  <div className={`capacity${overCapacity ? " over" : ""}`}><span><b>{team.players}</b> / {team.capacity} atletas</span><span>{capacityPct}%</span></div>
                  <div className={`capacity-bar${overCapacity ? " over" : ""}`}><i style={{ width: `${Math.min(100, capacityPct)}%` }} /></div>
                  <div className="class-actions"><button onClick={() => onOpenTeam(team)}>Editar turma</button><button onClick={() => onAttendance(team)} disabled={team.players === 0}>Fazer chamada →</button></div>
                </div>
              );
            })}
            {teams.length === 0 && <div className="card class-empty"><span><LayoutGrid size={20} strokeWidth={1.75} /></span><strong>Nenhuma turma cadastrada</strong><small>Crie a primeira turma e selecione os atletas participantes.</small><button className="primary-button" onClick={onNewTeam}>Criar primeira turma</button></div>}
            {teams.length > 0 && visibleTeams.length === 0 && <div className="card class-empty"><span><Search size={14} strokeWidth={1.75} /></span><strong>Nenhuma turma encontrada</strong><small>Ajuste a busca ou o filtro de categoria.</small></div>}
          </div>
        </div>
      ) : section === "Presença" ? (
<div className="attendance-browser"><div className="card attendance-toolbar-card"><div className="attendance-toolbar"><label className="athlete-list-search"><span><Search size={14} strokeWidth={1.75} /></span><input value={attendanceQuery} onChange={(event) => setAttendanceQuery(event.target.value)} placeholder="Buscar turma, categoria ou professor..." /></label><label className="athlete-category-filter"><span>Categoria</span><select value={attendanceCategory} onChange={(event) => setAttendanceCategory(event.target.value)}><option value="all">Todas</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label className="athlete-category-filter"><span>Dia</span><select value={attendanceDay} onChange={(event) => setAttendanceDay(event.target.value)}><option value="all">Todos</option><option value="Seg">Segunda</option><option value="Ter">Terça</option><option value="Qua">Quarta</option><option value="Qui">Quinta</option><option value="Sex">Sexta</option><option value="Sáb">Sábado</option><option value="Dom">Domingo</option></select></label><strong>{visibleAttendanceTeams.length} turma(s)</strong></div></div><div className="attendance-team-grid">
            {visibleAttendanceTeams.map((team) => (
            <button className="card attendance-team-card" key={team.id} onClick={() => onAttendance(team)}>
              <span className={`attention-icon ${team.color === "orange" ? "orange" : "green"}`}><CheckSquare size={15} strokeWidth={1.75} /></span>
              <div><strong>{team.name} · {team.category}</strong><small>{team.scheduleDays.join(" e ")} · {team.startTime} · {team.players} atletas</small></div>
              <b>Fazer chamada →</b>
            </button>
          ))}
 {teams.length === 0 && <div className="card class-empty"><span><CheckSquare size={20} strokeWidth={1.75} /></span><strong>Nenhuma turma disponível</strong><small>Cadastre uma turma antes de registrar presenças.</small><button className="primary-button" onClick={onNewTeam}>Criar turma</button></div>}
 </div></div>
      ) : section === "Treinos" ? (
        <div className="module-two-columns">
          <div className="card training-plan"><span className="eyebrow">PRÓXIMA SESSÃO</span><h2>Domínio e progressão</h2><p>Sub-11 · Sexta-feira, 10:00 · 75 minutos</p><div className="drill"><span>01</span><p><strong>Aquecimento com bola</strong><small>Mobilidade + condução · 12 min</small></p></div><div className="drill"><span>02</span><p><strong>Rondo 5 × 2</strong><small>Tomada de decisão · 18 min</small></p></div><div className="drill"><span>03</span><p><strong>Jogo posicional</strong><small>Progressão por setores · 25 min</small></p></div><button className="primary-button" onClick={() => notify("Plano de treino aberto para edição.")}>Editar sessão</button>
          </div>
          <div className="card insight-card"><span className="eyebrow">INSIGHT DA METODOLOGIA</span><h2>Equilibre o conteúdo</h2><div className="radial"><strong>68%</strong><small>com bola</small></div><p>Neste mês, o Sub-11 trabalhou mais fundamentos técnicos. Inclua uma sessão focada em princípios defensivos.</p><button onClick={() => notify("Sugestões adicionadas ao próximo planejamento.")}>Ver sugestões →</button></div>
        </div>
      ) : (
        <GenericModule section={section} notify={notify} />
      )}
      {recordPickerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRecordPickerOpen(false)}>
          <div className="record-picker-modal" role="dialog" aria-modal="true" aria-labelledby="record-picker-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setRecordPickerOpen(false)} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button>
            <span className="eyebrow">PRONTUÁRIO DO ATLETA</span>
            <h2 id="record-picker-title">Adicionar prontuário</h2>
            <p>Selecione o atleta para abrir e completar seu prontuário individual.</p>
            {athletes.length > 0 ? (
              <>
                <label>
                  Atleta
                  <select value={recordAthleteId} onChange={(event) => setRecordAthleteId(event.target.value)} autoFocus>
                    <option value="">Selecione um atleta</option>
                    {athletes.map((athlete) => (
                      <option key={athlete.id} value={athlete.id}>
                        {athlete.name} · {athlete.category || "Sem categoria"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="record-picker-actions">
                  <button className="filter-button" type="button" onClick={() => setRecordPickerOpen(false)}>Cancelar</button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!recordAthleteId}
                    onClick={() => {
                      const athlete = athletes.find((item) => item.id === recordAthleteId);
                      if (!athlete) return;
                      setRecordPickerOpen(false);
                      setRecordAthleteId("");
                      onOpenAthlete(athlete);
                    }}
                  >
                    Abrir prontuário
                  </button>
                </div>
              </>
            ) : (
              <div className="record-picker-empty">
                <strong>Nenhum atleta cadastrado</strong>
                <p>Cadastre primeiro o atleta para criar seu prontuário.</p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setRecordPickerOpen(false);
                    setShowAthleteModal(true);
                  }}
                >
                  Cadastrar atleta
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function GenericModule({ section, notify }: { section: Section; notify: (message: string) => void }) {
  const data: Record<string, { stat: string; label: string; secondary: string; cards: [string, string][] }> = {
    Presença: { stat: "91,4%", label: "frequência geral", secondary: "4 turmas hoje", cards: [["Sub-9 · 08:30", "17 de 18 presentes"], ["Sub-11 · 10:00", "Chamada pendente"], ["Sub-13 · 14:30", "Começa em 2 horas"]] },
    Financeiro: { stat: "R$ 18.740", label: "receita em julho", secondary: "87% da meta", cards: [["Recebido", "R$ 16.310"], ["A receber", "R$ 2.430"], ["Em atraso", "R$ 780"]] },
    Avaliações: { stat: "74%", label: "avaliações concluídas", secondary: "5 pendentes", cards: [["Técnica", "82% concluído"], ["Física", "76% concluído"], ["Comportamental", "91% concluído"]] },
    Comunicação: { stat: "94%", label: "taxa de leitura", secondary: "328 destinatários", cards: [["Festival interno", "Agendado para amanhã"], ["Recesso escolar", "Enviado · 96% lido"], ["Documentos pendentes", "Rascunho · 7 famílias"]] },
  };
  const moduleData = data[section] || data.Presença;
  return (
    <div className="module-two-columns">
      <div className="card overview-module"><span className="eyebrow">RESUMO DO MÊS</span><strong className="giant-stat">{moduleData.stat}</strong><p>{moduleData.label}</p><span className="soft-tag">{moduleData.secondary}</span><div className="overview-progress"><i style={{ width: section === "Financeiro" ? "87%" : "74%" }} /></div></div>
      <div className="card list-module">
        <CardHeader title={section === "Financeiro" ? "Situação das cobranças" : `Acompanhamento de ${section.toLowerCase()}`} subtitle="Atualizado agora" />
        {moduleData.cards.map(([title, value], index) => <button key={title} onClick={() => notify(`${title}: detalhes abertos.`)}><span className={`attention-icon ${index === 1 ? "orange" : "green"}`}>{index + 1}</span><p><strong>{title}</strong><small>{value}</small></p><b>›</b></button>)}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, trend, tone, negative, progress }: { icon: LucideIcon; label: string; value: string; trend: string; tone: string; negative?: boolean; progress?: boolean }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} strokeWidth={1.75} /></div><div><span>{label}</span><strong>{value}</strong><small className={negative ? "negative" : ""}>{progress && <i className="mini-progress"><b /></i>}{!progress && <b>{negative ? <ArrowDown size={11} strokeWidth={2.25} /> : <ArrowUp size={11} strokeWidth={2.25} />}</b>} {trend}</small></div></article>;
}

function CardHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <div className="card-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button onClick={onAction}>{action} <span>→</span></button>}</div>;
}

function AthleteRow({
  athlete,
  onOpen,
  onQr,
  showFinance = true,
}: {
  athlete: Athlete;
  onOpen: (athlete: Athlete) => void;
  onQr?: (athlete: Athlete) => void;
  showFinance?: boolean;
}) {
  function openFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(athlete);
    }
  }

  return (
    <div className="table-row athlete-row-button" role="button" tabIndex={0} onClick={() => onOpen(athlete)} onKeyDown={openFromKeyboard}>
      <span className="athlete-name"><i className={`mini-avatar ${athlete.tone}`}>{athlete.initials}</i><span><strong>{athlete.name}</strong><small>{athlete.age} anos</small></span></span>
      <span><b className="category-tag">{athlete.category}</b></span>
      <span className="attendance-cell"><strong>{athlete.attendance}%</strong><i><b style={{ width: `${athlete.attendance}%` }} /></i></span>
      <span className="athlete-finance-cell">
        {showFinance && <b className={athlete.status === "Em dia" ? "status-tag paid" : "status-tag pending"}><i />{athlete.status}</b>}
        {onQr && (
          <button
            type="button"
            className="athlete-row-qr-button"
            onClick={(event) => {
              event.stopPropagation();
              onQr(athlete);
            }}
          >
            Ver QR Code
          </button>
        )}
      </span>
    </div>
  );
}

function AthleteQrModal({ athlete, onClose, notify }: { athlete: Athlete; onClose: () => void; notify: (message: string) => void }) {
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function generateQrCode() {
      try {
        const [response, qrCode] = await Promise.all([
          fetch("/api/check-in/cards"),
          import("qrcode"),
        ]);
        const payload = (await response.json()) as {
          cards?: Array<{ id: string; value: string }>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o QR Code.");
        const card = payload.cards?.find((item) => item.id === athlete.id);
        if (!card) throw new Error("O cartão deste atleta não foi encontrado.");
        const dataUrl = await qrCode.toDataURL(card.value, {
          width: 420,
          margin: 2,
          color: { dark: "#16392d", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        if (active) setImage(dataUrl);
      } catch (error) {
        if (active) {
          notify(error instanceof Error ? error.message : "Não foi possível gerar o QR Code.");
          onClose();
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void generateQrCode();
    return () => {
      active = false;
    };
  }, [athlete.id, notify, onClose]);

  return (
    <div className="modal-backdrop qr-card-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="qr-card-modal" role="dialog" aria-modal="true" aria-labelledby="athlete-qr-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">CARTÃO INDIVIDUAL</span>
            <h2 id="athlete-qr-title">{athlete.name}</h2>
            <p>{athlete.category} · gerado automaticamente no cadastro</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} strokeWidth={1.75} /></button>
        </header>
        <div className="qr-card-modal-content">
          <div className="qr-card-brand">
            <span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpeg" alt="Escola de Futebol M6 Futebol Clube" />
            </span>
            <strong>M6 Futebol Clube</strong>
          </div>
          {loading ? (
            <div className="athlete-qr-loading">Gerando QR Code...</div>
          ) : image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={`QR Code de ${athlete.name}`} />
          ) : null}
          <strong>{athlete.name}</strong>
          <small>{athlete.category} · Cartão de entrada</small>
          <p>A escola escaneia este código na chegada para registrar a presença.</p>
        </div>
        <footer className="qr-card-modal-actions">
          <button className="filter-button" onClick={onClose}>Fechar</button>
          <button className="primary-button" onClick={() => window.print()} disabled={!image}>Imprimir cartão</button>
        </footer>
      </div>
    </div>
  );
}

function EmptyAthletes({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "empty-athletes compact" : "empty-athletes"}>
      <span><UserPlus size={22} strokeWidth={1.75} /></span>
      <div>
        <strong>Nenhum atleta cadastrado</strong>
        <small>Use “Novo atleta” para salvar o primeiro cadastro.</small>
      </div>
    </div>
  );
}
