"use client";

import { FormEvent, useMemo, useState } from "react";

type Section =
  | "Visão geral"
  | "Atletas"
  | "Turmas"
  | "Presença"
  | "Financeiro"
  | "Treinos"
  | "Avaliações"
  | "Comunicação";

type Athlete = {
  name: string;
  initials: string;
  category: string;
  age: number;
  attendance: number;
  status: "Em dia" | "Pendente";
  tone: string;
};

const navItems: { label: Section; icon: string }[] = [
  { label: "Visão geral", icon: "⌂" },
  { label: "Atletas", icon: "◎" },
  { label: "Turmas", icon: "▦" },
  { label: "Presença", icon: "✓" },
  { label: "Financeiro", icon: "$" },
  { label: "Treinos", icon: "◫" },
  { label: "Avaliações", icon: "↗" },
  { label: "Comunicação", icon: "◌" },
];

const initialAthletes: Athlete[] = [
  { name: "Lucas Mendes", initials: "LM", category: "Sub-11", age: 10, attendance: 96, status: "Em dia", tone: "green" },
  { name: "Gabriel Costa", initials: "GC", category: "Sub-13", age: 12, attendance: 91, status: "Em dia", tone: "navy" },
  { name: "Rafael Almeida", initials: "RA", category: "Sub-9", age: 8, attendance: 88, status: "Pendente", tone: "orange" },
  { name: "Pedro Henrique", initials: "PH", category: "Sub-15", age: 14, attendance: 94, status: "Em dia", tone: "blue" },
  { name: "Arthur Souza", initials: "AS", category: "Sub-7", age: 6, attendance: 82, status: "Em dia", tone: "purple" },
];

const classes = [
  { time: "08:30", category: "Sub-9", coach: "Prof. Diego", players: 18, place: "Campo 1", color: "green" },
  { time: "10:00", category: "Sub-11", coach: "Prof. Marcos", players: 21, place: "Campo 2", color: "blue" },
  { time: "14:30", category: "Sub-13", coach: "Prof. André", players: 19, place: "Campo 1", color: "orange" },
  { time: "16:00", category: "Sub-15", coach: "Prof. Diego", players: 17, place: "Campo 2", color: "purple" },
];

const financeBars = [52, 68, 58, 76, 64, 84, 73, 92, 78, 96, 88, 100];

export default function Home() {
  const [section, setSection] = useState<Section>("Visão geral");
  const [athletes, setAthletes] = useState(initialAthletes);
  const [search, setSearch] = useState("");
  const [showAthleteModal, setShowAthleteModal] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [toast, setToast] = useState("");

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

  function addAthlete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "Novo atleta");
    const category = String(form.get("category") || "Sub-11");
    setAthletes((current) => [
      {
        name,
        initials: name
          .split(" ")
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase(),
        category,
        age: Number(form.get("age")) || 10,
        attendance: 100,
        status: "Em dia",
        tone: "green",
      },
      ...current,
    ]);
    setShowAthleteModal(false);
    notify(`${name} foi adicionado com sucesso.`);
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
          {navItems.slice(0, 5).map((item) => (
            <button
              key={item.label}
              className={section === item.label ? "nav-item active" : "nav-item"}
              onClick={() => setSection(item.label)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.label === "Financeiro" && <span className="nav-badge">3</span>}
            </button>
          ))}
          <p className="nav-label second">DESENVOLVIMENTO</p>
          {navItems.slice(5).map((item) => (
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
            <button className="icon-button" aria-label="Ajuda">?</button>
            <button className="icon-button notification" aria-label="Notificações">♢</button>
            <button className="primary-button" onClick={() => setShowAthleteModal(true)}>
              <span>＋</span> Novo atleta
            </button>
          </div>
        </header>

        <div className="page-content">
          {section === "Visão geral" ? (
            <Dashboard
              athletes={filteredAthletes}
              setSection={setSection}
              onAttendance={() => setShowAttendance(true)}
              notify={notify}
            />
          ) : (
            <SectionView
              section={section}
              athletes={filteredAthletes}
              setShowAthleteModal={setShowAthleteModal}
              setShowAttendance={setShowAttendance}
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
                <label>Categoria<select name="category" defaultValue="Sub-11"><option>Sub-7</option><option>Sub-9</option><option>Sub-11</option><option>Sub-13</option><option>Sub-15</option><option>Sub-17</option></select></label>
              </div>
              <label>Responsável<input name="guardian" required placeholder="Nome do responsável" /></label>
              <button className="primary-button full" type="submit">Cadastrar atleta</button>
            </form>
          </div>
        </div>
      )}

      {showAttendance && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAttendance(false)}>
          <div className="modal attendance-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAttendance(false)} aria-label="Fechar">×</button>
            <span className="eyebrow">CHAMADA RÁPIDA</span>
            <h2 id="attendance-title">Sub-11 · 10:00</h2>
            <p>Marque apenas as ausências. Todos começam como presentes.</p>
            <div className="attendance-list">
              {initialAthletes.slice(0, 4).map((athlete) => (
                <label key={athlete.name}>
                  <span className={`mini-avatar ${athlete.tone}`}>{athlete.initials}</span>
                  <span><strong>{athlete.name}</strong><small>{athlete.category}</small></span>
                  <input type="checkbox" defaultChecked aria-label={`${athlete.name} presente`} />
                  <span className="checkmark">✓</span>
                </label>
              ))}
            </div>
            <button className="primary-button full" onClick={() => { setShowAttendance(false); notify("Chamada salva: 21 atletas presentes."); }}>Salvar chamada</button>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Dashboard({
  athletes,
  setSection,
  onAttendance,
  notify,
}: {
  athletes: Athlete[];
  setSection: (section: Section) => void;
  onAttendance: () => void;
  notify: (message: string) => void;
}) {
  return (
    <>
      <div className="welcome-row">
        <div>
          <span className="eyebrow">QUARTA-FEIRA, 29 DE JULHO</span>
          <h1>Olá, Bruno! <span>👋</span></h1>
          <p>Veja como está a operação da sua escolinha hoje.</p>
        </div>
        <div className="period-pill"><span className="status-dot" /> Temporada 2026 <b>⌄</b></div>
      </div>

      <section className="metrics-grid" aria-label="Indicadores principais">
        <Metric icon="◎" label="ATLETAS ATIVOS" value="126" trend="+8 este mês" tone="green" />
        <Metric icon="✓" label="FREQUÊNCIA MÉDIA" value="91,4%" trend="+2,1% vs. junho" tone="blue" />
        <Metric icon="$" label="RECEITA DO MÊS" value="R$ 18.740" trend="87% da meta" tone="orange" progress />
        <Metric icon="!" label="PENDÊNCIAS" value="7" trend="3 mensalidades vencidas" tone="red" negative />
      </section>

      <section className="dashboard-grid">
        <div className="card schedule-card">
          <CardHeader title="Agenda de hoje" subtitle="4 treinos · 75 atletas previstos" action="Ver agenda" onAction={() => setSection("Turmas")} />
          <div className="schedule-list">
            {classes.map((item, index) => (
              <div className="schedule-item" key={item.time}>
                <div className="time"><strong>{item.time}</strong><small>{index < 2 ? "MANHÃ" : "TARDE"}</small></div>
                <span className={`timeline-dot ${item.color}`} />
                <div className="schedule-info">
                  <strong>{item.category} <span>{item.place}</span></strong>
                  <small>{item.coach} · {item.players} atletas</small>
                </div>
                <button className={index === 1 ? "call-button active" : "call-button"} onClick={onAttendance}>{index === 1 ? "Fazer chamada" : "Ver turma"}</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card finance-card">
          <CardHeader title="Receita mensal" subtitle="Comparativo últimos 12 meses" action="Detalhes" onAction={() => setSection("Financeiro")} />
          <div className="chart-head"><div><strong>R$ 18.740</strong><span>+12,8%</span></div><small>Meta: R$ 21.500</small></div>
          <div className="bar-chart" aria-label="Gráfico de receita mensal">
            {financeBars.map((height, index) => <span key={index} className={index === 11 ? "current" : ""} style={{ height: `${height}%` }} />)}
          </div>
          <div className="chart-labels"><span>AGO</span><span>OUT</span><span>DEZ</span><span>FEV</span><span>ABR</span><span>JUN</span><b>JUL</b></div>
          <div className="finance-summary">
            <div><span className="legend received" /><p><small>RECEBIDO</small><strong>R$ 16.310</strong></p></div>
            <div><span className="legend pending" /><p><small>A RECEBER</small><strong>R$ 2.430</strong></p></div>
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <div className="card athletes-card">
          <CardHeader title="Atletas em destaque" subtitle="Frequência e evolução no mês" action="Ver todos" onAction={() => setSection("Atletas")} />
          <div className="athlete-table">
            <div className="table-row table-head"><span>ATLETA</span><span>CATEGORIA</span><span>FREQUÊNCIA</span><span>FINANCEIRO</span></div>
            {athletes.slice(0, 4).map((athlete) => <AthleteRow key={athlete.name} athlete={athlete} />)}
          </div>
        </div>

        <div className="card attention-card">
          <CardHeader title="Precisa de atenção" subtitle="Ações importantes para hoje" />
          <button onClick={() => setSection("Financeiro")}><span className="attention-icon red">!</span><p><strong>3 mensalidades vencidas</strong><small>R$ 780 em aberto</small></p><b>›</b></button>
          <button onClick={() => setSection("Avaliações")}><span className="attention-icon orange">↗</span><p><strong>5 avaliações pendentes</strong><small>Prazo até 31 de julho</small></p><b>›</b></button>
          <button onClick={() => notify("Comunicado aberto para revisão.")}><span className="attention-icon blue">◌</span><p><strong>Comunicado agendado</strong><small>Festival interno · Amanhã, 9h</small></p><b>›</b></button>
          <div className="all-good"><span>✓</span><p><strong>Documentação em dia</strong><small>Nenhuma pendência cadastral</small></p></div>
        </div>
      </section>
    </>
  );
}

function SectionView({
  section,
  athletes,
  setShowAthleteModal,
  setShowAttendance,
  notify,
}: {
  section: Section;
  athletes: Athlete[];
  setShowAthleteModal: (show: boolean) => void;
  setShowAttendance: (show: boolean) => void;
  notify: (message: string) => void;
}) {
  const descriptions: Record<Section, string> = {
    "Visão geral": "",
    Atletas: "Perfis, responsáveis, documentos e histórico esportivo.",
    Turmas: "Horários, categorias, professores e capacidade das turmas.",
    Presença: "Acompanhe frequência, ausências e reposições.",
    Financeiro: "Mensalidades, cobranças, fluxo de caixa e inadimplência.",
    Treinos: "Planejamento de sessões e biblioteca de exercícios.",
    Avaliações: "Evolução técnica, física, tática e comportamental.",
    Comunicação: "Avisos segmentados para responsáveis, atletas e equipe.",
  };

  const action = section === "Atletas" ? () => setShowAthleteModal(true) : section === "Presença" ? () => setShowAttendance(true) : () => notify(`Novo item de ${section.toLowerCase()} preparado.`);

  return (
    <>
      <div className="section-heading">
        <div><span className="eyebrow">BASEFORTE</span><h1>{section}</h1><p>{descriptions[section]}</p></div>
        <button className="primary-button" onClick={action}>＋ {section === "Presença" ? "Fazer chamada" : "Novo registro"}</button>
      </div>
      {section === "Atletas" ? (
        <div className="card module-card">
          <div className="module-toolbar"><strong>{athletes.length} atletas encontrados</strong><div><button className="filter-button">Todas as categorias⌄</button><button className="filter-button">Exportar</button></div></div>
          <div className="athlete-table expanded">
            <div className="table-row table-head"><span>ATLETA</span><span>CATEGORIA</span><span>FREQUÊNCIA</span><span>FINANCEIRO</span></div>
            {athletes.map((athlete) => <AthleteRow key={athlete.name} athlete={athlete} />)}
          </div>
        </div>
      ) : section === "Turmas" ? (
        <div className="class-grid">{classes.map((item) => <div className="card class-card" key={item.category}><span className={`class-stripe ${item.color}`} /><div className="class-top"><span>{item.category}</span><small>{item.place}</small></div><h3>{item.time} · Qua e Sex</h3><p>{item.coach}</p><div className="capacity"><span><b>{item.players}</b> / 24 atletas</span><span>{Math.round((item.players / 24) * 100)}%</span></div><div className="capacity-bar"><i style={{ width: `${(item.players / 24) * 100}%` }} /></div><button onClick={() => notify(`Turma ${item.category} aberta.`)}>Abrir turma →</button></div>)}</div>
      ) : section === "Treinos" ? (
        <div className="module-two-columns">
          <div className="card training-plan"><span className="eyebrow">PRÓXIMA SESSÃO</span><h2>Domínio e progressão</h2><p>Sub-11 · Sexta-feira, 10:00 · 75 minutos</p><div className="drill"><span>01</span><p><strong>Aquecimento com bola</strong><small>Mobilidade + condução · 12 min</small></p></div><div className="drill"><span>02</span><p><strong>Rondo 5 × 2</strong><small>Tomada de decisão · 18 min</small></p></div><div className="drill"><span>03</span><p><strong>Jogo posicional</strong><small>Progressão por setores · 25 min</small></p></div><button className="primary-button" onClick={() => notify("Plano de treino aberto para edição.")}>Editar sessão</button>
          </div>
          <div className="card insight-card"><span className="eyebrow">INSIGHT DA METODOLOGIA</span><h2>Equilibre o conteúdo</h2><div className="radial"><strong>68%</strong><small>com bola</small></div><p>Neste mês, o Sub-11 trabalhou mais fundamentos técnicos. Inclua uma sessão focada em princípios defensivos.</p><button onClick={() => notify("Sugestões adicionadas ao próximo planejamento.")}>Ver sugestões →</button></div>
        </div>
      ) : (
        <GenericModule section={section} notify={notify} setShowAttendance={setShowAttendance} />
      )}
    </>
  );
}

function GenericModule({ section, notify, setShowAttendance }: { section: Section; notify: (message: string) => void; setShowAttendance: (show: boolean) => void }) {
  const data: Record<string, { stat: string; label: string; secondary: string; cards: [string, string][] }> = {
    Presença: { stat: "91,4%", label: "frequência geral", secondary: "4 turmas hoje", cards: [["Sub-9 · 08:30", "17 de 18 presentes"], ["Sub-11 · 10:00", "Chamada pendente"], ["Sub-13 · 14:30", "Começa em 2 horas"]] },
    Financeiro: { stat: "R$ 18.740", label: "receita em julho", secondary: "87% da meta", cards: [["Recebido", "R$ 16.310"], ["A receber", "R$ 2.430"], ["Em atraso", "R$ 780"]] },
    Avaliações: { stat: "74%", label: "avaliações concluídas", secondary: "5 pendentes", cards: [["Técnica", "82% concluído"], ["Física", "76% concluído"], ["Comportamental", "91% concluído"]] },
    Comunicação: { stat: "94%", label: "taxa de leitura", secondary: "328 destinatários", cards: [["Festival interno", "Agendado para amanhã"], ["Recesso escolar", "Enviado · 96% lido"], ["Documentos pendentes", "Rascunho · 7 famílias"]] },
  };
  const module = data[section] || data.Presença;
  return (
    <div className="module-two-columns">
      <div className="card overview-module"><span className="eyebrow">RESUMO DO MÊS</span><strong className="giant-stat">{module.stat}</strong><p>{module.label}</p><span className="soft-tag">{module.secondary}</span><div className="overview-progress"><i style={{ width: section === "Financeiro" ? "87%" : "74%" }} /></div></div>
      <div className="card list-module">
        <CardHeader title={section === "Financeiro" ? "Situação das cobranças" : `Acompanhamento de ${section.toLowerCase()}`} subtitle="Atualizado agora" />
        {module.cards.map(([title, value], index) => <button key={title} onClick={() => section === "Presença" && index === 1 ? setShowAttendance(true) : notify(`${title}: detalhes abertos.`)}><span className={`attention-icon ${index === 1 ? "orange" : "green"}`}>{index + 1}</span><p><strong>{title}</strong><small>{value}</small></p><b>›</b></button>)}
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

function AthleteRow({ athlete }: { athlete: Athlete }) {
  return <div className="table-row"><span className="athlete-name"><i className={`mini-avatar ${athlete.tone}`}>{athlete.initials}</i><span><strong>{athlete.name}</strong><small>{athlete.age} anos</small></span></span><span><b className="category-tag">{athlete.category}</b></span><span className="attendance-cell"><strong>{athlete.attendance}%</strong><i><b style={{ width: `${athlete.attendance}%` }} /></i></span><span><b className={athlete.status === "Em dia" ? "status-tag paid" : "status-tag pending"}><i />{athlete.status}</b></span></div>;
}
