// Lógica pura do bloco "Configuração financeira" no cadastro/edição do
// atleta. Sem JSX, para poder ser importada e executada de verdade em
// teste (mesmo padrão de app/combo-athlete-search.ts).

export type BillingPlanOption = {
  id: string;
  name: string;
  amountCents: number;
  dueDay: number;
  category: string | null;
  active: boolean;
};

// Só planos ativos entram como opção — planos arquivados nunca aparecem
// no seletor do cadastro do atleta.
export function getActivePlans<T extends { active: boolean }>(plans: T[]): T[] {
  return plans.filter((plan) => plan.active);
}

export function getPlansForCategory(
  plans: BillingPlanOption[],
  category: string,
): BillingPlanOption[] {
  return getActivePlans(plans).filter((plan) => plan.category === category);
}

// Um plano sem categoria (null/vazio) é tratado como plano geral/universal —
// compatível com qualquer categoria de atleta. Usada tanto para filtrar o
// seletor do cadastro/edição quanto para validar no backend (mesma regra
// nos dois lados, sem confiar só na UI).
export function planCategoryCompatible(
  planCategory: string | null | undefined,
  athleteCategory: string,
): boolean {
  if (!planCategory) return true;
  return planCategory === athleteCategory;
}

// Planos que devem aparecer no seletor do bloco Financeiro: ativos e
// compatíveis com a categoria do atleta (mesma categoria ou plano geral).
// Planos de outras categorias (Sub-9, Sub-15, ...) não aparecem aqui.
export function getCategoryCompatiblePlans(
  plans: BillingPlanOption[],
  athleteCategory: string,
): BillingPlanOption[] {
  return getActivePlans(plans).filter((plan) =>
    planCategoryCompatible(plan.category, athleteCategory),
  );
}

// Sugestão de plano pela categoria do atleta. NUNCA seleciona sozinho
// quando há ambiguidade — só sugere quando existe exatamente um plano
// ativo compatível. O chamador ainda precisa confirmar (salvar) para que
// qualquer vínculo seja de fato criado.
export function suggestPlanForCategory(
  plans: BillingPlanOption[],
  category: string,
): { plan: BillingPlanOption | null; ambiguous: boolean } {
  const matches = getPlansForCategory(plans, category);
  if (matches.length === 1) return { plan: matches[0], ambiguous: false };
  if (matches.length === 0) return { plan: null, ambiguous: false };
  return { plan: null, ambiguous: true };
}

export function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Um plano vinculado (athlete_billing) cuja categoria não bate mais com a
// categoria atual do atleta no formulário — dispara o aviso de revisão,
// nunca uma troca automática.
export function planCategoryMismatch(
  billingPlanCategory: string | null | undefined,
  athleteCategory: string,
): boolean {
  return Boolean(billingPlanCategory) && billingPlanCategory !== athleteCategory;
}

// ------------------------------------------------------------------
// Status financeiro exibido no bloco "Financeiro" do cadastro/edição do
// atleta — distingue "tem plano vinculado" de "já existe mensalidade
// gerada para a competência atual", que são coisas diferentes (uma vem de
// athlete_billing, a outra de payments/athlete_combo_coverage).
// ------------------------------------------------------------------
export type FinancialStatus = "unconfigured" | "configured_pending" | "billed" | "combo_covered";

// Combo tem prioridade: se a competência está coberta por Combo, a ausência
// de payment mensal é intencional (não é "mensalidade pendente"), mesmo que
// o atleta também tenha (ou não) um plano mensal configurado.
export function resolveFinancialStatus(params: {
  hasBilling: boolean;
  hasPayment: boolean;
  comboCovered: boolean;
}): FinancialStatus {
  if (params.comboCovered) return "combo_covered";
  if (!params.hasBilling) return "unconfigured";
  if (!params.hasPayment) return "configured_pending";
  return "billed";
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  partial: "Parcial",
  overdue: "Vencido",
  cancelled: "Cancelado",
  open: "Em aberto",
};

// Mesma tradução curta já usada para o badge de cobrança em
// app/FinanceManagement.tsx — reaproveitada aqui para não divergir.
export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? "Em aberto";
}

// "2026-08" -> "agosto de 2026". Mesma lógica de app/FinanceManagement.tsx
// (monthLabel), reaproveitada para exibir a competência da mensalidade
// gerada dentro do bloco Financeiro do atleta.
export function formatReferenceMonth(month: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
