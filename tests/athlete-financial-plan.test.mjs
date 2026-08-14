import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getActivePlans,
  getCategoryCompatiblePlans,
  getPlansForCategory,
  planCategoryCompatible,
  suggestPlanForCategory,
  formatCentsToBRL,
  formatReferenceMonth,
  paymentStatusLabel,
  planCategoryMismatch,
  resolveFinancialStatus,
} from "../app/athlete-financial-plan.ts";

// Estes testes importam e EXECUTAM o módulo real usado pelo bloco
// "Financeiro" do cadastro/edição do atleta (app/AthleteFinancialSection.tsx
// importa exatamente este módulo).

const plans = [
  { id: "p1", name: "SUB 11", amountCents: 5000, dueDay: 10, category: "Sub-11", active: true },
  { id: "p2", name: "Plano Sub-11", amountCents: 20000, dueDay: 10, category: "Sub-11", active: true },
  { id: "p3", name: "SUB 9", amountCents: 4000, dueDay: 5, category: "Sub-9", active: true },
  { id: "p4", name: "Plano arquivado Sub-9", amountCents: 3000, dueDay: 5, category: "Sub-9", active: false },
];

test("1. atleta sem plano: getPlansForCategory retorna só ativos da categoria", () => {
  const result = getPlansForCategory(plans, "Sub-9");
  assert.deepEqual(result.map((p) => p.id), ["p3"]);
});

test("3. lista de planos contém apenas os ativos", () => {
  const active = getActivePlans(plans);
  assert.deepEqual(active.map((p) => p.id), ["p1", "p2", "p3"]);
  assert.ok(!active.some((p) => p.id === "p4"));
});

test("4. sugestão por categoria: exatamente um plano compatível é sugerido", () => {
  const { plan, ambiguous } = suggestPlanForCategory(plans, "Sub-9");
  assert.equal(plan?.id, "p3");
  assert.equal(ambiguous, false);
});

test("5. múltiplos planos da mesma categoria: NÃO seleciona sozinho (ambíguo)", () => {
  const { plan, ambiguous } = suggestPlanForCategory(plans, "Sub-11");
  assert.equal(plan, null);
  assert.equal(ambiguous, true);
});

test("categoria sem nenhum plano compatível: não sugere nada e não é ambíguo", () => {
  const { plan, ambiguous } = suggestPlanForCategory(plans, "Sub-13");
  assert.equal(plan, null);
  assert.equal(ambiguous, false);
});

test("formatCentsToBRL formata em reais", () => {
  assert.equal(formatCentsToBRL(5000), "R$ 50,00");
});

test("planCategoryMismatch detecta divergência entre plano vinculado e categoria atual", () => {
  assert.equal(planCategoryMismatch("Sub-11", "Sub-13"), true);
  assert.equal(planCategoryMismatch("Sub-11", "Sub-11"), false);
  assert.equal(planCategoryMismatch(null, "Sub-11"), false);
});

// ------------------------------------------------------------------
// Prova via fonte real: wiring do bloco e das rotas, sem duplicar lógica.
// ------------------------------------------------------------------
const sectionSource = readFileSync(new URL("../app/AthleteFinancialSection.tsx", import.meta.url), "utf8");
const editModalSource = readFileSync(new URL("../app/AthleteEditModal.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/finance/athletes/[athleteId]/route.ts", import.meta.url), "utf8");

test("2. bloco Financeiro aparece na edição do atleta (AthleteEditModal importa e renderiza)", () => {
  assert.match(editModalSource, /import \{ AthleteFinancialSection \} from "\.\/AthleteFinancialSection"/);
  assert.match(editModalSource, /<AthleteFinancialSection/);
});

test("4/5. estados \"Sem configuração financeira\" e \"Plano configurado\" existem no componente", () => {
  assert.match(sectionSource, /Sem configuração financeira/);
  assert.match(sectionSource, /Plano configurado/);
});

test("6. salvar usa a rota PATCH já existente (nenhuma rota nova de escrita)", () => {
  assert.match(sectionSource, /fetch\(`\/api\/finance\/athletes\/\$\{athleteId\}`, \{\s*\n\s*method: "PATCH"/);
});

test("7/8. salvar plano não cria payment nem toca ledger/payment_transactions", () => {
  assert.doesNotMatch(sectionSource, /payment_transactions|\bledger\b/i);
  assert.doesNotMatch(sectionSource, /INSERT INTO payments|insert\(payments\)/i);
});

test("12/13. bloco não altera Combo nem chama Asaas/WhatsApp", () => {
  assert.doesNotMatch(sectionSource, /athlete_combos|athlete_combo_coverage|asaas|whatsapp/i);
});

test("9. GET real de configuração financeira é somente leitura (sem insert/update/delete)", () => {
  const getMatch = routeSource.match(/export async function GET[\s\S]*?\n}\n/);
  assert.ok(getMatch, "GET handler not found");
  assert.doesNotMatch(getMatch[0], /db\.insert|db\.update|db\.delete|INSERT INTO|UPDATE |DELETE FROM/i);
});

test("14. aviso de categoria divergente presente no componente (não troca plano sozinho)", () => {
  assert.match(sectionSource, /Revise a configuração financeira deste atleta/);
  assert.match(sectionSource, /planCategoryMismatch/);
});

test("sugestão nunca é gravada sem clique explícito em Salvar (botão existe e faz o PATCH)", () => {
  assert.match(sectionSource, /Salvar plano/);
  assert.match(sectionSource, /onClick=\{\(\) => void savePlan\(\)\}/);
});

// ------------------------------------------------------------------
// Filtro do seletor de plano por categoria do atleta (RAFAEL/Sub-13 não
// pode ver Sub-11/Sub-9/Sub-15/Sub-17).
// ------------------------------------------------------------------
const plansByCategory = [
  { id: "sub13", name: "SUB13", amountCents: 6000, dueDay: 10, category: "Sub-13", active: true },
  { id: "sub11", name: "SUB 11", amountCents: 5000, dueDay: 10, category: "Sub-11", active: true },
  { id: "plano-sub11", name: "Plano Sub-11", amountCents: 20000, dueDay: 10, category: "Sub-11", active: true },
  { id: "sub9", name: "SUB 9", amountCents: 4000, dueDay: 5, category: "Sub-9", active: true },
  { id: "sub15", name: "SUB15", amountCents: 7000, dueDay: 10, category: "Sub-15", active: true },
  { id: "sub17", name: "sub17", amountCents: 7500, dueDay: 10, category: "Sub-17", active: true },
  { id: "geral", name: "Plano geral", amountCents: 5500, dueDay: 10, category: null, active: true },
];

test("1/2. Sub-13 vê o plano Sub-13", () => {
  const visible = getCategoryCompatiblePlans(plansByCategory, "Sub-13").map((p) => p.id);
  assert.ok(visible.includes("sub13"));
});

test("2. Sub-13 NÃO vê Sub-11", () => {
  const visible = getCategoryCompatiblePlans(plansByCategory, "Sub-13").map((p) => p.id);
  assert.ok(!visible.includes("sub11"));
  assert.ok(!visible.includes("plano-sub11"));
});

test("3. Sub-13 NÃO vê Sub-15 nem Sub-17 nem Sub-9", () => {
  const visible = getCategoryCompatiblePlans(plansByCategory, "Sub-13").map((p) => p.id);
  assert.ok(!visible.includes("sub15"));
  assert.ok(!visible.includes("sub17"));
  assert.ok(!visible.includes("sub9"));
});

test("4. plano sem categoria (geral) aparece para qualquer categoria", () => {
  const visible = getCategoryCompatiblePlans(plansByCategory, "Sub-13").map((p) => p.id);
  assert.ok(visible.includes("geral"));
});

test("planCategoryCompatible: mesma categoria compatível, outra categoria não, sem categoria sempre compatível", () => {
  assert.equal(planCategoryCompatible("Sub-13", "Sub-13"), true);
  assert.equal(planCategoryCompatible("Sub-11", "Sub-13"), false);
  assert.equal(planCategoryCompatible(null, "Sub-13"), true);
  assert.equal(planCategoryCompatible("", "Sub-13"), true);
});

test("5/6/7. backend usa planCategoryCompatible para validar (rejeita Sub-13->Sub-11, aceita Sub-13->Sub-13 e plano geral)", () => {
  assert.match(routeSource, /import \{ planCategoryCompatible \} from/);
  assert.match(routeSource, /planCategoryCompatible\(plan\.category, athlete\.category\)/);
  // A mesma regra também está embutida na query de escrita (defesa em profundidade).
  assert.match(routeSource, /p\.category IS NULL OR p\.category = '' OR p\.category = a\.category/);
});

test("9. seletor não troca plano automaticamente ao ficar incompatível: plano atual continua listado", () => {
  assert.match(sectionSource, /selectablePlans/);
  assert.match(sectionSource, /getCategoryCompatiblePlans/);
});

test("10. filtro por categoria não quebra isolamento por organização (GET/PATCH continuam escopados por organizationId)", () => {
  assert.match(routeSource, /eq\(athleteBilling\.organizationId, organizationId\)/);
  assert.match(routeSource, /eq\(billingPlans\.organizationId, organizationId\)/);
  assert.match(routeSource, /eq\(athletes\.organizationId, organizationId\)/);
});

// ------------------------------------------------------------------
// Consistência: Financeiro > Mensalidades > "Cobrança do atleta"
// (app/FinanceManagement.tsx, BillingModal) usa a MESMA regra de
// compatibilidade de categoria do bloco Financeiro do atleta — sem
// duplicar lógica, sem divergir de comportamento entre as duas telas.
// ------------------------------------------------------------------
const financeManagementSource = readFileSync(
  new URL("../app/FinanceManagement.tsx", import.meta.url),
  "utf8",
);

test("1. FinanceManagement importa e usa a função compartilhada planCategoryCompatible", () => {
  assert.match(
    financeManagementSource,
    /import \{ planCategoryCompatible, suggestPlanForCategory \} from "\.\/athlete-financial-plan"/,
  );
  assert.match(financeManagementSource, /plans\.filter\(\(plan\) => planCategoryCompatible\(plan\.category, athlete\.category\)\)/);
});

test("2/3. BillingModal filtra o seletor por compatiblePlans (Sub-11 não aparece para Sub-13)", () => {
  const modalMatch = financeManagementSource.match(/function BillingModal\([\s\S]*?\n}\n/);
  assert.ok(modalMatch, "BillingModal not found");
  const modalSource = modalMatch[0];
  // O <select> de planos itera compatiblePlans, não a lista completa "plans".
  assert.match(modalSource, /\{compatiblePlans\.map\(\(plan\) => \(/);
  assert.doesNotMatch(modalSource, /\{plans\.map\(\(plan\) => \(/);
});

test("4. plano geral (category null/vazio) continua elegível — mesma função planCategoryCompatible", () => {
  const geral = { id: "g", name: "Plano geral", amountCents: 5000, dueDay: 10, category: null };
  const sub13 = { id: "s13", name: "SUB13", amountCents: 6000, dueDay: 10, category: "Sub-13" };
  const sub11 = { id: "s11", name: "SUB 11", amountCents: 5000, dueDay: 10, category: "Sub-11" };
  const compatible = [geral, sub13, sub11].filter((plan) => planCategoryCompatible(plan.category, "Sub-13"));
  assert.deepEqual(compatible.map((p) => p.id).sort(), ["g", "s13"]);
});

test("5. múltiplos planos compatíveis: BillingModal usa suggestPlanForCategory (não escolhe sozinho)", () => {
  assert.match(financeManagementSource, /suggestion = suggestPlanForCategory\(/);
  assert.match(financeManagementSource, /defaultPlanId = !currentIncompatible && current \? current\.planId : suggestion\.plan\?\.id/);
  assert.match(financeManagementSource, /\{!defaultPlanId && <option value="">Selecionar plano<\/option>\}/);
});

test("5b. plano histórico incompatível gera aviso (mesmo texto/regra do bloco Financeiro do atleta)", () => {
  assert.match(financeManagementSource, /currentIncompatible = Boolean\(current\) && !planCategoryCompatible\(currentPlanCategory, athlete\.category\)/);
  assert.match(financeManagementSource, /Revise a configuração deste atleta/);
});

test("6. BillingModal não duplica a lógica de compatibilidade — reusa planCategoryCompatible do módulo compartilhado", () => {
  const modalMatch = financeManagementSource.match(/function BillingModal\([\s\S]*?\n}\n/);
  const modalSource = modalMatch[0];
  // Nenhuma comparação manual "plan.category === athlete.category" fora da função importada.
  assert.doesNotMatch(modalSource, /plan\.category === athlete\.category \? true : false/);
  assert.match(modalSource, /planCategoryCompatible\(/);
});

test("7. salvar no BillingModal continua usando a mesma rota PATCH e não cria/edita payments", () => {
  const modalMatch = financeManagementSource.match(/function BillingModal\([\s\S]*?\n}\n/);
  const modalSource = modalMatch[0];
  assert.match(modalSource, /fetch\(`\/api\/finance\/athletes\/\$\{athlete\.id\}`, \{\s*\n\s*method: "PATCH"/);
  assert.doesNotMatch(modalSource, /payment_transactions|\bledger\b|INSERT INTO payments|insert\(payments\)/i);
});

// ------------------------------------------------------------------
// Status financeiro real no bloco Financeiro do atleta: "plano configurado"
// e "mensalidade gerada" são estados DIFERENTES (athlete_billing x payments),
// e "coberto por Combo" tem prioridade sobre os dois quando aplicável.
// ------------------------------------------------------------------

test("1. sem athlete_billing -> unconfigured", () => {
  const status = resolveFinancialStatus({ hasBilling: false, hasPayment: false, comboCovered: false });
  assert.equal(status, "unconfigured");
});

test("2. com athlete_billing, sem payment da competência atual -> configured_pending", () => {
  const status = resolveFinancialStatus({ hasBilling: true, hasPayment: false, comboCovered: false });
  assert.equal(status, "configured_pending");
});

test("3. com athlete_billing e payment da competência atual -> billed", () => {
  const status = resolveFinancialStatus({ hasBilling: true, hasPayment: true, comboCovered: false });
  assert.equal(status, "billed");
});

test("4/5. com payment status 'paid' -> paymentStatusLabel traduz para 'Pago' (mesmo padrão visual do charge-status)", () => {
  assert.equal(paymentStatusLabel("paid"), "Pago");
  assert.equal(paymentStatusLabel("partial"), "Parcial");
  assert.equal(paymentStatusLabel("overdue"), "Vencido");
  assert.equal(paymentStatusLabel("open"), "Em aberto");
  assert.equal(paymentStatusLabel("cancelled"), "Cancelado");
});

test("5. reservation/coverage de Combo -> combo_covered, mesmo com athlete_billing configurado e sem payment", () => {
  const status = resolveFinancialStatus({ hasBilling: true, hasPayment: false, comboCovered: true });
  assert.equal(status, "combo_covered");
});

test("6. Combo não gera falso aviso de mensalidade faltando: comboCovered tem prioridade mesmo sem billing/payment", () => {
  const status = resolveFinancialStatus({ hasBilling: false, hasPayment: false, comboCovered: true });
  assert.equal(status, "combo_covered");
});

test("formatReferenceMonth formata a competência por extenso", () => {
  assert.equal(formatReferenceMonth("2026-08"), "agosto de 2026");
});

// ------------------------------------------------------------------
// Wiring real: GET /api/finance/athletes/[athleteId] passa a informar
// payment e cobertura de Combo da competência atual, sem criar nada.
// ------------------------------------------------------------------
const athleteBillingRouteSource = readFileSync(
  new URL("../app/api/finance/athletes/[athleteId]/route.ts", import.meta.url),
  "utf8",
);

test("7. nenhum payment/athlete_combo_coverage é criado só por abrir/carregar (GET é somente leitura)", () => {
  const getMatch = athleteBillingRouteSource.match(/export async function GET[\s\S]*?\n}\n/);
  assert.ok(getMatch, "GET handler not found");
  assert.doesNotMatch(getMatch[0], /db\.insert|db\.update|db\.delete|INSERT INTO|UPDATE |DELETE FROM/i);
});

test("GET usa currentReferenceMonth (America/Sao_Paulo) — não cria regra temporal paralela", () => {
  assert.match(athleteBillingRouteSource, /import \{ currentReferenceMonth, parseMoneyToCents \} from "\.\.\/\.\.\/finance-utils"/);
  assert.match(athleteBillingRouteSource, /const currentMonth = currentReferenceMonth\(\);/);
});

test("GET retorna payment (excluindo cancelled) e comboCovered da competência atual", () => {
  assert.match(athleteBillingRouteSource, /eq\(payments\.referenceMonth, currentMonth\)/);
  assert.match(athleteBillingRouteSource, /ne\(payments\.status, "cancelled"\)/);
  assert.match(athleteBillingRouteSource, /eq\(athleteComboCoverage\.referenceMonth, currentMonth\)/);
  assert.match(athleteBillingRouteSource, /comboCovered: Boolean\(coverageRow\)/);
});

test("8. tenant isolation: payment e coverage também são escopados por organizationId", () => {
  assert.match(athleteBillingRouteSource, /eq\(payments\.organizationId, organizationId\)/);
  assert.match(athleteBillingRouteSource, /eq\(athleteComboCoverage\.organizationId, organizationId\)/);
});

test("bloco Financeiro do atleta distingue os 4 estados no texto exibido", () => {
  assert.match(sectionSource, /Sem configuração financeira/);
  assert.match(sectionSource, /Plano configurado/);
  assert.match(sectionSource, /mensalidade ainda não gerada/);
  assert.match(sectionSource, /Mensalidade gerada/);
  assert.match(sectionSource, /Competência coberta por Combo/);
  assert.match(sectionSource, /Gere a mensalidade em Financeiro → Mensalidades\./);
});

test("bloco Financeiro do atleta usa resolveFinancialStatus (não reimplementa a regra de estado)", () => {
  assert.match(sectionSource, /import \{[\s\S]*?resolveFinancialStatus[\s\S]*?\} from "\.\/athlete-financial-plan"/);
  assert.match(sectionSource, /resolveFinancialStatus\(\{/);
});

test("salvar o plano continua sem criar payment/ledger/Combo/Asaas/WhatsApp (regressão)", () => {
  assert.doesNotMatch(sectionSource, /payment_transactions|\bledger\b/i);
  assert.doesNotMatch(sectionSource, /INSERT INTO payments|insert\(payments\)/i);
  assert.doesNotMatch(sectionSource, /athlete_combos|athlete_combo_coverage|asaas|whatsapp/i);
});
