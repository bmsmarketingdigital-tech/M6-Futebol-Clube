"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import { EvaluationManagement } from "./EvaluationManagement";
import { TrainingManagement } from "./TrainingManagement";
import { CommunicationManagement } from "./CommunicationManagement";
import { CheckInManagement } from "./CheckInManagement";
import {
  CategoryManagerModal,
  type CategoryRecord,
} from "./CategoryManagerModal";
import { AthleteEditModal } from "./AthleteEditModal";

type Section =
  | "Visão geral"
  | "Atletas"
  | "Prontuário"
  | "Turmas"
  | "Presença"
  | "QR e entrada"
  | "Financeiro"
  | "Planos"
  | "Treinos"
  | "Avaliações"
  | "Comunicação";

type Athlete = AthleteRecord;

type FinanceOverview = {
  receivedCents: number;
  pendingCents: number;
  overdueCents: number;
  expectedCents: number;
  paidCount: number;
  overdueCount: number;
};

const navItems: { label: Section; icon: string }[] = [
  { label: "Visão geral", icon: "⌂" },
  { label: "Atletas", icon: "◎" },
  { label: "Turmas", icon: "▦" },
  { label: "Presença", icon: "✓" },
  { label: "QR e entrada", icon: "◎" },
  { label: "Financeiro", icon: "$" },
  { label: "Treinos", icon: "◫" },
  { label: "Avaliações", icon: "↗" },
  { label: "Comunicação", icon: "◌" },
];

const sectionPageClasses: Record<Exclude<Section, "Visão geral">, string> = {
  Atletas: "athletes-page",
  Prontuário: "records-page",
  Turmas: "teams-page",
  Presença: "attendance-page",
  "QR e entrada": "checkin-page",
  Financeiro: "finance-page",
  Planos: "finance-page",
  Treinos: "trainings-page",
  Avaliações: "evaluations-page",
  Comunicação: "communications-page",
};

const financeBars = [52, 68, 58, 76, 64, 84, 73, 92, 78, 96, 88, 100];

export default function Home() {
  const [section, setSection] = useState<Section>("Visão geral");
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [search, setSearch] = useState("");
  const [showAthleteModal, setShowAthleteModal] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [athletesMenuOpen, setAthletesMenuOpen] = useState(false);
  const [financeMenuOpen, setFinanceMenuOpen] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [profileAthlete, setProfileAthlete] = useState<Athlete | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRecord | null>(null);
  const [attendanceTeam, setAttendanceTeam] = useState<TeamRecord | null>(null);
  const [toast, setToast] = useState("");
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [savingAthlete, setSavingAthlete] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview>({
    receivedCents: 0,
    pendingCents: 0,
    overdueCents: 0,
    expectedCents: 0,
    paidCount: 0,
    overdueCount: 0,
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

  const checkReminders = useCallback(async () => {
    try {
      const response = await fetch("/api/reminders", { method: "POST" });
      const payload = (await response.json()) as {
        remindersSent?: number;
        teams?: string[];
      };
      if (response.ok && (payload.remindersSent ?? 0) > 0) {
        notify(
          `Lembretes de treino enviados para: ${(payload.teams ?? []).join(", ")}.`,
        );
      }
    } catch {
      // Os lembretes são reenviados na próxima verificação.
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAthletes();
      void loadTeams();
      void loadCategories();
      void loadFinanceOverview();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadAthletes, loadCategories, loadFinanceOverview, loadTeams]);

  useEffect(() => {
    void checkReminders();
    const interval = window.setInterval(
      () => void checkReminders(),
      30 * 60 * 1000,
    );
    return () => window.clearInterval(interval);
  }, [checkReminders]);

  const filteredAthletes = useMemo(
    () =>
      athletes.filter((athlete) =>
        `${athlete.name} ${athlete.category}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [athletes, search],
  );

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
        }),
      });
      const payload = (await response.json()) as {
        athlete?: Athlete;
        error?: string;
      };
      if (!response.ok || !payload.athlete) {
        throw new Error(payload.error || "Não foi possível cadastrar o atleta.");
      }

      setAthletes((current) => [payload.athlete!, ...current]);
      formElement.reset();
      setShowAthleteModal(false);
      notify(`${name} foi cadastrado e salvo com sucesso.`);
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
          <span className="brand-mark">BF</span>
          <span>
            <strong>BaseForte</strong>
            <small>GESTÃO ESPORTIVA</small>
          </span>
        </div>

        <nav aria-label="Navegação principal">
          <p className="nav-label">GESTÃO</p>
          {navItems.slice(0, 6).map((item) =>
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
                    setAthletesMenuOpen((current) =>
                      isAthleteSection ? !current : true,
                    );
                  }}
                  aria-expanded={athletesMenuOpen}
                >
                  <span className="nav-icon">{item.icon}</span>
                  Atletas
                  <span className="nav-chevron">
                    {athletesMenuOpen ? "⌃" : "⌄"}
                  </span>
                </button>
                {athletesMenuOpen && (
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
                )}
              </div>
            ) : item.label === "Financeiro" ? (
              <div className="nav-group" key={item.label}>
                <button
                  className={
                    section === "Financeiro" || section === "Planos"
                      ? "nav-item expanded"
                      : "nav-item"
                  }
                  onClick={() => {
                    const isFinanceSection =
                      section === "Financeiro" || section === "Planos";
                    setSection("Financeiro");
                    setFinanceMenuOpen((current) =>
                      isFinanceSection ? !current : true,
                    );
                  }}
                  aria-expanded={financeMenuOpen}
                >
                  <span className="nav-icon">{item.icon}</span>
                  Financeiro
                  {financeOverview.overdueCount > 0 && (
                    <span className="nav-badge">
                      {financeOverview.overdueCount}
                    </span>
                  )}
                  <span className="nav-chevron">
                    {financeMenuOpen ? "⌃" : "⌄"}
                  </span>
                </button>
                {financeMenuOpen && (
                  <button
                    className={
                      section === "Planos" ? "nav-subitem active" : "nav-subitem"
                    }
                    onClick={() => setSection("Planos")}
                  >
                    <span />
                    Planos
                  </button>
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
                <span className="nav-icon">{item.icon}</span>
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
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-profile">
          <span className="avatar">BM</span>
          <span>
            <strong>Bruno Martins</strong>
            <small>Administrador</small>
          </span>
          <button aria-label="Mais opções">•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setSection("Visão geral")} aria-label="Página inicial">BF</button>
          <label className="search">
            <span>⌕</span>
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
            <button className="icon-button" aria-label="Ajuda">?</button>
            <button className="icon-button notification" aria-label="Notificações">♢</button>
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
              setSection={setSection}
              teams={teams}
              onAttendance={setAttendanceTeam}
              onOpenTeam={(team) => {
                setEditingTeam(team);
                setTeamModalOpen(true);
              }}
              onOpenAthlete={setProfileAthlete}
              finance={financeOverview}
              notify={notify}
            />
          ) : section === "Financeiro" || section === "Planos" ? (
            <FinanceManagement
              view={section === "Planos" ? "plans" : "overview"}
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
          ) : section === "QR e entrada" ? (
            <CheckInManagement
              teams={teams}
              notify={notify}
              onAttendanceChanged={() => {
                void loadAthletes();
                void loadTeams();
              }}
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
              notify={notify}
            />
          )}
        </div>
      </section>

      {showAthleteModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAthleteModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-athlete-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAthleteModal(false)} aria-label="Fechar">×</button>
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
                      ⚙
                    </button>
                  </span>
                  <select name="category" defaultValue={categories[0]?.name}>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>Responsável<input name="guardian" required placeholder="Nome do responsável" /></label>
              <label>Telefone do responsável<input name="guardianPhone" type="tel" placeholder="(11) 99999-9999" /></label>
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

      {teamModalOpen && (
        <TeamModal
          key={editingTeam?.id ?? "new-team"}
          team={editingTeam}
          athletes={athletes}
          categories={categories}
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

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Dashboard({
  athletes,
  teams,
  setSection,
  onAttendance,
  onOpenTeam,
  onOpenAthlete,
  finance,
  notify,
}: {
  athletes: Athlete[];
  teams: TeamRecord[];
  setSection: (section: Section) => void;
  onAttendance: (team: TeamRecord) => void;
  onOpenTeam: (team: TeamRecord) => void;
  onOpenAthlete: (athlete: Athlete) => void;
  finance: {
    receivedCents: number;
    pendingCents: number;
    overdueCents: number;
    expectedCents: number;
    paidCount: number;
    overdueCount: number;
  };
  notify: (message: string) => void;
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

  return (
    <div className="dashboard-screen">
      <div className="welcome-row">
        <div>
          <span className="eyebrow">{todayLabel}</span>
          <h1>Olá, Bruno! <span>👋</span></h1>
          <p>Veja como está a operação da sua escolinha hoje.</p>
        </div>
        <div className="period-pill"><span className="status-dot" /> Temporada 2026 <b>⌄</b></div>
      </div>

      <section className="metrics-grid" aria-label="Indicadores principais">
        <Metric icon="◎" label="ATLETAS ATIVOS" value={String(athletes.length)} trend="cadastros persistentes" tone="green" />
        <Metric icon="✓" label="FREQUÊNCIA MÉDIA" value={`${averageAttendance}%`} trend="calculada pelas chamadas" tone="blue" />
        <Metric icon="$" label="RECEITA DO MÊS" value={formatMoney(finance.receivedCents)} trend={`${finance.paidCount} pagamento(s) recebido(s)`} tone="orange" />
        <Metric icon="!" label="PENDÊNCIAS" value={String(finance.overdueCount)} trend={`${formatMoney(finance.overdueCents)} em atraso`} tone="red" negative />
      </section>

      <section className="dashboard-grid">
        <div className="card schedule-card">
          <CardHeader title="Turmas ativas" subtitle={`${teams.length} turmas · ${totalTeamAthletes} matrículas`} action="Ver turmas" onAction={() => setSection("Turmas")} />
          <div className="schedule-list">
            {teams.slice(0, 3).map((item) => (
              <div className="schedule-item" key={item.id}>
                <div className="time"><strong>{item.startTime}</strong><small>{item.scheduleDays.join(" · ")}</small></div>
                <span className={`timeline-dot ${item.color}`} />
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

        <div className="card finance-card">
          <CardHeader title="Receita mensal" subtitle="Comparativo últimos 12 meses" action="Detalhes" onAction={() => setSection("Financeiro")} />
          <div className="chart-head"><div><strong>{formatMoney(finance.receivedCents)}</strong><span>mês atual</span></div><small>Previsto: {formatMoney(finance.expectedCents)}</small></div>
          <div className="bar-chart" aria-label="Gráfico de receita mensal">
            {financeBars.map((height, index) => <span key={index} className={index === 11 ? "current" : ""} style={{ height: `${height}%` }} />)}
          </div>
          <div className="chart-labels"><span>AGO</span><span>OUT</span><span>DEZ</span><span>FEV</span><span>ABR</span><span>JUN</span><b>JUL</b></div>
          <div className="finance-summary">
            <div><span className="legend received" /><p><small>RECEBIDO</small><strong>{formatMoney(finance.receivedCents)}</strong></p></div>
            <div><span className="legend pending" /><p><small>A RECEBER</small><strong>{formatMoney(finance.pendingCents + finance.overdueCents)}</strong></p></div>
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <div className="card athletes-card">
          <CardHeader title="Atletas em destaque" subtitle="Frequência e evolução no mês" action="Ver todos" onAction={() => setSection("Atletas")} />
          <div className="athlete-table">
            <div className="table-row table-head"><span>ATLETA</span><span>CATEGORIA</span><span>FREQUÊNCIA</span><span>FINANCEIRO</span></div>
            {athletes.slice(0, 3).map((athlete) => <AthleteRow key={athlete.id} athlete={athlete} onOpen={onOpenAthlete} />)}
            {athletes.length === 0 && <EmptyAthletes compact />}
          </div>
        </div>

        <div className="card attention-card">
          <CardHeader title="Precisa de atenção" subtitle="Ações importantes para hoje" />
          <button onClick={() => setSection("Financeiro")}><span className="attention-icon red">!</span><p><strong>{finance.overdueCount} mensalidade(s) vencida(s)</strong><small>{formatMoney(finance.overdueCents)} em aberto</small></p><b>›</b></button>
          <button onClick={() => setSection("Avaliações")}><span className="attention-icon orange">↗</span><p><strong>5 avaliações pendentes</strong><small>Prazo até 31 de julho</small></p><b>›</b></button>
          <button onClick={() => notify("Comunicado aberto para revisão.")}><span className="attention-icon blue">◌</span><p><strong>Comunicado agendado</strong><small>Festival interno · Amanhã, 9h</small></p><b>›</b></button>
          <div className="all-good"><span>✓</span><p><strong>Documentação em dia</strong><small>Nenhuma pendência cadastral</small></p></div>
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
  notify: (message: string) => void;
}) {
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteCategory, setAthleteCategory] = useState("all");
  const [teamQuery, setTeamQuery] = useState("");
  const [teamCategory, setTeamCategory] = useState("all");
  const [teamDay, setTeamDay] = useState("all");
  const [teamSort, setTeamSort] = useState<"schedule" | "name" | "category">("schedule");
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

  const descriptions: Record<Section, string> = {
    "Visão geral": "",
    Atletas: "Cadastre, localize e mantenha os dados dos atletas organizados.",
    Prontuário: "Acesse informações médicas, autorizações, documentos e histórico individual.",
    Turmas: "Horários, categorias, professores e capacidade das turmas.",
    Presença: "Acompanhe frequência, ausências e reposições.",
    "QR e entrada": "Leia o cartão do atleta, registre presença e avise o responsável.",
    Financeiro: "Mensalidades, cobranças, fluxo de caixa e inadimplência.",
    Planos: "Planos de mensalidade, faturamento e vínculo de cobrança por atleta.",
    Treinos: "Planejamento de sessões e biblioteca de exercícios.",
    Avaliações: "Evolução técnica, física, tática e comportamental.",
    Comunicação: "Avisos segmentados para responsáveis, atletas e equipe.",
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
            {section === "Atletas" ? "CADASTRO" : section === "Prontuário" ? "ATLETAS" : "BASEFORTE"}
          </span>
          <h1>{section}</h1>
          <p>{descriptions[section]}</p>
        </div>
        {section === "Prontuário" ? (
          <button className="primary-button" onClick={() => setRecordPickerOpen(true)}>
            ＋ Adicionar prontuário
          </button>
        ) : (
          <button className="primary-button" onClick={action}>＋ {actionLabel}</button>
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
                <span>⌕</span>
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
          <div className="athlete-table expanded">
            <div className="table-row table-head"><span>ATLETA</span><span>CATEGORIA</span><span>FREQUÊNCIA</span><span>FINANCEIRO</span></div>
            {visibleAthletes.map((athlete) => <AthleteRow key={athlete.id} athlete={athlete} onOpen={onOpenAthlete} />)}
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
                  <span>⌕</span>
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
                <span>⌕</span>
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
            {teams.length === 0 && <div className="card class-empty"><span>▦</span><strong>Nenhuma turma cadastrada</strong><small>Crie a primeira turma e selecione os atletas participantes.</small><button className="primary-button" onClick={onNewTeam}>Criar primeira turma</button></div>}
            {teams.length > 0 && visibleTeams.length === 0 && <div className="card class-empty"><span>⌕</span><strong>Nenhuma turma encontrada</strong><small>Ajuste a busca ou o filtro de categoria.</small></div>}
          </div>
        </div>
      ) : section === "Presença" ? (
        <div className="attendance-team-grid">
          {teams.map((team) => (
            <button className="card attendance-team-card" key={team.id} onClick={() => onAttendance(team)}>
              <span className={`attention-icon ${team.color === "orange" ? "orange" : "green"}`}>✓</span>
              <div><strong>{team.name} · {team.category}</strong><small>{team.scheduleDays.join(" e ")} · {team.startTime} · {team.players} atletas</small></div>
              <b>Fazer chamada →</b>
            </button>
          ))}
          {teams.length === 0 && <div className="card class-empty"><span>✓</span><strong>Nenhuma turma disponível</strong><small>Cadastre uma turma antes de registrar presenças.</small><button className="primary-button" onClick={onNewTeam}>Criar turma</button></div>}
        </div>
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
            <button className="modal-close" type="button" onClick={() => setRecordPickerOpen(false)} aria-label="Fechar">×</button>
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

function Metric({ icon, label, value, trend, tone, negative, progress }: { icon: string; label: string; value: string; trend: string; tone: string; negative?: boolean; progress?: boolean }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small className={negative ? "negative" : ""}>{progress && <i className="mini-progress"><b /></i>}{!progress && <b>{negative ? "↓" : "↑"}</b>} {trend}</small></div></article>;
}

function CardHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <div className="card-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button onClick={onAction}>{action} <span>→</span></button>}</div>;
}

function AthleteRow({ athlete, onOpen }: { athlete: Athlete; onOpen: (athlete: Athlete) => void }) {
  return <button className="table-row athlete-row-button" onClick={() => onOpen(athlete)}><span className="athlete-name"><i className={`mini-avatar ${athlete.tone}`}>{athlete.initials}</i><span><strong>{athlete.name}</strong><small>{athlete.age} anos</small></span></span><span><b className="category-tag">{athlete.category}</b></span><span className="attendance-cell"><strong>{athlete.attendance}%</strong><i><b style={{ width: `${athlete.attendance}%` }} /></i></span><span><b className={athlete.status === "Em dia" ? "status-tag paid" : "status-tag pending"}><i />{athlete.status}</b></span></button>;
}

function EmptyAthletes({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "empty-athletes compact" : "empty-athletes"}>
      <span>＋</span>
      <div>
        <strong>Nenhum atleta cadastrado</strong>
        <small>Use “Novo atleta” para salvar o primeiro cadastro.</small>
      </div>
    </div>
  );
}
