"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AthleteRecord } from "./AthleteProfileModal";

type Plan = {
  id: string;
  name: string;
  amountCents: number;
  dueDay: number;
  category: string | null;
};

type Billing = {
  athleteId: string;
  athleteName: string;
  category: string;
  planId: string;
  planName: string;
  planAmountCents: number;
  planDueDay: number;
  discountType: "none" | "fixed" | "percent";
  discountValue: number;
  customDueDay: number | null;
  active: boolean;
};

type Charge = {
  id: string;
  athleteId: string;
  athleteName: string;
  category: string;
  amountCents: number;
  dueDate: string;
  paidAt: string | null;
  paidAmountCents: number | null;
  paymentMethod: "cash" | "pix" | "card" | "bank" | "other" | null;
  planName: string | null;
  notes: string | null;
  externalProvider: string | null;
  externalPaymentId: string | null;
  invoiceUrl: string | null;
  externalStatus: string | null;
  status: "open" | "paid" | "partial" | "overdue" | "cancelled";
};

type FinancePayload = {
  plans: Plan[];
  archivedPlans: Plan[];
  billing: Billing[];
  charges: Charge[];
  summary: {
    receivedCents: number;
    pendingCents: number;
    overdueCents: number;
    expectedCents: number;
    paidCount: number;
    overdueCount: number;
  };
  error?: string;
  paymentIntegration?: {
    provider: string;
    configured: boolean;
    environment: string;
  };
};

const emptyPayload: FinancePayload = {
  plans: [],
  archivedPlans: [],
  billing: [],
  charges: [],
  summary: {
    receivedCents: 0,
    pendingCents: 0,
    overdueCents: 0,
    expectedCents: 0,
    paidCount: 0,
    overdueCount: 0,
  },
};

const methodLabels = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  bank: "Transferência",
  other: "Outro",
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

async function readJson<T>(response: Response) {
  return (await response.json()) as T & { error?: string };
}

export function FinanceManagement({
  view,
  athletes,
  notify,
  onChanged,
  onOpenPlans,
}: {
  view: "overview" | "plans";
  athletes: AthleteRecord[];
  notify: (message: string) => void;
  onChanged: () => void;
  onOpenPlans: () => void;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<FinancePayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [planModal, setPlanModal] = useState<Plan | "new" | null>(null);
  const [billingAthlete, setBillingAthlete] = useState<AthleteRecord | null>(null);
  const [paymentCharge, setPaymentCharge] = useState<Charge | null>(null);
  const [chargeAction, setChargeAction] = useState<{
    charge: Charge;
    type: "cancel" | "reverse";
  } | null>(null);
  const [chargeQuery, setChargeQuery] = useState("");
  const [chargeStatusFilter, setChargeStatusFilter] = useState<
    "all" | "received" | Charge["status"]
  >("all");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone?: "default" | "danger";
    onConfirm: () => void;
  } | null>(null);

  const loadFinance = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/finance/summary?month=${month}`);
      const payload = await readJson<FinancePayload>(response);
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar o financeiro.");
      }
      setData(payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao carregar o financeiro.");
    } finally {
      setLoading(false);
    }
  }, [month, notify]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadFinance(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadFinance]);

  const billingByAthlete = useMemo(
    () => new Map(data.billing.map((item) => [item.athleteId, item])),
    [data.billing],
  );

  const athleteCategories = useMemo(
    () => Array.from(new Set(athletes.map((athlete) => athlete.category).filter(Boolean))).sort(),
    [athletes],
  );

  const [billingQuery, setBillingQuery] = useState("");
  const visibleBillingAthletes = useMemo(() => {
    const query = billingQuery.trim().toLowerCase();
    if (!query) return athletes;
    return athletes.filter((athlete) => athlete.name.toLowerCase().includes(query));
  }, [athletes, billingQuery]);

  const filteredCharges = useMemo(() => {
    const query = chargeQuery.trim().toLowerCase();
    return data.charges.filter((charge) => {
      if (chargeStatusFilter === "received") {
        if (charge.status !== "paid" && charge.status !== "partial") return false;
      } else if (chargeStatusFilter !== "all" && charge.status !== chargeStatusFilter) {
        return false;
      }
      if (query && !charge.athleteName.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [data.charges, chargeQuery, chargeStatusFilter]);

  async function generateCharges() {
    if (data.plans.length === 0) {
      setPlanModal("new");
      notify("Crie um plano antes de gerar mensalidades.");
      return;
    }
    setWorking(true);
    try {
      const response = await fetch("/api/finance/charges/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const payload = await readJson<{
        createdCount: number;
        skippedCount: number;
        configuredCount: number;
      }>(response);
      if (!response.ok) throw new Error(payload.error);
      if (payload.configuredCount === 0) {
        notify("Configure um plano para pelo menos um atleta.");
      } else {
        notify(
          `${payload.createdCount} mensalidade(s) gerada(s). ${payload.skippedCount} já existia(m).`,
        );
      }
      await loadFinance();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível gerar as mensalidades.");
    } finally {
      setWorking(false);
    }
  }

  function archivePlan(plan: Plan) {
    setConfirmDialog({
      title: "Arquivar plano",
      message: `O plano "${plan.name}" sai da lista de planos ativos e não pode mais ser vinculado a novos atletas. Cobranças já geradas continuam normalmente, e o plano pode ser reativado depois na lista de arquivados.`,
      confirmLabel: "Arquivar plano",
      tone: "danger",
      onConfirm: () => {
        setConfirmDialog(null);
        void doArchivePlan(plan);
      },
    });
  }

  async function doArchivePlan(plan: Plan) {
    const response = await fetch(`/api/finance/plans/${plan.id}`, {
      method: "DELETE",
    });
    const payload = await readJson<{ archived: boolean }>(response);
    if (!response.ok) {
      notify(payload.error || "Não foi possível arquivar o plano.");
      return;
    }
    notify("Plano arquivado. Você pode reativá-lo quando quiser.");
    setPlanModal(null);
    await loadFinance();
  }

  async function restorePlan(plan: Plan) {
    setWorking(true);
    try {
      const response = await fetch(`/api/finance/plans/${plan.id}/restore`, {
        method: "POST",
      });
      const payload = await readJson<{ plan: Plan }>(response);
      if (!response.ok) throw new Error(payload.error);
      notify(`Plano "${plan.name}" reativado.`);
      await loadFinance();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível reativar o plano.");
    } finally {
      setWorking(false);
    }
  }

  async function updateCharge(
    charge: Charge,
    action: "cancel" | "reverse" | "restore",
    notes?: string,
  ) {
    setWorking(true);
    try {
      const response = await fetch(`/api/finance/charges/${charge.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes }),
      });
      const payload = await readJson<{ updated: boolean }>(response);
      if (!response.ok) throw new Error(payload.error);
      notify(
        action === "cancel"
          ? "Lançamento cancelado e mantido no histórico."
          : action === "reverse"
            ? "Baixa estornada. A mensalidade voltou para aberto."
            : "Lançamento reativado.",
      );
      setChargeAction(null);
      await loadFinance();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível atualizar o lançamento.");
    } finally {
      setWorking(false);
    }
  }

  async function sendCharge(charge: Charge) {
    setWorking(true);
    try {
      const response = await fetch(`/api/finance/charges/${charge.id}/send`, {
        method: "POST",
      });
      const payload = await readJson<{ invoiceUrl?: string }>(response);
      if (!response.ok) throw new Error(payload.error);
      notify("Cobrança emitida no Asaas Sandbox.");
      await loadFinance();
      if (payload.invoiceUrl) window.open(payload.invoiceUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível emitir a cobrança.");
    } finally {
      setWorking(false);
    }
  }

  const overdueToCharge = useMemo(
    () => data.charges.filter((charge) => charge.status === "overdue" && !charge.invoiceUrl),
    [data.charges],
  );

  async function chargeAllOverdue() {
    if (overdueToCharge.length === 0) return;
    setWorking(true);
    let success = 0;
    for (const charge of overdueToCharge) {
      try {
        const response = await fetch(`/api/finance/charges/${charge.id}/send`, { method: "POST" });
        if (response.ok) success += 1;
      } catch {
        // segue para a próxima cobrança
      }
    }
    notify(`${success} de ${overdueToCharge.length} cobrança(s) vencida(s) emitida(s) no Asaas Sandbox.`);
    await loadFinance();
    setWorking(false);
  }

  function applyPlanToCategory(plan: Plan) {
    if (!plan.category) return;
    const targets = athletes.filter(
      (athlete) => athlete.category === plan.category && !billingByAthlete.get(athlete.id)?.active,
    );
    if (targets.length === 0) {
      notify(`Todos os atletas da categoria ${plan.category} já têm um plano vinculado.`);
      return;
    }
    setConfirmDialog({
      title: "Vincular plano à categoria",
      message: `Vincular o plano "${plan.name}" aos ${targets.length} atleta(s) da categoria ${plan.category} que ainda não têm plano configurado?`,
      confirmLabel: `Vincular ${targets.length} atleta(s)`,
      onConfirm: () => {
        setConfirmDialog(null);
        void doApplyPlanToCategory(plan, targets);
      },
    });
  }

  async function doApplyPlanToCategory(plan: Plan, targets: AthleteRecord[]) {
    setWorking(true);
    let success = 0;
    for (const athlete of targets) {
      try {
        const response = await fetch(`/api/finance/athletes/${athlete.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.id,
            discountType: "none",
            discountValue: 0,
            customDueDay: null,
            active: true,
          }),
        });
        if (response.ok) success += 1;
      } catch {
        // segue para o próximo atleta
      }
    }
    notify(`${success} de ${targets.length} atleta(s) da categoria ${plan.category} vinculado(s) ao plano "${plan.name}".`);
    await loadFinance();
    setWorking(false);
  }

  const configuredCount = data.billing.filter((item) => item.active).length;

  if (view === "plans") {
    const receivedPct = data.summary.expectedCents > 0 ? (data.summary.receivedCents / data.summary.expectedCents) * 100 : 0;
    const pendingPct = data.summary.expectedCents > 0 ? (data.summary.pendingCents / data.summary.expectedCents) * 100 : 0;
    const donutStyle =
      data.summary.expectedCents > 0
        ? {
            background: `conic-gradient(var(--green) 0% ${receivedPct}%, #e2a33e ${receivedPct}% ${receivedPct + pendingPct}%, #d1554b ${receivedPct + pendingPct}% 100%)`,
          }
        : { background: "#eef1ef" };

    return (
      <>
        <div className="section-heading finance-heading">
          <div>
            <span className="eyebrow">GESTÃO FINANCEIRA</span>
            <h1>Planos</h1>
            <p>Planos de mensalidade, faturamento e vínculo de cobrança por atleta.</p>
          </div>
          <div className="finance-heading-actions">
            <button className="primary-button" onClick={() => setPlanModal("new")}>＋ Novo plano</button>
          </div>
        </div>

        <section className="plans-page-grid">
          <div className="card plans-active-card">
            <div className="card-header">
              <div>
                <h2>Planos ativos</h2>
                <p>
                  {data.plans.length} plano(s) ativo(s)
                  {data.archivedPlans.length > 0 ? ` · ${data.archivedPlans.length} arquivado(s)` : ""} · clique para editar
                </p>
              </div>
            </div>
            <div className="plans-grid">
              {data.plans.map((plan) => (
                <button className="plan-tile" key={plan.id} onClick={() => setPlanModal(plan)}>
                  <span className="plan-tile-top">
                    <strong>{plan.name}</strong>
                    {plan.category && <b className="plan-tile-category">{plan.category}</b>}
                  </span>
                  <strong className="plan-tile-price">{money(plan.amountCents)}</strong>
                  <small>Vence dia {plan.dueDay}</small>
                </button>
              ))}
              <button className="plan-tile new-plan-tile" onClick={() => setPlanModal("new")}>＋ Criar plano</button>
              {data.plans.length === 0 && (
                <div className="finance-empty small"><strong>Nenhum plano cadastrado</strong></div>
              )}
              {data.archivedPlans.map((plan) => (
                <button
                  className="plan-tile plan-tile-archived"
                  key={plan.id}
                  disabled={working}
                  title="Clique para reativar este plano"
                  onClick={() => void restorePlan(plan)}
                >
                  <span className="plan-tile-top">
                    <strong>{plan.name}</strong>
                    <b className="plan-tile-category archived">Arquivado</b>
                  </span>
                  <strong className="plan-tile-price">{money(plan.amountCents)}</strong>
                  <small>Reativar →</small>
                </button>
              ))}
            </div>
          </div>

          <div className="card finance-trend finance-trend-full">
            <div className="card-header">
              <div><h2>Faturamento de {monthLabel(month)}</h2><p>Composição do previsto do mês</p></div>
            </div>
            {data.summary.expectedCents > 0 ? (
              <div className="finance-donut-wrap">
                <div className="finance-donut" style={donutStyle}>
                  <div className="finance-donut-center">
                    <strong>{money(data.summary.expectedCents)}</strong>
                    <small>previsto</small>
                  </div>
                </div>
                <div className="finance-donut-legend">
                  <span><i className="received" />Recebido<b>{money(data.summary.receivedCents)}</b></span>
                  <span><i className="pending" />A receber<b>{money(data.summary.pendingCents)}</b></span>
                  <span><i className="overdue" />Em atraso<b>{money(data.summary.overdueCents)}</b></span>
                </div>
              </div>
            ) : (
              <div className="finance-empty small"><strong>Nenhuma mensalidade gerada este mês</strong></div>
            )}
          </div>

          <aside className="card billing-config-card billing-config-full">
            <div className="card-header">
              <div><h2>Configuração de cobrança</h2><p>{configuredCount} de {athletes.length} atletas configurados</p></div>
            </div>
            <label className="athlete-list-search billing-search">
              <span>⌕</span>
              <input
                aria-label="Pesquisar atleta na configuração de cobrança"
                value={billingQuery}
                onChange={(event) => setBillingQuery(event.target.value)}
                placeholder="Pesquisar atleta..."
              />
              {billingQuery && (
                <button type="button" className="search-clear" aria-label="Limpar busca" onClick={() => setBillingQuery("")}>×</button>
              )}
            </label>
            <div className="billing-list">
              {visibleBillingAthletes.map((athlete) => {
                const billing = billingByAthlete.get(athlete.id);
                return (
                  <button key={athlete.id} onClick={() => setBillingAthlete(athlete)}>
                    <i className={`mini-avatar ${athlete.tone}`}>{athlete.initials}</i>
                    <span><strong>{athlete.name}</strong><small>{billing ? `${billing.planName} · vence dia ${billing.customDueDay ?? billing.planDueDay}` : "Sem plano vinculado"}</small></span>
                    <b className={billing?.active ? "configured" : ""}>{billing?.active ? "Editar" : "Configurar"} →</b>
                  </button>
                );
              })}
              {athletes.length === 0 && <div className="finance-empty small"><strong>Cadastre atletas primeiro</strong></div>}
              {athletes.length > 0 && visibleBillingAthletes.length === 0 && (
                <div className="finance-empty small"><strong>Nenhum atleta encontrado</strong></div>
              )}
            </div>
          </aside>
        </section>

        {planModal && (
          <PlanModal
            plan={planModal === "new" ? null : planModal}
            categories={athleteCategories}
            notify={notify}
            onClose={() => setPlanModal(null)}
            onSaved={async (message) => {
              setPlanModal(null);
              notify(message);
              await loadFinance();
            }}
            onArchive={archivePlan}
            onApplyToCategory={applyPlanToCategory}
          />
        )}
        {billingAthlete && (
          <BillingModal
            athlete={billingAthlete}
            plans={data.plans}
            current={billingByAthlete.get(billingAthlete.id)}
            notify={notify}
            onClose={() => setBillingAthlete(null)}
            onSaved={async () => {
              setBillingAthlete(null);
              notify("Configuração de cobrança salva.");
              await loadFinance();
            }}
          />
        )}
        {confirmDialog && (
          <ConfirmModal
            title={confirmDialog.title}
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmLabel}
            tone={confirmDialog.tone}
            onCancel={() => setConfirmDialog(null)}
            onConfirm={confirmDialog.onConfirm}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="section-heading finance-heading">
        <div>
          <span className="eyebrow">GESTÃO FINANCEIRA</span>
          <h1>Financeiro</h1>
          <p>Mensalidades, recebimentos e inadimplência do mês em um só lugar.</p>
          <span className={data.paymentIntegration?.configured ? "integration-badge ready" : "integration-badge"}>
            {data.paymentIntegration?.configured ? "Asaas Sandbox conectado" : "Asaas Sandbox aguardando chave"}
          </span>
        </div>
        <div className="finance-heading-actions">
          <label>
            Mês de referência
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          {overdueToCharge.length > 0 && (
            <button
              className="filter-button warn"
              disabled={working}
              title="Emite PIX/boleto no Asaas Sandbox para todas as mensalidades vencidas que ainda não têm cobrança emitida."
              onClick={() => void chargeAllOverdue()}
            >
              Cobrar vencidos ({overdueToCharge.length})
            </button>
          )}
          <button
            className="primary-button"
            disabled={working}
            title="Cria a mensalidade do mês selecionado para cada atleta com plano vinculado. Não duplica cobranças já geradas."
            onClick={() => void generateCharges()}
          >
            {working ? "Processando..." : "Gerar mensalidades"}
          </button>
        </div>
      </div>

      {(data.plans.length === 0 || configuredCount === 0) && (
        <div className="finance-steps">
          <span><b>1</b>Crie um <strong>plano</strong> (valor e dia de vencimento) em <button type="button" className="link-button" onClick={onOpenPlans}>Financeiro → Planos</button></span>
          <span><b>2</b>Vincule o <strong>atleta ao plano</strong> em Planos → Configuração de cobrança</span>
          <span><b>3</b>Clique em <strong>“Gerar mensalidades”</strong> para criar as cobranças do mês</span>
        </div>
      )}

      <section className="finance-metrics">
        <FinanceMetric
          icon="$"
          label="PREVISTO"
          value={money(data.summary.expectedCents)}
          detail={monthLabel(month)}
          tone="green"
          active={chargeStatusFilter === "all"}
          onClick={() => setChargeStatusFilter("all")}
        />
        <FinanceMetric
          icon="✓"
          label="RECEBIDO"
          value={money(data.summary.receivedCents)}
          detail={`${data.summary.paidCount} baixa(s)`}
          tone="blue"
          active={chargeStatusFilter === "received"}
          onClick={() => setChargeStatusFilter("received")}
        />
        <FinanceMetric
          icon="◌"
          label="A RECEBER"
          value={money(data.summary.pendingCents)}
          detail="dentro do vencimento"
          tone="orange"
          active={chargeStatusFilter === "open"}
          onClick={() => setChargeStatusFilter("open")}
        />
        <FinanceMetric
          icon="!"
          label="EM ATRASO"
          value={money(data.summary.overdueCents)}
          detail={`${data.summary.overdueCount} vencida(s)`}
          tone="red"
          active={chargeStatusFilter === "overdue"}
          onClick={() => setChargeStatusFilter("overdue")}
        />
      </section>

      {data.summary.expectedCents > 0 && (
        <div className="finance-progress">
          <div className="finance-progress-bar">
            <span className="received" style={{ width: `${(data.summary.receivedCents / data.summary.expectedCents) * 100}%` }} />
            <span className="pending" style={{ width: `${(data.summary.pendingCents / data.summary.expectedCents) * 100}%` }} />
            <span className="overdue" style={{ width: `${(data.summary.overdueCents / data.summary.expectedCents) * 100}%` }} />
          </div>
          <div className="finance-progress-legend">
            <span><i className="received" />Recebido <b>{Math.round((data.summary.receivedCents / data.summary.expectedCents) * 100)}%</b></span>
            <span><i className="pending" />A receber <b>{Math.round((data.summary.pendingCents / data.summary.expectedCents) * 100)}%</b></span>
            <span><i className="overdue" />Em atraso <b>{Math.round((data.summary.overdueCents / data.summary.expectedCents) * 100)}%</b></span>
          </div>
        </div>
      )}

      <div className="card finance-charges">
        <div className="card-header">
          <div>
            <h2>Mensalidades de {monthLabel(month)}</h2>
            <p>{data.charges.length} cobranças · atualização automática de vencimentos</p>
          </div>
          <span className={loading ? "finance-loading" : "finance-ready"}>
            {loading ? "Carregando..." : "Atualizado"}
          </span>
        </div>
        <div className="athlete-list-toolbar finance-charges-toolbar">
          <div className="athlete-search-wrap">
            <label className="athlete-list-search">
              <span>⌕</span>
              <input
                aria-label="Pesquisar cobrança por atleta"
                value={chargeQuery}
                onChange={(event) => setChargeQuery(event.target.value)}
                placeholder="Pesquisar atleta..."
              />
              {chargeQuery && (
                <button type="button" className="search-clear" aria-label="Limpar busca" onClick={() => setChargeQuery("")}>×</button>
              )}
            </label>
          </div>
          <label className="athlete-category-filter">
            <span>Situação</span>
            <select
              value={chargeStatusFilter}
              onChange={(event) => setChargeStatusFilter(event.target.value as typeof chargeStatusFilter)}
            >
              <option value="all">Todas</option>
              <option value="received">Recebidas (parcial ou total)</option>
              <option value="open">Em aberto</option>
              <option value="partial">Parcial</option>
              <option value="overdue">Vencido</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </label>
          <strong>{filteredCharges.length} resultado(s)</strong>
        </div>
        <div className="charge-table">
          <div className="charge-row charge-head">
            <span>ATLETA</span><span>VENCIMENTO</span><span>VALOR</span><span>SITUAÇÃO</span><span />
          </div>
          {filteredCharges.map((charge) => (
            <div className="charge-row" key={charge.id}>
              <span className="charge-athlete">
                <i>{charge.athleteName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</i>
                <span><strong>{charge.athleteName}</strong><small>{charge.planName || charge.category}</small></span>
              </span>
              <span><strong>{new Date(`${charge.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</strong><small>{charge.paymentMethod ? methodLabels[charge.paymentMethod] : "Mensalidade"}</small></span>
              <span>
                <strong>{money(charge.amountCents)}</strong>
                {charge.paidAmountCents !== null && charge.paidAmountCents !== charge.amountCents && (
                  <>
                    <i className="charge-progress"><b style={{ width: `${Math.round((charge.paidAmountCents / charge.amountCents) * 100)}%` }} /></i>
                    <small>Recebido {money(charge.paidAmountCents)} · Saldo {money(charge.amountCents - charge.paidAmountCents)}</small>
                  </>
                )}
              </span>
              <span><b className={`charge-status ${charge.status}`}>{charge.status === "paid" ? "Pago" : charge.status === "partial" ? "Parcial" : charge.status === "overdue" ? "Vencido" : charge.status === "cancelled" ? "Cancelado" : "Em aberto"}</b></span>
              <span className="charge-actions">
                {(charge.status === "open" || charge.status === "overdue") && (
                  <>
                    {charge.invoiceUrl ? (
                      <a href={charge.invoiceUrl} target="_blank" rel="noreferrer">Abrir cobrança</a>
                    ) : (
                      <button title="Emitir PIX ou boleto" disabled={working} onClick={() => void sendCharge(charge)}>Cobrar</button>
                    )}
                    <button onClick={() => setPaymentCharge(charge)}>Dar baixa</button>
                    <button className="danger-link" disabled={working} onClick={() => setChargeAction({ charge, type: "cancel" })}>Cancelar</button>
                  </>
                )}
                {charge.status === "partial" && (
                  <>
                    <button onClick={() => setPaymentCharge(charge)}>Dar baixa</button>
                    <button className="danger-link" disabled={working} onClick={() => setChargeAction({ charge, type: "reverse" })}>
                      Estornar baixa
                    </button>
                  </>
                )}
                {charge.status === "paid" && (
                  <button className="danger-link" disabled={working} onClick={() => setChargeAction({ charge, type: "reverse" })}>
                    Estornar baixa
                  </button>
                )}
                {charge.status === "cancelled" && (
                  <button
                    disabled={working}
                    onClick={() =>
                      setConfirmDialog({
                        title: "Reativar mensalidade",
                        message: `A mensalidade de ${charge.athleteName} volta para o status anterior (em aberto ou vencida).`,
                        confirmLabel: "Reativar",
                        onConfirm: () => {
                          setConfirmDialog(null);
                          void updateCharge(charge, "restore");
                        },
                      })
                    }
                  >
                    Reativar
                  </button>
                )}
              </span>
            </div>
          ))}
          {!loading && data.charges.length === 0 && (
            <div className="finance-empty">
              <span>$</span><strong>Nenhuma mensalidade neste mês</strong>
              <small>Configure os planos e atletas em <button type="button" className="link-button" onClick={onOpenPlans}>Planos</button> e clique em “Gerar mensalidades”.</small>
            </div>
          )}
          {!loading && data.charges.length > 0 && filteredCharges.length === 0 && (
            <div className="finance-empty">
              <span>⌕</span><strong>Nenhuma cobrança encontrada</strong>
              <small>Ajuste a busca ou o filtro de situação.</small>
            </div>
          )}
        </div>
      </div>

      {paymentCharge && (
        <PaymentModal
          charge={paymentCharge}
          notify={notify}
          onClose={() => setPaymentCharge(null)}
          onSaved={async () => {
            setPaymentCharge(null);
            notify("Pagamento registrado com sucesso.");
            await loadFinance();
            onChanged();
          }}
        />
      )}
      {chargeAction && (
        <ChargeActionModal
          charge={chargeAction.charge}
          type={chargeAction.type}
          working={working}
          onClose={() => setChargeAction(null)}
          onConfirm={(reason) =>
            void updateCharge(chargeAction.charge, chargeAction.type, reason)
          }
        />
      )}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
        />
      )}
    </>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  tone = "default",
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onCancel}>×</button>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-modal-buttons">
          <button className="filter-button" type="button" onClick={onCancel}>Cancelar</button>
          <button
            className={tone === "danger" ? "danger-confirm-button" : "primary-button"}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChargeActionModal({
  charge,
  type,
  working,
  onClose,
  onConfirm,
}: {
  charge: Charge;
  type: "cancel" | "reverse";
  working: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const reversing = type === "reverse";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="charge-action-modal" role="dialog" aria-modal="true" aria-labelledby="charge-action-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">{reversing ? "CORREÇÃO DE PAGAMENTO" : "CORREÇÃO DE LANÇAMENTO"}</span>
            <h2 id="charge-action-title">{reversing ? "Estornar baixa" : "Cancelar lançamento"}</h2>
            <p>
              {reversing
                ? "O pagamento será removido e a mensalidade voltará para aberto ou vencido."
                : "A mensalidade será cancelada, mas continuará disponível no histórico."}
            </p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="charge-action-summary">
          <span><small>ATLETA</small><strong>{charge.athleteName}</strong></span>
          <span><small>VALOR</small><strong>{money(charge.paidAmountCents ?? charge.amountCents)}</strong></span>
          <span><small>VENCIMENTO</small><strong>{new Date(`${charge.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</strong></span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            onConfirm(reason.trim());
          }}
        >
          <label>
            Motivo obrigatório
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reversing ? "Ex.: pagamento lançado no atleta errado" : "Ex.: mensalidade gerada por engano"}
              maxLength={220}
              autoFocus
            />
          </label>
          <div className="charge-action-buttons">
            <button className="filter-button" type="button" onClick={onClose}>Voltar</button>
            <button className="danger-confirm-button" type="submit" disabled={working || !reason.trim()}>
              {working ? "Processando..." : reversing ? "Confirmar estorno" : "Confirmar cancelamento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FinanceMetric({
  icon,
  label,
  value,
  detail,
  tone,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  tone: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`metric-card metric-card-button${active ? " active" : ""}`}
      onClick={onClick}
    >
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </button>
  );
}

function PlanModal({
  plan,
  categories,
  notify,
  onClose,
  onSaved,
  onArchive,
  onApplyToCategory,
}: {
  plan: Plan | null;
  categories: string[];
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: (message: string) => void;
  onArchive: (plan: Plan) => void;
  onApplyToCategory: (plan: Plan) => void;
}) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch(plan ? `/api/finance/plans/${plan.id}` : "/api/finance/plans", {
        method: plan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          amount: Number(form.get("amount")),
          dueDay: Number(form.get("dueDay")),
          category: form.get("category") || null,
        }),
      });
      const payload = await readJson<{ plan: Plan }>(response);
      if (!response.ok) throw new Error(payload.error);
      onSaved(plan ? "Plano atualizado." : "Plano criado com sucesso.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar o plano.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">PLANO DE MENSALIDADE</span>
        <h2>{plan ? "Editar plano" : "Novo plano"}</h2>
        <p>O valor e o vencimento serão copiados para cada nova cobrança.</p>
        <form onSubmit={submit}>
          <label>Nome do plano<input name="name" required defaultValue={plan?.name} placeholder="Ex.: Plano Sub-11" /></label>
          <div className="form-row">
            <label>Valor mensal (R$)<input name="amount" type="number" step="0.01" min="0.01" required defaultValue={plan ? plan.amountCents / 100 : ""} /></label>
            <label>Dia do vencimento<input name="dueDay" type="number" min="1" max="28" required defaultValue={plan?.dueDay ?? 10} /></label>
          </div>
          <label>
            Categoria (opcional)
            <select name="category" defaultValue={plan?.category ?? ""}>
              <option value="">Todas as categorias</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <p className="field-hint">Vincule a uma categoria (ex.: Sub-11) para aplicar este valor automaticamente a todos os atletas dela — útil quando o Sub-18 paga diferente do Sub-08.</p>
          <button className="primary-button full" disabled={saving}>{saving ? "Salvando..." : "Salvar plano"}</button>
          {plan?.category && (
            <button type="button" className="filter-button full" onClick={() => onApplyToCategory(plan)}>
              Aplicar a todos os atletas da categoria {plan.category}
            </button>
          )}
          {plan && <button type="button" className="archive-button full-archive" onClick={() => onArchive(plan)}>Arquivar plano</button>}
        </form>
      </div>
    </div>
  );
}

function BillingModal({
  athlete,
  plans,
  current,
  notify,
  onClose,
  onSaved,
}: {
  athlete: AthleteRecord;
  plans: Plan[];
  current?: Billing;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const discountType = String(form.get("discountType"));
      const rawDiscount = Number(form.get("discountValue")) || 0;
      const response = await fetch(`/api/finance/athletes/${athlete.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: form.get("planId"),
          discountType,
          discountValue: discountType === "fixed" ? Math.round(rawDiscount * 100) : rawDiscount,
          customDueDay: Number(form.get("customDueDay")) || null,
          active: true,
        }),
      });
      const payload = await readJson<{ billing: Billing }>(response);
      if (!response.ok) throw new Error(payload.error);
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">COBRANÇA DO ATLETA</span>
        <h2>{athlete.name}</h2>
        <p>Personalize plano, desconto ou vencimento. Cobranças já geradas não mudam.</p>
        {plans.length === 0 ? (
          <div className="finance-empty small"><strong>Crie um plano antes de continuar.</strong></div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Plano
              <select
                name="planId"
                required
                defaultValue={current?.planId ?? plans.find((plan) => plan.category === athlete.category)?.id ?? plans[0]?.id}
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}{plan.category ? ` · ${plan.category}` : ""} · {money(plan.amountCents)}
                  </option>
                ))}
              </select>
            </label>
            {!current && plans.some((plan) => plan.category === athlete.category) && (
              <p className="field-hint">Sugerimos o plano da categoria {athlete.category} — troque se preferir outro.</p>
            )}
            <div className="form-row">
              <label>Tipo de desconto<select name="discountType" defaultValue={current?.discountType ?? "none"}><option value="none">Sem desconto</option><option value="fixed">Valor fixo (R$)</option><option value="percent">Percentual (%)</option></select></label>
              <label>Desconto<input name="discountValue" type="number" min="0" step="0.01" defaultValue={current ? current.discountType === "fixed" ? current.discountValue / 100 : current.discountValue : 0} /></label>
            </div>
            <label>Vencimento personalizado (opcional)<input name="customDueDay" type="number" min="1" max="28" defaultValue={current?.customDueDay ?? ""} placeholder="Usar o dia definido no plano" /></label>
            <button className="primary-button full" disabled={saving}>{saving ? "Salvando..." : "Salvar configuração"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function PaymentModal({
  charge,
  notify,
  onClose,
  onSaved,
}: {
  charge: Charge;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const remainingCents = charge.amountCents - (charge.paidAmountCents ?? 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch(`/api/finance/charges/${charge.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay",
          paymentMethod: form.get("paymentMethod"),
          paidAmount: Number(form.get("paidAmount")),
          notes: form.get("notes"),
        }),
      });
      const payload = await readJson<{ updated: boolean }>(response);
      if (!response.ok) throw new Error(payload.error);
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível registrar a baixa.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">BAIXA DE PAGAMENTO</span>
        <h2>{charge.athleteName}</h2>
        <p>
          Mensalidade de {money(charge.amountCents)} com vencimento em {new Date(`${charge.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}.
          {charge.status === "partial" && <> Saldo devedor: <strong>{money(remainingCents)}</strong>.</>}
        </p>
        <p>Se o valor recebido for menor que o saldo, a cobrança fica marcada como “Parcial” e o restante continua em aberto.</p>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Valor recebido (R$)<input name="paidAmount" type="number" step="0.01" min="0.01" max={(remainingCents / 100).toFixed(2)} required defaultValue={(remainingCents / 100).toFixed(2)} /></label>
            <label>Forma de pagamento<select name="paymentMethod" defaultValue="pix"><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="bank">Transferência</option><option value="other">Outro</option></select></label>
          </div>
          <label>Observação<input name="notes" maxLength={300} placeholder="Opcional" /></label>
          <button className="primary-button full" disabled={saving}>{saving ? "Registrando..." : "Confirmar recebimento"}</button>
        </form>
      </div>
    </div>
  );
}
