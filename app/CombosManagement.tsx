"use client";

import { useEffect, useState } from "react";
import { Copy, Power, Plus, UserPlus, WalletCards, X } from "lucide-react";

type Combo = {
  id: string;
  name: string;
  comboType: string;
  durationMonths: number;
  baseAmountCents: number;
  discountType: string;
  discountValue: number;
  finalAmountCents: number;
  billingMode: string;
  installmentCount: number;
  active: boolean;
  planName: string | null;
};

type Athlete = { id: string; fullName: string; active?: boolean };

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const parseCurrency = (value: string) => Number(value.replace(/\D/g, "")) || 0;
const parsePercent = (value: string) =>
  Math.max(0, Math.min(100, Number(value.replace(/\D/g, "")) || 0));

function comboTypeLabel(type: string) {
  return { monthly: "Mensal", quarterly: "Trimestral", annual: "Anual", custom: "Personalizado" }[type] ?? "Personalizado";
}

export default function CombosManagement({ notify, athletes }: { notify: (message: string) => void; athletes: Athlete[] }) {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [open, setOpen] = useState(false);
  const [applyCombo, setApplyCombo] = useState<Combo | null>(null);
  const [applyAthlete, setApplyAthlete] = useState("");
  const [startDate, setStartDate] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState({
    name: "",
    comboType: "monthly",
    durationMonths: 1,
    baseAmountCents: 0,
    discountType: "none",
    discountValue: 0,
    billingMode: "installments",
    installmentCount: 1,
  });

  async function load() {
    const response = await fetch("/api/finance/combos");
    const payload = await response.json();
    if (response.ok) setCombos(payload.combos ?? []);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/finance/combos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    if (!response.ok) return notify(payload.error ?? "Não foi possível criar o combo.");
    notify("Combo criado com sucesso.");
    setOpen(false);
    await load();
  }

  async function toggle(combo: Combo) {
    await fetch(`/api/finance/combos/${combo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !combo.active }),
    });
    await load();
  }

  function beginApply(combo: Combo) {
    setApplyCombo(combo);
    setApplyAthlete("");
    setStartDate("");
    setFirstDueDate("");
  }

  async function confirmApply() {
    if (!applyCombo || !applyAthlete || !startDate || !firstDueDate) return;
    setApplying(true);
    const response = await fetch("/api/finance/combos/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comboId: applyCombo.id, athleteId: applyAthlete, startDate, firstDueDate }),
    });
    const payload = await response.json();
    setApplying(false);
    if (!response.ok) return notify(payload.error ?? "Não foi possível aplicar o combo.");
    notify("Combo aplicado ao aluno com sucesso.");
    setApplyCombo(null);
  }

  return (
    <div className="finance-page-content combos-page">
      <div className="section-heading finance-heading">
        <div><span className="eyebrow">FINANCEIRO</span><h1>Combos</h1><p>Crie pacotes e condições especiais para os alunos.</p></div>
        <button className="primary-button" onClick={() => setOpen(true)}><Plus size={16} /> Novo Combo</button>
      </div>

      <div className="finance-metrics combos-metrics">
        <div className="card metric-card"><WalletCards size={18} /><span>Combos ativos</span><strong>{combos.filter((combo) => combo.active).length}</strong></div>
        <div className="card metric-card"><span>Valor final cadastrado</span><strong>{money(combos.reduce((sum, combo) => sum + combo.finalAmountCents, 0))}</strong></div>
      </div>

      <div className="combo-grid">
        {combos.map((combo) => (
          <article className="card combo-card" key={combo.id}>
            <div className="combo-card-head">
              <div><span className="eyebrow">{comboTypeLabel(combo.comboType)}</span><h3>{combo.name}</h3></div>
              <span className={combo.active ? "combo-status active" : "combo-status inactive"}>{combo.active ? "Ativo" : "Inativo"}</span>
            </div>
            <p className="combo-meta">{combo.durationMonths} {combo.durationMonths === 1 ? "mês" : "meses"} · {combo.billingMode === "upfront" ? "À vista" : `${combo.installmentCount} ${combo.installmentCount === 1 ? "parcela" : "parcelas"}`}</p>
            <strong className="combo-price">{money(combo.finalAmountCents)}</strong>
            <small className="combo-pricing">Valor normal: {money(combo.baseAmountCents)} · Desconto: {combo.discountType === "percent" ? `${combo.discountValue}%` : money(combo.discountValue)}</small>
            <div className="combo-card-actions">
              <button className="combo-action primary" disabled={!combo.active} onClick={() => beginApply(combo)}><UserPlus size={16} /> Aplicar a aluno</button>
              <button className="combo-action" onClick={() => void toggle(combo)}><Power size={15} /> {combo.active ? "Desativar" : "Ativar"}</button>
              <button className="combo-action icon" title="Duplicar combo" aria-label="Duplicar combo" onClick={() => { setForm({ name: `${combo.name} (cópia)`, comboType: combo.comboType, durationMonths: combo.durationMonths, baseAmountCents: combo.baseAmountCents, discountType: combo.discountType, discountValue: combo.discountValue, billingMode: combo.billingMode, installmentCount: combo.installmentCount }); setOpen(true); }}><Copy size={16} /></button>
            </div>
          </article>
        ))}
      </div>

      {!combos.length && <div className="card finance-empty"><strong>Nenhum combo cadastrado</strong><small>Crie o primeiro pacote comercial para sua escola.</small></div>}

      {open && <div className="modal-backdrop"><form className="modal-card combo-modal" onSubmit={save}>
        <header className="combo-modal-header"><div><span className="eyebrow">FINANCEIRO</span><h2>Novo Combo</h2><p>Configure o pacote comercial e as condições de cobrança.</p></div><button type="button" className="combo-modal-close" onClick={() => setOpen(false)}><X size={18} /></button></header>
        <label>Nome<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Tipo<select value={form.comboType} onChange={(event) => setForm({ ...form, comboType: event.target.value })}><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="annual">Anual</option><option value="custom">Personalizado</option></select></label>
        <div className="combo-form-grid">
          <label>Duração (meses)<input type="number" min="1" value={form.durationMonths} onChange={(event) => setForm({ ...form, durationMonths: Number(event.target.value) })} /></label>
          <label>Valor normal (R$)<input inputMode="decimal" value={money(form.baseAmountCents)} onChange={(event) => setForm({ ...form, baseAmountCents: parseCurrency(event.target.value) })} /></label>
          <label>Desconto<select value={form.discountType} onChange={(event) => setForm({ ...form, discountType: event.target.value, discountValue: 0 })}><option value="none">Sem desconto</option><option value="percent">Percentual</option><option value="fixed">Valor fixo</option></select></label>
          <label>Valor do desconto ({form.discountType === "percent" ? "%" : "R$"})<input disabled={form.discountType === "none"} inputMode="decimal" value={form.discountType === "percent" ? String(form.discountValue) : money(form.discountValue)} onChange={(event) => setForm({ ...form, discountValue: form.discountType === "percent" ? parsePercent(event.target.value) : parseCurrency(event.target.value) })} /></label>
          <label>Cobrança<select value={form.billingMode} onChange={(event) => setForm({ ...form, billingMode: event.target.value })}><option value="installments">Parcelado</option><option value="upfront">À vista</option></select></label>
          <label>Parcelas<input type="number" min="1" disabled={form.billingMode === "upfront"} value={form.billingMode === "upfront" ? 1 : form.installmentCount} onChange={(event) => setForm({ ...form, installmentCount: Number(event.target.value) })} /></label>
        </div>
        <div className="combo-modal-actions"><button type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button">Salvar combo</button></div>
      </form></div>}

      {applyCombo && <div className="modal-backdrop"><div className="modal-card combo-modal apply-combo-modal">
        <header className="combo-modal-header"><div><span className="eyebrow">CONTRATAÇÃO</span><h2>Aplicar combo</h2><p>Escolha o aluno e confirme o período de cobertura.</p></div><button type="button" className="combo-modal-close" onClick={() => setApplyCombo(null)}><X size={18} /></button></header>
        <label>Aluno<select value={applyAthlete} onChange={(event) => setApplyAthlete(event.target.value)}><option value="">Selecione o aluno</option>{athletes.filter((athlete) => athlete.active !== false).map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.fullName}</option>)}</select></label>
        <div className="combo-form-grid"><label>Data de início<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Primeiro vencimento<input type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} /></label></div>
        <div className="combo-apply-summary"><span>Combo selecionado</span><strong>{applyCombo.name}</strong><small>{applyCombo.durationMonths} meses · {applyCombo.billingMode === "upfront" ? "1 cobrança" : `${applyCombo.installmentCount} parcelas`}</small><b>{money(applyCombo.finalAmountCents)}</b></div>
        <div className="combo-modal-actions"><button type="button" onClick={() => setApplyCombo(null)}>Cancelar</button><button className="primary-button" disabled={applying || !applyAthlete || !startDate || !firstDueDate} onClick={() => void confirmApply()}>{applying ? "Aplicando..." : "Confirmar combo"}</button></div>
      </div></div>}
    </div>
  );
}
