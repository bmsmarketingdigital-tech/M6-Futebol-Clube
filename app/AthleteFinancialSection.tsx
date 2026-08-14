"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatCentsToBRL,
  formatReferenceMonth,
  getActivePlans,
  getCategoryCompatiblePlans,
  paymentStatusLabel,
  planCategoryMismatch,
  resolveFinancialStatus,
  suggestPlanForCategory,
  type BillingPlanOption,
} from "./athlete-financial-plan";

type CurrentBilling = {
  id: string;
  planId: string;
  planName: string;
  amountCents: number;
  dueDay: number;
  planCategory: string | null;
  planActive: boolean;
  discountType: "none" | "fixed" | "percent";
  discountValue: number;
  customDueDay: number | null;
  active: boolean;
};

// Mensalidade (payment) da competência atual, quando já gerada — vem do
// mesmo GET, mas de uma fonte diferente (payments, não athlete_billing).
type CurrentPayment = {
  id: string;
  referenceMonth: string;
  amountCents: number;
  dueDate: string;
  status: "open" | "paid" | "partial" | "overdue" | "cancelled";
  paidAt: number | null;
  paidAmountCents: number | null;
};

// Bloco "Configuração financeira" do cadastro/edição do atleta. Só
// mostra/edita o vínculo com um plano (athlete_billing) — nunca cria
// payment nem toca lançamentos financeiros, combos, ou integrações
// externas de cobrança ou mensageria. Salvar aqui reaproveita a mesma rota já usada pela tela
// de Mensalidades (PATCH /api/finance/athletes/[athleteId]).
export function AthleteFinancialSection({
  athleteId,
  athleteCategory,
  notify,
}: {
  athleteId: string;
  athleteCategory: string;
  notify: (message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<BillingPlanOption[]>([]);
  const [billing, setBilling] = useState<CurrentBilling | null>(null);
  const [payment, setPayment] = useState<CurrentPayment | null>(null);
  const [comboCovered, setComboCovered] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [plansResponse, billingResponse] = await Promise.all([
          fetch("/api/finance/plans"),
          fetch(`/api/finance/athletes/${athleteId}`),
        ]);
        const plansPayload = (await plansResponse.json()) as { plans?: BillingPlanOption[] };
        const billingPayload = (await billingResponse.json()) as {
          billing?: CurrentBilling | null;
          payment?: CurrentPayment | null;
          comboCovered?: boolean;
        };
        if (cancelled) return;
        const activePlans = getActivePlans(plansPayload.plans ?? []);
        setPlans(activePlans);
        setBilling(billingPayload.billing ?? null);
        setPayment(billingPayload.payment ?? null);
        setComboCovered(Boolean(billingPayload.comboCovered));
        if (billingPayload.billing) {
          setSelectedPlanId(billingPayload.billing.planId);
        } else {
          // Sem plano ainda: sugere só quando há exatamente um plano ativo
          // compatível com a categoria do atleta. Nunca pré-seleciona
          // quando há mais de um — o operador precisa escolher.
          const { plan, ambiguous } = suggestPlanForCategory(activePlans, athleteCategory);
          setSelectedPlanId(!ambiguous && plan ? plan.id : "");
        }
      } catch {
        if (!cancelled) notify("Não foi possível carregar a configuração financeira.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, athleteCategory, notify]);

  const mismatch = billing
    ? planCategoryMismatch(billing.planCategory, athleteCategory)
    : false;

  // Só mostramos planos ativos compatíveis com a categoria atual do atleta
  // (mesma categoria ou plano geral/sem categoria) — Sub-9, Sub-15 etc. não
  // aparecem para um atleta Sub-13. Se o plano já vinculado ficou
  // incompatível (categoria do atleta mudou), ele continua listado para não
  // sumir do seletor sem explicação — o aviso de revisão cuida do resto.
  const compatiblePlans = useMemo(
    () => getCategoryCompatiblePlans(plans, athleteCategory),
    [plans, athleteCategory],
  );
  const selectablePlans = useMemo(() => {
    if (billing && !compatiblePlans.some((plan) => plan.id === billing.planId)) {
      return [
        {
          id: billing.planId,
          name: billing.planName,
          amountCents: billing.amountCents,
          dueDay: billing.dueDay,
          category: billing.planCategory,
          active: billing.planActive,
        },
        ...compatiblePlans,
      ];
    }
    return compatiblePlans;
  }, [billing, compatiblePlans]);

  async function savePlan() {
    if (!selectedPlanId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/finance/athletes/${athleteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlanId,
          discountType: billing?.discountType ?? "none",
          discountValue: billing?.discountValue ?? 0,
          customDueDay: billing?.customDueDay ?? null,
          active: true,
        }),
      });
      const payload = (await response.json()) as { billing?: CurrentBilling; error?: string };
      if (!response.ok || !payload.billing) {
        throw new Error(payload.error || "Não foi possível salvar o plano.");
      }
      const plan = plans.find((item) => item.id === payload.billing!.planId);
      setBilling({
        ...payload.billing,
        planName: plan?.name ?? payload.billing.planName,
        amountCents: plan?.amountCents ?? payload.billing.amountCents,
        dueDay: plan?.dueDay ?? payload.billing.dueDay,
        planCategory: plan?.category ?? payload.billing.planCategory,
        planActive: plan?.active ?? payload.billing.planActive,
      });
      notify(
        "Plano configurado. A mensalidade ainda precisa ser gerada em Financeiro → Mensalidades.",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar o plano.");
    } finally {
      setSaving(false);
    }
  }

  // Status combinado (configurado/sem configuração + ativo/inativo) num
  // único badge — evita uma linha própria só para isso.
  // Estado real do bloco: plano vinculado (athlete_billing) e mensalidade
  // gerada (payment) são coisas diferentes — "tem plano" não significa "já
  // foi cobrado". Combo tem prioridade: se a competência está coberta por
  // Combo, a ausência de mensalidade mensal é esperada, não uma pendência.
  const financialStatus = resolveFinancialStatus({
    hasBilling: Boolean(billing),
    hasPayment: Boolean(payment),
    comboCovered,
  });
  const inactiveSuffix = billing && !billing.active ? " (inativo)" : "";
  const statusLabel =
    financialStatus === "unconfigured"
      ? "Sem configuração financeira"
      : financialStatus === "configured_pending"
        ? `Plano configurado${inactiveSuffix} — mensalidade ainda não gerada`
        : financialStatus === "billed"
          ? `Mensalidade gerada${inactiveSuffix}`
          : "Competência coberta por Combo";
  const statusClass = {
    unconfigured: "unconfigured",
    configured_pending: "pending",
    billed: "billed",
    combo_covered: "combo",
  }[financialStatus];

  return (
    <section className="athlete-financial-section wide" aria-labelledby="athlete-financial-title">
      <div className="athlete-financial-header">
        <h3 id="athlete-financial-title">Financeiro</h3>
        <span className={`athlete-financial-status ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {loading ? (
        <p className="athlete-financial-loading">Carregando configuração financeira...</p>
      ) : (
        <>
          <div className="athlete-financial-row">
            <label className="athlete-financial-plan-field">
              Plano
              <select
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
              >
                <option value="">Selecionar plano</option>
                {selectablePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {formatCentsToBRL(plan.amountCents)} · vence dia {plan.dueDay}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="filter-button athlete-financial-save"
              disabled={saving || !selectedPlanId || selectedPlanId === billing?.planId}
              onClick={() => void savePlan()}
            >
              {saving ? "Salvando..." : "Salvar plano"}
            </button>
          </div>

          {/* Desconto só aparece aqui porque o select não mostra essa
              informação — nome, valor e vencimento já estão na opção
              selecionada, então não repetimos. */}
          {billing && billing.discountType !== "none" && (
            <p className="athlete-financial-preview">
              <b>Desconto:</b>{" "}
              {billing.discountType === "percent"
                ? `${billing.discountValue}%`
                : formatCentsToBRL(billing.discountValue)}
            </p>
          )}

          {mismatch && (
            <p className="form-warning">
              O plano financeiro atual está vinculado à categoria {billing?.planCategory}.
              Revise a configuração financeira deste atleta.
            </p>
          )}

          {/* Puramente informativo — nenhum destes estados cria payment,
              dispara mensageria/integração externa ou altera Combo. Geração
              de mensalidade continua exclusiva da tela Financeiro → Mensalidades. */}
          {financialStatus === "configured_pending" && (
            <p className="athlete-financial-hint">Gere a mensalidade em Financeiro → Mensalidades.</p>
          )}
          {financialStatus === "billed" && payment && (
            <p className="athlete-financial-preview">
              {formatReferenceMonth(payment.referenceMonth)} · {formatCentsToBRL(payment.amountCents)} · vence{" "}
              {new Date(`${payment.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}{" "}
              <b className={`charge-status ${payment.status}`}>{paymentStatusLabel(payment.status)}</b>
            </p>
          )}
          {financialStatus === "combo_covered" && (
            <p className="athlete-financial-hint">
              A mensalidade desta competência não é gerada — ela já está coberta por um Combo.
            </p>
          )}
        </>
      )}
    </section>
  );
}
