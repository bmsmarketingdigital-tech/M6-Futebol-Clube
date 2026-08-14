"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type LucideIcon,
  Wallet,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MessageCircle,
  Minus,
  Equal,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { AthleteRecord } from "./AthleteProfileModal";
import { planCategoryCompatible, suggestPlanForCategory } from "./athlete-financial-plan";

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

type Expense = {
  id: string;
  referenceMonth: string;
  description: string;
  category: string;
  supplier: string | null;
  amountCents: number;
  dueDate: string;
  paidAt: string | null;
  paymentMethod: "cash" | "pix" | "card" | "bank" | "other" | null;
  status: "open" | "paid" | "overdue" | "cancelled";
  notes: string | null;
  installmentGroupId: string | null;
  installmentNumber: number;
  installmentCount: number;
};

type FinancePayload = {
  plans: Plan[];
  archivedPlans: Plan[];
  billing: Billing[];
  charges: Charge[];
  expenses: Expense[];
  summary: {
    billedCents: number;
    receivedCents: number;
    pendingCents: number;
    overdueCents: number;
    expectedCents: number;
    expensePaidCents: number;
    expensePendingCents: number;
    expenseOverdueCents: number;
    expenseTotalCents: number;
    netCents: number;
    paidCount: number;
    overdueCount: number;
    expensePaidCount: number;
    expensePendingCount: number;
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
  error?: string;
  paymentIntegration?: {
    provider: string;
    configured: boolean;
    environment: string;
  };
};

type NotificationSettings = {
  enabled: boolean;
  beforeDueEnabled: boolean;
  beforeDueDays: number;
  dueTodayEnabled: boolean;
  overdueEnabled: boolean;
  overdueDays: number;
};

type NotificationOverview = {
  sentLast30Days: number;
  failedLast30Days: number;
  recent: {
    id: string;
    athleteName: string;
    type: "before_due" | "due_today" | "overdue" | "enrollment";
    status: "pending" | "processing" | "sent" | "failed" | "delivery_unknown";
    phone: string;
    attemptCount: number;
    lastError: string | null;
    origin: string | null;
    manualResendCount: number;
    sentAt: string | null;
    updatedAt: string;
  }[];
  whatsapp: {
    connected: boolean;
    status: string;
    connectedPhone: string;
  };
};

type NotificationPayload = {
  settings: NotificationSettings;
  overview: NotificationOverview;
};

const emptyPayload: FinancePayload = {
  plans: [],
  archivedPlans: [],
  billing: [],
  charges: [],
  expenses: [],
  summary: {
    billedCents: 0,
    receivedCents: 0,
    pendingCents: 0,
    overdueCents: 0,
    expectedCents: 0,
    expensePaidCents: 0,
    expensePendingCents: 0,
    expenseOverdueCents: 0,
    expenseTotalCents: 0,
    netCents: 0,
    paidCount: 0,
    overdueCount: 0,
    expensePaidCount: 0,
    expensePendingCount: 0,
    openCount: 0,
    openCents: 0,
    dueTodayCount: 0,
    dueTodayCents: 0,
    dueSoonCount: 0,
    dueSoonCents: 0,
    totalOverdueCount: 0,
    totalOverdueCents: 0,
    collectionRate: 0,
  },
};

const emptyNotifications: NotificationPayload = {
  settings: {
    enabled: true,
    beforeDueEnabled: true,
    beforeDueDays: 3,
    dueTodayEnabled: true,
    overdueEnabled: true,
    overdueDays: 5,
  },
  overview: {
    sentLast30Days: 0,
    failedLast30Days: 0,
    recent: [],
    whatsapp: { connected: false, status: "unavailable", connectedPhone: "" },
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
  view: "overview" | "plans" | "expenses";
  athletes: AthleteRecord[];
  notify: (message: string) => void;
  onChanged: () => void;
  onOpenPlans: () => void;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<FinancePayload>(emptyPayload);
  const [notifications, setNotifications] =
    useState<NotificationPayload>(emptyNotifications);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [planModal, setPlanModal] = useState<Plan | "new" | null>(null);
  const [billingAthlete, setBillingAthlete] = useState<AthleteRecord | null>(null);
  const [paymentCharge, setPaymentCharge] = useState<Charge | null>(null);
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);
  const [expensePayment, setExpensePayment] = useState<Expense | null>(null);
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

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/finance/notifications/settings");
      const payload = await readJson<NotificationPayload>(response);
      if (!response.ok) {
        throw new Error(
          payload.error || "Não foi possível carregar as notificações.",
        );
      }
      setNotifications(payload);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Falha ao carregar as notificações.",
      );
    }
  }, [notify]);

  async function seedDemoFinance() {
    setWorking(true);
    try {
      const response = await fetch("/api/finance/demo-seed", { method: "POST" });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o cenário de teste.");
      notify("Cenário criado: mensalidade paga, mensalidade em aberto e gastos de teste.");
      await loadFinance();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível carregar o cenário de teste.");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFinance();
      void loadNotifications();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadFinance, loadNotifications]);

  async function saveNotificationSettings(settings: NotificationSettings) {
    setWorking(true);
    try {
      const response = await fetch("/api/finance/notifications/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = await readJson<NotificationPayload>(response);
      if (!response.ok) throw new Error(payload.error);
      setNotifications(payload);
      notify("Configuração de cobrança automática salva.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as notificações.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function runNotificationsNow() {
    setWorking(true);
    try {
      const response = await fetch("/api/finance/notifications/settings", {
        method: "POST",
      });
      const payload = await readJson<{
        result: { notificationsSent: number; notificationsFailed: number };
        overview: NotificationOverview;
      }>(response);
      if (!response.ok) throw new Error(payload.error);
      setNotifications((current) => ({
        ...current,
        overview: payload.overview,
      }));
      notify(
        payload.result.notificationsSent > 0
          ? `${payload.result.notificationsSent} aviso(s) enviado(s) pelo WhatsApp.`
          : "Verificação concluída. Nenhum novo aviso para enviar agora.",
      );
      await loadFinance();
      onChanged();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível verificar as notificações.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function resendNotification(id: string) {
    setWorking(true);
    try {
      const response = await fetch(`/api/finance/notifications/${id}/resend`, {
        method: "POST",
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível reenviar.");
      await loadNotifications();
      notify("Reenvio manual registrado no histórico.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível reenviar.");
    } finally {
      setWorking(false);
    }
  }

  const billingByAthlete = useMemo(
    () => new Map(data.billing.map((item) => [item.athleteId, item])),
    [data.billing],
  );

  const athleteCategories = useMemo(
    () => Array.from(new Set(athletes.map((athlete) => athlete.category).filter(Boolean))).sort(),
    [athletes],
  );

  const [billingQuery, setBillingQuery] = useState("");
  const [showArchivedPlans, setShowArchivedPlans] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
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
        body: JSON.stringify({ action, notes, idempotencyKey: crypto.randomUUID() }),
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

  async function updateExpense(
    expense: Expense,
    action: "pay" | "cancel" | "restore" | "reverse",
    paymentMethod?: Expense["paymentMethod"],
    scope?: "single" | "remaining",
  ) {
    setWorking(true);
    try {
      const response = await fetch(`/api/finance/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          paymentMethod,
          scope,
          notes:
            action === "cancel"
              ? "Cancelado pelo usuário"
              : action === "reverse"
                ? "Baixa estornada pelo usuário"
                : undefined,
        }),
      });
      const payload = await readJson<{ updated: boolean }>(response);
      if (!response.ok) throw new Error(payload.error);
      notify(
        action === "pay"
          ? "Pagamento da despesa registrado."
          : action === "cancel"
            ? "Despesa cancelada e mantida no histórico."
            : action === "reverse"
              ? "Baixa estornada. A despesa voltou a ficar pendente."
              : "Despesa reativada.",
      );
      setExpensePayment(null);
      await loadFinance();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível atualizar a despesa.");
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
    const results = await Promise.all(
      overdueToCharge.map(async (charge) => {
        try {
          const response = await fetch(`/api/finance/charges/${charge.id}/send`, { method: "POST" });
          return response.ok;
        } catch {
          return false;
        }
      }),
    );
    const success = results.filter(Boolean).length;
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
    const results = await Promise.all(
      targets.map(async (athlete) => {
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
          return response.ok;
        } catch {
          return false;
        }
      }),
    );
    const success = results.filter(Boolean).length;
    notify(`${success} de ${targets.length} atleta(s) da categoria ${plan.category} vinculado(s) ao plano "${plan.name}".`);
    await loadFinance();
    setWorking(false);
  }

  const configuredCount = data.billing.filter((item) => item.active).length;

  function requestExpenseCancel(expense: Expense, scope: "single" | "remaining" = "single") {
    const cancelAll = scope === "remaining";
    setConfirmDialog({
      title: cancelAll ? "Cancelar parcelas restantes" : "Cancelar gasto",
      message: cancelAll
        ? `Cancelar esta e todas as próximas parcelas de “${expense.description}”? Parcelas pagas serão preservadas.`
        : `Cancelar o gasto “${expense.description}”? O histórico será preservado.`,
      confirmLabel: cancelAll ? "Cancelar restantes" : "Cancelar gasto",
      tone: "danger",
      onConfirm: () => {
        setConfirmDialog(null);
        void updateExpense(expense, "cancel", undefined, scope);
      },
    });
  }

  if (view === "plans") {
    const expected = data.summary.expectedCents;
    const receivedShare = expected > 0 ? data.summary.receivedCents / expected : 0;
    const donutSize = 200;
    const donutStroke = 22;
    const donutRadius = (donutSize - donutStroke) / 2;
    const donutCircumference = 2 * Math.PI * donutRadius;
    const donutGap = 6;
    const donutSegments = [
      { share: expected > 0 ? data.summary.receivedCents / expected : 0, color: "var(--green)" },
      { share: expected > 0 ? data.summary.pendingCents / expected : 0, color: "var(--warning)" },
      { share: expected > 0 ? data.summary.overdueCents / expected : 0, color: "var(--danger)" },
    ];
    let donutCursor = 0;
    const donutArcs = donutSegments.map((segment) => {
      const rawLength = segment.share * donutCircumference;
      const length = Math.max(0, rawLength - donutGap);
      const arc = { ...segment, length, offset: -donutCursor };
      donutCursor += rawLength;
      return arc;
    });

    return (
      <>
        <div className="section-heading finance-heading">
          <div className="finance-heading-title">
            <h1>Planos</h1>
            <p>Planos de mensalidade, faturamento e vínculo de cobrança por atleta.</p>
          </div>
          <div className="finance-heading-actions">
            <button className="primary-button" onClick={() => setPlanModal("new")}><Plus size={16} strokeWidth={2} /> Novo plano</button>
          </div>
        </div>

        <section className="plans-page-grid">
          <div className="card plans-active-card">
            <div className="card-header">
              <div>
                <h2>Planos ativos</h2>
                <p>{data.plans.length} plano(s) · clique para editar</p>
              </div>
              {data.archivedPlans.length > 0 && (
                <button type="button" className="link-button" onClick={() => setShowArchivedPlans((current) => !current)}>
                  {showArchivedPlans ? "Ocultar" : "Ver"} {data.archivedPlans.length} arquivado(s)
                </button>
              )}
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
              <button className="plan-tile new-plan-tile" onClick={() => setPlanModal("new")}><Plus size={16} strokeWidth={2} /> Criar plano</button>
              {data.plans.length === 0 && (
                <div className="finance-empty small"><strong>Nenhum plano cadastrado</strong></div>
              )}
              {showArchivedPlans &&
                data.archivedPlans.map((plan) => (
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
              <div><h2>Faturamento de {monthLabel(month)}</h2><p>Previsto do mês: {money(data.summary.expectedCents)}</p></div>
            </div>
            {data.summary.expectedCents > 0 ? (
              <div className="finance-donut-wrap">
                <div className="finance-donut" style={{ width: donutSize, height: donutSize }}>
                  <svg viewBox={`0 0 ${donutSize} ${donutSize}`} width={donutSize} height={donutSize}>
                    <circle
                      cx={donutSize / 2}
                      cy={donutSize / 2}
                      r={donutRadius}
                      fill="none"
                      style={{ stroke: "var(--surface-3)" }}
                      strokeWidth={donutStroke}
                    />
                    {donutArcs.map(
                      (arc, index) =>
                        arc.length > 0 && (
                          <circle
                            key={index}
                            cx={donutSize / 2}
                            cy={donutSize / 2}
                            r={donutRadius}
                            fill="none"
                            style={{ stroke: arc.color }}
                            strokeWidth={donutStroke}
                            strokeLinecap="round"
                            strokeDasharray={`${arc.length} ${donutCircumference - arc.length}`}
                            strokeDashoffset={arc.offset}
                            transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}
                          />
                        ),
                    )}
                  </svg>
                  <div className="finance-donut-center">
                    <strong>{Math.round(receivedShare * 100)}%</strong>
                    <small>recebido</small>
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
              <span><Search size={14} strokeWidth={1.75} /></span>
              <input
                aria-label="Pesquisar atleta na configuração de cobrança"
                value={billingQuery}
                onChange={(event) => setBillingQuery(event.target.value)}
                placeholder="Pesquisar atleta..."
              />
              {billingQuery && (
                <button type="button" className="search-clear" aria-label="Limpar busca" onClick={() => setBillingQuery("")}><X size={14} strokeWidth={1.75} /></button>
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
            archivedPlans={data.archivedPlans}
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

  if (view === "expenses") {
    return (
      <>
        <div className="section-heading finance-heading expenses-heading">
          <div className="finance-heading-title">
            <h1>Controle de gastos</h1>
            <p>Organize contas a pagar, parcelas, baixas e o resultado real da escolinha.</p>
          </div>
          <div className="finance-heading-actions">
            <label>
              <span>Mês de referência</span>
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
<button className="secondary-button" type="button" onClick={() => void seedDemoFinance()}>
  Carregar cenário de teste
</button>
<button className="primary-button" type="button" onClick={() => setNewExpenseOpen(true)}>
              + Lançar gasto
            </button>
          </div>
        </div>
        <section className="expense-page-metrics">
          <FinanceMetric icon={Wallet} label="TOTAL DO MÊS" value={money(data.summary.expenseTotalCents)} detail="despesas não canceladas" tone="blue" />
          <FinanceMetric icon={CheckCircle2} label="PAGO" value={money(data.summary.expensePaidCents)} detail={`${data.summary.expensePaidCount} baixa(s)`} tone="green" />
          <FinanceMetric icon={Clock} label="PENDENTE" value={money(data.summary.expensePendingCents)} detail={`${data.summary.expensePendingCount} conta(s)`} tone="orange" />
          <FinanceMetric icon={AlertTriangle} label="VENCIDO" value={money(data.summary.expenseOverdueCents)} detail="exige atenção" tone="red" />
        </section>
        <ExpenseWorkspace
          expenses={data.expenses}
          month={month}
          loading={loading}
          onNew={() => setNewExpenseOpen(true)}
          onPay={setExpensePayment}
          requestCancel={requestExpenseCancel}
          onRestore={(expense) => void updateExpense(expense, "restore")}
          onReverse={(expense) => void updateExpense(expense, "reverse")}
        />
        {newExpenseOpen && (
          <ExpenseModal
            month={month}
            notify={notify}
            onClose={() => setNewExpenseOpen(false)}
            onSaved={async () => {
              setNewExpenseOpen(false);
              notify("Despesa lançada com sucesso.");
              await loadFinance();
            }}
          />
        )}
        {expensePayment && (
          <ExpensePaymentModal
            expense={expensePayment}
            working={working}
            onClose={() => setExpensePayment(null)}
            onConfirm={(paymentMethod) => void updateExpense(expensePayment, "pay", paymentMethod)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="section-heading finance-heading">
        <div className="finance-heading-title">
          <div className="finance-title-line">
            <h1>Mensalidades</h1>
            <span className={data.paymentIntegration?.configured ? "integration-badge ready" : "integration-badge"}>
              {data.paymentIntegration?.configured ? "Asaas Sandbox conectado" : "Asaas Sandbox aguardando chave"}
            </span>
          </div>
          <p>Controle cobranças, recebimentos, vencimentos e inadimplência em um só painel.</p>
        </div>
        <div className="finance-heading-actions">
          <button
            type="button"
            className={`filter-button billing-connection-button ${notifications.overview.whatsapp.connected ? "online" : "offline"}`}
            onClick={() => setConnectionModalOpen(true)}
          >
            <span className="billing-whatsapp-dot" aria-hidden="true" />
            Conexão
          </button>
          <label>
            <span>Mês de referência</span>
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

      <section className="finance-metrics real-finance-metrics">
        <FinanceMetric
          icon={Wallet}
          label="FATURADO"
          value={money(data.summary.billedCents)}
          detail={`competência ${monthLabel(month)}`}
          tone="green"
          active={chargeStatusFilter === "all"}
          onClick={() => setChargeStatusFilter("all")}
        />
        <FinanceMetric
          icon={CheckCircle2}
          label="RECEBIDO"
          value={money(data.summary.receivedCents)}
          detail={`${data.summary.paidCount} baixa(s)`}
          tone="blue"
          active={chargeStatusFilter === "received"}
          onClick={() => setChargeStatusFilter("received")}
        />
        <FinanceMetric
          icon={Clock}
          label="A RECEBER"
          value={money(data.summary.pendingCents)}
          detail="dentro do vencimento"
          tone="orange"
          active={chargeStatusFilter === "open"}
          onClick={() => setChargeStatusFilter("open")}
        />
        <FinanceMetric
          icon={AlertTriangle}
          label="EM ATRASO"
          value={money(data.summary.overdueCents)}
          detail={`${data.summary.overdueCount} vencida(s)`}
          tone="red"
          active={chargeStatusFilter === "overdue"}
          onClick={() => setChargeStatusFilter("overdue")}
        />
        <FinanceMetric
          icon={Minus}
          label="GASTOS PAGOS"
          value={money(data.summary.expensePaidCents)}
          detail={`${data.summary.expensePaidCount} baixa(s)`}
          tone="red"
        />
        <FinanceMetric
          icon={Equal}
          label="RESULTADO REALIZADO"
          value={money(data.summary.netCents)}
          detail="recebido menos gastos pagos"
          tone={data.summary.netCents >= 0 ? "green" : "red"}
          featured
        />
      </section>

      <section className="finance-portfolio" aria-label="Resumo completo das mensalidades">
        <div className="finance-portfolio-head">
          <div>
            <h2>Carteira de mensalidades</h2>
            <p>Inclui todos os meses em aberto, não apenas a competência selecionada.</p>
          </div>
          <div className="finance-portfolio-rate">
            <strong>{data.summary.collectionRate}%</strong>
            <small>recebido no mês</small>
          </div>
        </div>
        <div className="billing-portfolio-grid">
          <button type="button" onClick={() => setChargeStatusFilter("open")}>
            <span className="portfolio-dot open" />
            <small>EM ABERTO</small>
            <b>{data.summary.openCount}</b>
            <em>{money(data.summary.openCents)}</em>
          </button>
          <button type="button" onClick={() => setChargeStatusFilter("overdue")}>
            <span className="portfolio-dot overdue" />
            <small>VENCIDAS</small>
            <b>{data.summary.totalOverdueCount}</b>
            <em>{money(data.summary.totalOverdueCents)}</em>
          </button>
          <div>
            <span className="portfolio-dot today" />
            <small>VENCE HOJE</small>
            <b>{data.summary.dueTodayCount}</b>
            <em>{money(data.summary.dueTodayCents)}</em>
          </div>
          <div>
            <span className="portfolio-dot soon" />
            <small>PRÓXIMOS 7 DIAS</small>
            <b>{data.summary.dueSoonCount}</b>
            <em>{money(data.summary.dueSoonCents)}</em>
          </div>
        </div>
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
      </section>

      {connectionModalOpen && (
        <BillingNotificationPanel
          key="billing-notification-panel"
          data={notifications}
          working={working}
          onSave={saveNotificationSettings}
          onRun={runNotificationsNow}
          onResend={resendNotification}
          onClose={() => setConnectionModalOpen(false)}
        />
      )}

      <div className="card finance-charges">
        <div className="card-header">
          <div>
            <h2>Painel de mensalidades · {monthLabel(month)}</h2>
            <p>{data.charges.length} cobranças · baixas, vencimentos e atualização automática</p>
          </div>
          <span className={loading ? "finance-loading" : "finance-ready"}>
            {loading ? "Carregando..." : "Atualizado"}
          </span>
        </div>
        <div className="athlete-list-toolbar finance-charges-toolbar">
          <div className="athlete-search-wrap">
            <label className="athlete-list-search">
              <span><Search size={14} strokeWidth={1.75} /></span>
              <input
                aria-label="Pesquisar cobrança por atleta"
                value={chargeQuery}
                onChange={(event) => setChargeQuery(event.target.value)}
                placeholder="Pesquisar atleta..."
              />
              {chargeQuery && (
                <button type="button" className="search-clear" aria-label="Limpar busca" onClick={() => setChargeQuery("")}><X size={14} strokeWidth={1.75} /></button>
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
            <div className="finance-empty finance-empty-onboarding">
              <span>$</span><strong>Nenhuma mensalidade neste mês</strong>
              <small>Configure um plano, vincule os atletas e gere as cobranças do mês selecionado.</small>
              <div className="finance-empty-actions">
                <button type="button" className="filter-button" onClick={onOpenPlans}>Configurar planos</button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={working || data.plans.length === 0 || configuredCount === 0}
                  onClick={() => void generateCharges()}
                >
                  Gerar mensalidades
                </button>
              </div>
            </div>
          )}
          {!loading && data.charges.length > 0 && filteredCharges.length === 0 && (
            <div className="finance-empty">
              <span><Search size={14} strokeWidth={1.75} /></span><strong>Nenhuma cobrança encontrada</strong>
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

      {newExpenseOpen && (
        <ExpenseModal
          month={month}
          notify={notify}
          onClose={() => setNewExpenseOpen(false)}
          onSaved={async () => {
            setNewExpenseOpen(false);
            notify("Despesa lançada com sucesso.");
            await loadFinance();
          }}
        />
      )}

      {expensePayment && (
        <ExpensePaymentModal
          expense={expensePayment}
          working={working}
          onClose={() => setExpensePayment(null)}
          onConfirm={(paymentMethod) => void updateExpense(expensePayment, "pay", paymentMethod)}
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

function ExpenseWorkspace({
  expenses,
  month,
  loading,
  onNew,
  onPay,
  requestCancel,
  onRestore,
  onReverse,
}: {
  expenses: Expense[];
  month: string;
  loading: boolean;
  onNew: () => void;
  onPay: (expense: Expense) => void;
  requestCancel: (expense: Expense, scope?: "single" | "remaining") => void;
  onRestore: (expense: Expense) => void;
  onReverse: (expense: Expense) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Expense["status"]>("all");
  const [category, setCategory] = useState("all");
  const categories = Array.from(new Set(expenses.map((expense) => expense.category))).sort();
  const filtered = expenses.filter((expense) => {
    const matchesQuery = `${expense.description} ${expense.supplier ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    return matchesQuery && (status === "all" || expense.status === status) &&
      (category === "all" || expense.category === category);
  });

  return (
    <section className="card expense-workspace">
      <div className="card-header expense-workspace-header">
        <div>
          <h2>Contas a pagar · {monthLabel(month)}</h2>
          <p>{filtered.length} lançamento(s) exibido(s) · filtre por situação, categoria ou fornecedor</p>
        </div>
        <button className="primary-button" type="button" onClick={onNew}>+ Nova despesa</button>
      </div>
      <div className="expense-filters">
        <label className="expense-filter-search">
          <span><Search size={14} strokeWidth={1.75} /></span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição ou fornecedor..." aria-label="Buscar despesa" />
        </label>
        <label>
          Situação
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">Todas</option>
            <option value="open">Em aberto</option>
            <option value="overdue">Vencidas</option>
            <option value="paid">Pagas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </label>
        <label>
          Categoria
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Todas</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button className="filter-button" type="button" onClick={() => { setQuery(""); setStatus("all"); setCategory("all"); }}>Limpar filtros</button>
      </div>
      <div className="expense-table expense-workspace-table">
        <div className="expense-row expense-head"><span>DESCRIÇÃO</span><span>VENCIMENTO</span><span>VALOR</span><span>SITUAÇÃO</span><span>AÇÕES</span></div>
        {filtered.map((expense) => (
          <div className="expense-row" key={expense.id}>
            <span><strong>{expense.description}</strong><small>{expense.category}{expense.supplier ? ` · ${expense.supplier}` : ""}{expense.installmentCount > 1 ? ` · Parcela ${expense.installmentNumber}/${expense.installmentCount}` : ""}</small></span>
            <span><strong>{new Date(`${expense.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</strong><small>{expense.paymentMethod ? methodLabels[expense.paymentMethod] : "A pagar"}</small></span>
            <span><strong>{money(expense.amountCents)}</strong></span>
            <span><b className={`charge-status ${expense.status}`}>{expense.status === "paid" ? "Pago" : expense.status === "overdue" ? "Vencido" : expense.status === "cancelled" ? "Cancelado" : "Em aberto"}</b></span>
            <span className="expense-actions">
              {(expense.status === "open" || expense.status === "overdue") && <>
                <button type="button" onClick={() => onPay(expense)}>Dar baixa</button>
                <button type="button" className="danger-link" onClick={() => requestCancel(expense)}>Cancelar</button>
                {expense.installmentCount > 1 && expense.installmentNumber < expense.installmentCount && <button type="button" className="danger-link" onClick={() => requestCancel(expense, "remaining")}>Cancelar próximas</button>}
              </>}
              {expense.status === "paid" && <button type="button" className="danger-link" onClick={() => onReverse(expense)}>Estornar</button>}
              {expense.status === "cancelled" && <button type="button" onClick={() => onRestore(expense)}>Reativar</button>}
            </span>
          </div>
        ))}
        {!loading && filtered.length === 0 && <div className="finance-empty small"><strong>Nenhum lançamento encontrado</strong><small>Ajuste os filtros ou registre uma nova despesa.</small></div>}
      </div>
    </section>
  );
}

function useModalFocus({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    previousFocus.current = document.activeElement as HTMLElement | null;

    const reachable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(.modal-close), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    // Foco inicial: primeiro controle real do diálogo (o botão de fechar fica de fora).
    // Sem nenhum controle (ex.: diálogo vazio), cai no próprio botão de fechar.
    const firstControl = reachable()[0] ?? root.querySelector<HTMLElement>(".modal-close");
    firstControl?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = reachable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    root.addEventListener("keydown", handleKeyDown);
    return () => {
      root.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus?.();
    };
  }, []);

  return rootRef;
}

function Modal({
  onClose,
  role = "dialog",
  labelledBy,
  className = "modal",
  children,
}: {
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useModalFocus({ onClose });
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={rootRef}
        className={className}
        role={role}
        aria-modal="true"
        {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalClose({ onClick }: { onClick: () => void }) {
  return (
    <button className="modal-close" type="button" onClick={onClick} aria-label="Fechar">
      <X size={18} strokeWidth={1.75} />
    </button>
  );
}

function ExpenseModal({
  month,
  notify,
  onClose,
  onSaved,
}: {
  month: string;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [paid, setPaid] = useState(false);
  const [installment, setInstallment] = useState(false);
  const [installmentCount, setInstallmentCount] = useState(2);
  const [amount, setAmount] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const defaultDueDate = today.startsWith(month) ? today : `${month}-10`;
  const totalCents = Math.round((Number(amount) || 0) * 100);
  const averageInstallmentCents =
    installmentCount > 0 ? Math.floor(totalCents / installmentCount) : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch("/api/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceMonth: month,
          description: form.get("description"),
          category: form.get("category"),
          supplier: form.get("supplier"),
          amount: form.get("amount"),
          dueDate: form.get("dueDate"),
          paid,
          paymentMethod: paid ? form.get("paymentMethod") : null,
          notes: form.get("notes"),
          installments: installment ? installmentCount : 1,
        }),
      });
      const payload = await readJson<{ expense: Expense; expenses: Expense[] }>(response);
      if (!response.ok) throw new Error(payload.error);
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível lançar a despesa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} role="dialog" className="modal expense-modal" labelledBy="expense-modal-title">
      <ModalClose onClick={onClose} />
      <span className="eyebrow">CONTROLE DE GASTOS</span>
      <h2 id="expense-modal-title">Nova despesa</h2>
        <p>O lançamento entra na competência de {monthLabel(month)} e compõe o resultado financeiro.</p>
        <form className="expense-form" onSubmit={submit}>
          <label>
            Descrição
            <input name="description" required minLength={2} maxLength={140} placeholder="Ex.: aluguel do campo" autoFocus />
          </label>
          <div className="form-row">
            <label>
              Categoria
              <select name="category" defaultValue="Materiais">
                <option>Pessoal</option>
                <option>Aluguel</option>
                <option>Materiais</option>
                <option>Manutenção</option>
                <option>Transporte</option>
                <option>Marketing</option>
                <option>Impostos e taxas</option>
                <option>Água, luz e internet</option>
                <option>Outros</option>
              </select>
            </label>
            <label>
              Fornecedor
              <input name="supplier" maxLength={120} placeholder="Opcional" />
            </label>
          </div>
          <div className="form-row">
            <label>
              {installment ? "Valor total (R$)" : "Valor (R$)"}
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              {installment ? "Primeiro vencimento" : "Vencimento"}
              <input name="dueDate" type="date" required defaultValue={defaultDueDate} />
            </label>
          </div>
          <label className="expense-paid-toggle expense-installment-toggle">
            <input
              type="checkbox"
              checked={installment}
              onChange={(event) => {
                setInstallment(event.target.checked);
                if (event.target.checked) setPaid(false);
              }}
            />
            <span>
              Esta compra foi parcelada
              <small>Cria uma conta a pagar para cada mês</small>
            </span>
          </label>
          {installment && (
            <div className="expense-installment-panel">
              <label>
                Quantidade de parcelas
                <input
                  type="number"
                  min="2"
                  max="60"
                  value={installmentCount}
                  onChange={(event) =>
                    setInstallmentCount(
                      Math.min(60, Math.max(2, Number(event.target.value) || 2)),
                    )
                  }
                />
              </label>
              <div>
                <small>PREVISÃO</small>
                <strong>
                  {installmentCount}× de aproximadamente {money(averageInstallmentCents)}
                </strong>
                <span>Os centavos são ajustados automaticamente entre as parcelas.</span>
              </div>
            </div>
          )}
          {!installment && (
            <label className="expense-paid-toggle">
              <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
              <span>Esta despesa já foi paga</span>
            </label>
          )}
          {paid && (
            <label>
              Forma de pagamento
              <select name="paymentMethod" defaultValue="pix">
                <option value="pix">PIX</option>
                <option value="cash">Dinheiro</option>
                <option value="card">Cartão</option>
                <option value="bank">Transferência</option>
                <option value="other">Outro</option>
              </select>
            </label>
          )}
          <label className="expense-notes-field">
            <span>
              Observação
              <small>Opcional</small>
            </span>
            <textarea
              name="notes"
              rows={3}
              maxLength={500}
              placeholder="Ex.: número do documento, centro de custo ou detalhes do pagamento"
            />
          </label>
          <div className="expense-modal-actions">
            <button className="filter-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="primary-button" disabled={saving}>
              {saving ? "Salvando..." : "Lançar despesa"}
            </button>
          </div>
        </form>
    </Modal>
  );
}

function ExpensePaymentModal({
  expense,
  working,
  onClose,
  onConfirm,
}: {
  expense: Expense;
  working: boolean;
  onClose: () => void;
  onConfirm: (method: Expense["paymentMethod"]) => void;
}) {
  const [method, setMethod] = useState<Expense["paymentMethod"]>("pix");
  return (
    <Modal onClose={onClose} role="dialog" labelledBy="expense-payment-modal-title">
      <ModalClose onClick={onClose} />
      <span className="eyebrow">BAIXA DE DESPESA</span>
      <h2 id="expense-payment-modal-title">{expense.description}</h2>
        <p>Confirme o pagamento de <strong>{money(expense.amountCents)}</strong>.</p>
        <label>
          Forma de pagamento
          <select value={method ?? "pix"} onChange={(event) => setMethod(event.target.value as Expense["paymentMethod"])}>
            <option value="pix">PIX</option>
            <option value="cash">Dinheiro</option>
            <option value="card">Cartão</option>
            <option value="bank">Transferência</option>
            <option value="other">Outro</option>
          </select>
        </label>
        <button className="primary-button full" type="button" disabled={working} onClick={() => onConfirm(method)}>
          {working ? "Registrando..." : "Confirmar pagamento"}
        </button>
    </Modal>
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
    <Modal onClose={onCancel} role="alertdialog" className="modal confirm-modal" labelledBy="confirm-modal-title">
      <ModalClose onClick={onCancel} />
      <h2 id="confirm-modal-title">{title}</h2>
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
    </Modal>
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
    <Modal onClose={onClose} role="dialog" className="charge-action-modal" labelledBy="charge-action-title">
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
        <ModalClose onClick={onClose} />
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
    </Modal>
  );
}

// Mascara o número conectado, mantendo só os últimos 4 dígitos visíveis
// (ex.: "+55 11 99999-8787" -> "*********8787"). Puramente de exibição —
// não altera o valor armazenado/enviado em nenhum lugar.
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

const whatsappStatusLabels: Record<string, string> = {
  connected: "Conectado",
  disconnected: "Desconectado",
  starting: "Conectando",
  authenticated: "Conectando",
  qr: "QR necessário",
  error: "Erro",
  unavailable: "Indisponível",
};

function BillingNotificationPanel({
  data,
  working,
  onSave,
  onRun,
  onResend,
  onClose,
}: {
  data: NotificationPayload;
  working: boolean;
  onSave: (settings: NotificationSettings) => Promise<void>;
  onRun: () => Promise<void>;
  onResend: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(data.settings);

  const eventLabels = {
    before_due: "Antes do vencimento",
    due_today: "Vence hoje",
    overdue: "Em aberto",
    enrollment: "Confirmação de inscrição",
  };
  const statusLabels = {
    pending: "Pendente",
    processing: "Processando",
    sent: "Enviada",
    failed: "Falhou",
    delivery_unknown: "Entrega incerta",
  };

  return (
    <Modal onClose={onClose} role="dialog" className="modal billing-notification-modal" labelledBy="billing-notification-title">
      <ModalClose onClick={onClose} />
      <span className="eyebrow">CONEXÃO</span>
      <h2 id="billing-notification-title">Conexão e notificações</h2>
      <div className="billing-notification-card">
      <span className="billing-notification-icon" aria-hidden="true">
        <MessageCircle size={20} strokeWidth={1.75} />
      </span>
      <span className="billing-notification-text">
        <span className="billing-notification-desc">
          Lembretes de mensalidade pelo WhatsApp — o sistema gera o mês, acompanha
          vencimentos e envia cada aviso uma única vez.
        </span>
      </span>
      <span className={`billing-whatsapp-state ${data.overview.whatsapp.connected ? "online" : "offline"}`}>
        <span className="billing-whatsapp-dot" />
        <strong>{whatsappStatusLabels[data.overview.whatsapp.status] ?? (data.overview.whatsapp.connected ? "Conectado" : "Desconectado")}</strong>
        <small>
          {data.overview.whatsapp.connectedPhone
            ? maskPhone(data.overview.whatsapp.connectedPhone)
            : "Conecte em Cartões QR → WhatsApp"}
        </small>
      </span>
      </div>

      {<div id="billing-notification-panel" role="region" aria-labelledby="billing-notification-title" className="billing-notification-body">
      <div className="billing-automation-switch">
        <label>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
          <span>
            <strong>Automação de mensalidades ativa</strong>
            <small>
              Verificação ao abrir o sistema e periodicamente enquanto estiver
              em uso.
            </small>
          </span>
        </label>
      </div>

      <div className={draft.enabled ? "billing-reminder-flow" : "billing-reminder-flow disabled"}>
        <label>
          <span className="flow-head">
            <span className="flow-number">1</span>
            <input
              type="checkbox"
              checked={draft.beforeDueEnabled}
              disabled={!draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  beforeDueEnabled: event.target.checked,
                }))
              }
            />
            <span className="flow-copy">
              <strong>Mensalidade prestes a vencer</strong>
              <small>Enviar quando faltar até</small>
            </span>
          </span>
          <span className="flow-value">
            <input
              className="flow-days"
              type="number"
              min="1"
              max="30"
              value={draft.beforeDueDays}
              disabled={!draft.enabled || !draft.beforeDueEnabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  beforeDueDays: Number(event.target.value),
                }))
              }
            />
            <b>dias</b>
          </span>
        </label>
        <label>
          <span className="flow-head">
            <span className="flow-number">2</span>
            <input
              type="checkbox"
              checked={draft.dueTodayEnabled}
              disabled={!draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  dueTodayEnabled: event.target.checked,
                }))
              }
            />
            <span className="flow-copy">
              <strong>Vencimento hoje</strong>
              <small>Aviso no próprio dia do vencimento</small>
            </span>
          </span>
          <span className="flow-value">
            <b>No vencimento</b>
          </span>
        </label>
        <label>
          <span className="flow-head">
            <span className="flow-number">3</span>
            <input
              type="checkbox"
              checked={draft.overdueEnabled}
              disabled={!draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  overdueEnabled: event.target.checked,
                }))
              }
            />
            <span className="flow-copy">
              <strong>Mensalidade consta em aberto</strong>
              <small>Enviar depois de</small>
            </span>
          </span>
          <span className="flow-value">
            <input
              className="flow-days"
              type="number"
              min="1"
              max="90"
              value={draft.overdueDays}
              disabled={!draft.enabled || !draft.overdueEnabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  overdueDays: Number(event.target.value),
                }))
              }
            />
            <b>dias</b>
          </span>
        </label>
      </div>

      <div className="billing-notification-foot">
        <div className="billing-notification-stats">
          <span>
            <strong>{data.overview.sentLast30Days}</strong>
            <small>enviados em 30 dias</small>
          </span>
          <span className={data.overview.failedLast30Days ? "has-failures" : ""}>
            <strong>{data.overview.failedLast30Days}</strong>
            <small>falhas aguardando nova tentativa</small>
          </span>
        </div>
        <div className="billing-notification-actions">
          <button
            className="filter-button"
            type="button"
            disabled={working || !draft.enabled}
            onClick={() => void onRun()}
          >
            Verificar agora
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={working}
            onClick={() => void onSave(draft)}
          >
            Salvar configuração
          </button>
        </div>
      </div>

      {data.overview.recent.length > 0 && (
        <div className="billing-notification-recent">
          <strong className="billing-notification-recent-title">Últimos avisos</strong>
          <div className="billing-notification-recent-grid">
            {data.overview.recent.map((item) => (
              <span key={item.id} className={`billing-notification-recent-item ${item.status}`}>
                <span className="recent-item-head">
                  <i className={item.status} />
                  <b title={item.athleteName}>{item.athleteName}</b>
                </span>
                <small>{eventLabels[item.type]}</small>
                <small>{item.phone} · {item.attemptCount} tentativa(s)</small>
                <em title={item.lastError || undefined}>
                  {statusLabels[item.status]}
                  {item.origin ? ` · ${item.origin}` : ""}
                  {item.manualResendCount ? ` · ${item.manualResendCount} reenvio(s)` : ""}
                </em>
                <button
                  type="button"
                  className="filter-button"
                  disabled={working || item.status === "processing"}
                  onClick={() => void onResend(item.id)}
                >
                  Reenviar
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      </div>}
    </Modal>
  );
}

function FinanceMetric({
  icon,
  label,
  value,
  detail,
  tone,
  active,
  featured,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: string;
  active?: boolean;
  featured?: boolean;
  onClick?: () => void;
}) {
  const Icon = icon;
  const content = (
    <>
      <div className={`metric-icon ${tone}`}><Icon size={18} strokeWidth={1.75} /></div>
      <div className="metric-card-body">
        <span className="metric-card-label">{label}</span>
        <strong className="metric-card-value">{value}</strong>
        <small className="metric-card-detail">{detail}</small>
      </div>
    </>
  );
  if (!onClick) {
    return <div className={featured ? "metric-card metric-card-featured" : "metric-card"}>{content}</div>;
  }
  return (
    <button
      type="button"
      className={`metric-card metric-card-button${active ? " active" : ""}`}
      aria-pressed={active ?? undefined}
      onClick={onClick}
    >
      {content}
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
          amount: form.get("amount"),
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
    <Modal onClose={onClose} role="dialog" labelledBy="plan-modal-title">
      <ModalClose onClick={onClose} />
      <span className="eyebrow">PLANO DE MENSALIDADE</span>
      <h2 id="plan-modal-title">{plan ? "Editar plano" : "Novo plano"}</h2>
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
    </Modal>
  );
}

function BillingModal({
  athlete,
  plans,
  archivedPlans,
  current,
  notify,
  onClose,
  onSaved,
}: {
  athlete: AthleteRecord;
  plans: Plan[];
  archivedPlans: Plan[];
  current?: Billing;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  // Mesma regra de compatibilidade de categoria usada no bloco Financeiro do
  // cadastro/edição do atleta (app/athlete-financial-plan.ts) — reaproveitada
  // aqui em vez de duplicada, para as duas telas nunca divergirem.
  const compatiblePlans = plans.filter((plan) => planCategoryCompatible(plan.category, athlete.category));
  const currentPlan = current
    ? plans.find((plan) => plan.id === current.planId) ?? archivedPlans.find((plan) => plan.id === current.planId)
    : undefined;
  const currentPlanCategory = currentPlan?.category ?? null;
  const currentIncompatible = Boolean(current) && !planCategoryCompatible(currentPlanCategory, athlete.category);

  // Mesma regra de sugestão do bloco Financeiro do atleta: só pré-seleciona
  // quando existe exatamente um plano ativo compatível — com 2+, o operador
  // precisa escolher explicitamente (nunca decidimos por ele).
  const suggestion = suggestPlanForCategory(
    compatiblePlans.map((plan) => ({ ...plan, active: true })),
    athlete.category,
  );
  const defaultPlanId = !currentIncompatible && current ? current.planId : suggestion.plan?.id;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const discountType = String(form.get("discountType"));
      const rawDiscount = form.get("discountValue") || "0";
      const response = await fetch(`/api/finance/athletes/${athlete.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: form.get("planId"),
          discountType,
          discountValue: discountType === "fixed" ? rawDiscount : Number(rawDiscount),
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
    <Modal onClose={onClose} role="dialog" labelledBy="billing-modal-title">
      <ModalClose onClick={onClose} />
      <span className="eyebrow">COBRANÇA DO ATLETA</span>
      <h2 id="billing-modal-title">{athlete.name}</h2>
        <p>Personalize plano, desconto ou vencimento. Cobranças já geradas não mudam.</p>
        {currentIncompatible && (
          <p className="form-warning">
            O plano financeiro atual pertence à categoria {currentPlanCategory}. Revise a configuração deste atleta.
          </p>
        )}
        {compatiblePlans.length === 0 ? (
          <div className="finance-empty small">
            <strong>Nenhum plano ativo compatível com a categoria {athlete.category}. Crie um plano para essa categoria (ou um plano geral) antes de continuar.</strong>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Plano
              <select name="planId" required defaultValue={defaultPlanId ?? ""}>
                {!defaultPlanId && <option value="">Selecionar plano</option>}
                {compatiblePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}{plan.category ? ` · ${plan.category}` : ""} · {money(plan.amountCents)}
                  </option>
                ))}
              </select>
            </label>
            {!current && compatiblePlans.some((plan) => plan.category === athlete.category) && (
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
    </Modal>
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
  const [idempotencyKey] = useState(() => crypto.randomUUID());
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
          paidAmount: form.get("paidAmount"),
          notes: form.get("notes"),
          idempotencyKey,
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
    <Modal onClose={onClose} role="dialog" labelledBy="payment-modal-title">
      <ModalClose onClick={onClose} />
      <span className="eyebrow">BAIXA DE PAGAMENTO</span>
      <h2 id="payment-modal-title">{charge.athleteName}</h2>
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
    </Modal>
  );
}
