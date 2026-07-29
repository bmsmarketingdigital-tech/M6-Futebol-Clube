"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AthleteRecord } from "./AthleteProfileModal";

type Plan = {
  id: string;
  name: string;
  amountCents: number;
  dueDay: number;
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
  status: "open" | "paid" | "overdue" | "cancelled";
};

type FinancePayload = {
  plans: Plan[];
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
};

const emptyPayload: FinancePayload = {
  plans: [],
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
  athletes,
  notify,
  onChanged,
}: {
  athletes: AthleteRecord[];
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<FinancePayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [planModal, setPlanModal] = useState<Plan | "new" | null>(null);
  const [billingAthlete, setBillingAthlete] = useState<AthleteRecord | null>(null);
  const [paymentCharge, setPaymentCharge] = useState<Charge | null>(null);

  async function loadFinance() {
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
  }

  useEffect(() => {
    void loadFinance();
  }, [month]);

  const billingByAthlete = useMemo(
    () => new Map(data.billing.map((item) => [item.athleteId, item])),
    [data.billing],
  );

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

  async function archivePlan(plan: Plan) {
    if (!window.confirm(`Arquivar o plano “${plan.name}”?`)) return;
    const response = await fetch(`/api/finance/plans/${plan.id}`, {
      method: "DELETE",
    });
    const payload = await readJson<{ archived: boolean }>(response);
    if (!response.ok) {
      notify(payload.error || "Não foi possível arquivar o plano.");
      return;
    }
    notify("Plano arquivado. As cobranças antigas foram preservadas.");
    setPlanModal(null);
    await loadFinance();
  }

  async function cancelCharge(charge: Charge) {
    if (!window.confirm(`Cancelar a mensalidade de ${charge.athleteName}?`)) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/finance/charges/${charge.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload = await readJson<{ updated: boolean }>(response);
      if (!response.ok) throw new Error(payload.error);
      notify("Cobrança cancelada.");
      await loadFinance();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível cancelar.");
    } finally {
      setWorking(false);
    }
  }

  const configuredCount = data.billing.filter((item) => item.active).length;

  return (
    <>
      <div className="section-heading finance-heading">
        <div>
          <span className="eyebrow">GESTÃO FINANCEIRA</span>
          <h1>Financeiro</h1>
          <p>Planos, mensalidades, recebimentos e inadimplência em um só lugar.</p>
        </div>
        <div className="finance-heading-actions">
          <label>
            Mês de referência
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <button className="filter-button" onClick={() => setPlanModal("new")}>＋ Novo plano</button>
          <button className="primary-button" disabled={working} onClick={() => void generateCharges()}>
            {working ? "Processando..." : "Gerar mensalidades"}
          </button>
        </div>
      </div>

      <section className="finance-metrics">
        <FinanceMetric label="PREVISTO" value={money(data.summary.expectedCents)} detail={monthLabel(month)} tone="green" />
        <FinanceMetric label="RECEBIDO" value={money(data.summary.receivedCents)} detail={`${data.summary.paidCount} baixa(s)`} tone="blue" />
        <FinanceMetric label="A RECEBER" value={money(data.summary.pendingCents)} detail="dentro do vencimento" tone="orange" />
        <FinanceMetric label="EM ATRASO" value={money(data.summary.overdueCents)} detail={`${data.summary.overdueCount} vencida(s)`} tone="red" />
      </section>

      <section className="card plan-strip">
        <div>
          <span className="eyebrow">PLANOS ATIVOS</span>
          <strong>{data.plans.length ? "Clique para editar" : "Nenhum plano cadastrado"}</strong>
        </div>
        <div className="plan-strip-list">
          {data.plans.map((plan) => (
            <button key={plan.id} onClick={() => setPlanModal(plan)}>
              <span><strong>{plan.name}</strong><small>Vence dia {plan.dueDay}</small></span>
              <b>{money(plan.amountCents)}</b>
            </button>
          ))}
          <button className="new-plan-card" onClick={() => setPlanModal("new")}>＋ Criar plano</button>
        </div>
      </section>

      <section className="finance-layout">
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
          <div className="charge-table">
            <div className="charge-row charge-head">
              <span>ATLETA</span><span>VENCIMENTO</span><span>VALOR</span><span>SITUAÇÃO</span><span />
            </div>
            {data.charges.map((charge) => (
              <div className="charge-row" key={charge.id}>
                <span className="charge-athlete">
                  <i>{charge.athleteName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</i>
                  <span><strong>{charge.athleteName}</strong><small>{charge.planName || charge.category}</small></span>
                </span>
                <span><strong>{new Date(`${charge.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</strong><small>{charge.paymentMethod ? methodLabels[charge.paymentMethod] : "Mensalidade"}</small></span>
                <span><strong>{money(charge.amountCents)}</strong>{charge.paidAmountCents !== null && charge.paidAmountCents !== charge.amountCents && <small>Recebido {money(charge.paidAmountCents)}</small>}</span>
                <span><b className={`charge-status ${charge.status}`}>{charge.status === "paid" ? "Pago" : charge.status === "overdue" ? "Vencido" : charge.status === "cancelled" ? "Cancelado" : "Em aberto"}</b></span>
                <span className="charge-actions">
                  {(charge.status === "open" || charge.status === "overdue") && (
                    <>
                      <button onClick={() => setPaymentCharge(charge)}>Dar baixa</button>
                      <button className="danger-link" disabled={working} onClick={() => void cancelCharge(charge)}>Cancelar</button>
                    </>
                  )}
                </span>
              </div>
            ))}
            {!loading && data.charges.length === 0 && (
              <div className="finance-empty">
                <span>$</span><strong>Nenhuma mensalidade neste mês</strong>
                <small>Configure os atletas e clique em “Gerar mensalidades”.</small>
              </div>
            )}
          </div>
        </div>

        <aside className="card billing-config-card">
          <div className="card-header">
            <div><h2>Configuração de cobrança</h2><p>{configuredCount} de {athletes.length} atletas configurados</p></div>
          </div>
          <div className="billing-list">
            {athletes.map((athlete) => {
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
          </div>
        </aside>
      </section>

      {planModal && (
        <PlanModal
          plan={planModal === "new" ? null : planModal}
          onClose={() => setPlanModal(null)}
          onSaved={async (message) => {
            setPlanModal(null);
            notify(message);
            await loadFinance();
          }}
          onArchive={archivePlan}
        />
      )}
      {billingAthlete && (
        <BillingModal
          athlete={billingAthlete}
          plans={data.plans}
          current={billingByAthlete.get(billingAthlete.id)}
          onClose={() => setBillingAthlete(null)}
          onSaved={async () => {
            setBillingAthlete(null);
            notify("Configuração de cobrança salva.");
            await loadFinance();
          }}
        />
      )}
      {paymentCharge && (
        <PaymentModal
          charge={paymentCharge}
          onClose={() => setPaymentCharge(null)}
          onSaved={async () => {
            setPaymentCharge(null);
            notify("Pagamento registrado com sucesso.");
            await loadFinance();
            onChanged();
          }}
        />
      )}
    </>
  );
}

function FinanceMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>$</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function PlanModal({
  plan,
  onClose,
  onSaved,
  onArchive,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onArchive: (plan: Plan) => void;
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
        }),
      });
      const payload = await readJson<{ plan: Plan }>(response);
      if (!response.ok) throw new Error(payload.error);
      onSaved(plan ? "Plano atualizado." : "Plano criado com sucesso.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível salvar o plano.");
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
          <label>Nome do plano<input name="name" required defaultValue={plan?.name} placeholder="Ex.: Plano regular" /></label>
          <div className="form-row">
            <label>Valor mensal (R$)<input name="amount" type="number" step="0.01" min="0.01" required defaultValue={plan ? plan.amountCents / 100 : ""} /></label>
            <label>Dia do vencimento<input name="dueDay" type="number" min="1" max="28" required defaultValue={plan?.dueDay ?? 10} /></label>
          </div>
          <button className="primary-button full" disabled={saving}>{saving ? "Salvando..." : "Salvar plano"}</button>
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
  onClose,
  onSaved,
}: {
  athlete: AthleteRecord;
  plans: Plan[];
  current?: Billing;
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
      window.alert(error instanceof Error ? error.message : "Não foi possível salvar.");
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
            <label>Plano<select name="planId" required defaultValue={current?.planId ?? plans[0]?.id}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.amountCents)}</option>)}</select></label>
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

function PaymentModal({ charge, onClose, onSaved }: { charge: Charge; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
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
      window.alert(error instanceof Error ? error.message : "Não foi possível registrar a baixa.");
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
        <p>Mensalidade de {money(charge.amountCents)} com vencimento em {new Date(`${charge.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}.</p>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Valor recebido (R$)<input name="paidAmount" type="number" step="0.01" min="0" required defaultValue={(charge.amountCents / 100).toFixed(2)} /></label>
            <label>Forma de pagamento<select name="paymentMethod" defaultValue="pix"><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="bank">Transferência</option><option value="other">Outro</option></select></label>
          </div>
          <label>Observação<input name="notes" maxLength={300} placeholder="Opcional" /></label>
          <button className="primary-button full" disabled={saving}>{saving ? "Registrando..." : "Confirmar recebimento"}</button>
        </form>
      </div>
    </div>
  );
}
