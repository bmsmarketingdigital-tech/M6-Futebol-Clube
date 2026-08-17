"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Copy, Power, Plus, UserPlus, WalletCards, X } from "lucide-react";
import { filterAthletesForQuery, getEligibleAthletes } from "./combo-athlete-search";
import { readApiResponse } from "./api-response";

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

type Athlete = { id: string; name: string; active?: boolean };
type ComboContract = {
  id: string;
  athleteName: string;
  comboNameSnapshot: string;
  startDate: string;
  endDate: string;
  status: string;
  finalAmountCents: number;
  installmentCount: number;
  paidInstallments?: number;
  pendingInstallments?: number;
  preservedMonths?: string[];
  releasableMonths?: string[];
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const parseCurrency = (value: string) => Number(value.replace(/\D/g, "")) || 0;
const parsePercent = (value: string) =>
  Math.max(0, Math.min(100, Number(value.replace(/\D/g, "")) || 0));

function comboTypeLabel(type: string) {
  return { monthly: "Mensal", quarterly: "Trimestral", annual: "Anual", custom: "Personalizado" }[type] ?? "Personalizado";
}


export default function CombosManagement({ notify, athletes, onBack }: { notify: (message: string) => void; athletes: Athlete[]; onBack: () => void }) {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [contracts, setContracts] = useState<ComboContract[]>([]);
  const [open, setOpen] = useState(false);
  const [applyCombo, setApplyCombo] = useState<Combo | null>(null);
  const [cancelContract, setCancelContract] = useState<ComboContract | null>(null);
  const [applyAthlete, setApplyAthlete] = useState("");
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteDropdownOpen, setAthleteDropdownOpen] = useState(false);
  const [athleteHighlight, setAthleteHighlight] = useState(0);
  const athleteComboboxRef = useRef<HTMLDivElement | null>(null);
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
    const [comboResponse, contractResponse] = await Promise.all([
      fetch("/api/finance/combos"),
      fetch("/api/finance/combos/contracts"),
    ]);
    const comboPayload = await readApiResponse<{ combos?: Combo[] }>(comboResponse);
    const contractPayload = await readApiResponse<{ contracts?: ComboContract[] }>(contractResponse);
    if (comboResponse.ok) setCombos(comboPayload.combos ?? []);
    if (contractResponse.ok) setContracts(contractPayload.contracts ?? []);
  }

  function validateForm() {
    if (!form.name.trim() || form.durationMonths < 1 || form.baseAmountCents <= 0 || form.installmentCount < 1) return "Informe nome, duracao, valor e parcelas validos.";
    if (form.discountType === "percent" && form.discountValue >= 100) return "Desconto percentual deve ser menor que 100%.";
    if (form.discountType === "fixed" && form.discountValue >= form.baseAmountCents) return "Desconto fixo deve ser menor que o valor do Combo.";
    if (form.discountType !== "none" && form.discountValue < 0) return "Desconto nao pode ser negativo.";
    return "";
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) return notify(validationError);
    const response = await fetch("/api/finance/combos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await readApiResponse<{ combos?: Combo[]; contracts?: ComboContract[] }>(response);
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
    setAthleteQuery("");
    setAthleteDropdownOpen(false);
    setAthleteHighlight(0);
    setStartDate("");
    setFirstDueDate("");
  }

  // Mesma regra de elegibilidade de sempre: apenas alunos ativos.
  // Única fonte de verdade da busca: athleteQuery. Recalculado a cada
  // render via useMemo — nunca filtramos usando um valor "guardado" à
  // parte, para não ficar um caractere atrasado em relação ao input.
  // athleteMatches é o único array que o dropdown pode desenhar — vem
  // sempre da função pura importada de combo-athlete-search.ts, a mesma
  // que os testes executam de verdade (sem duplicar a lógica em teste).
  const eligibleAthletes = useMemo(() => getEligibleAthletes(athletes), [athletes]);
  const athleteMatches = useMemo(
    () => filterAthletesForQuery(athletes, athleteQuery),
    [athletes, athleteQuery],
  );
  const selectedAthleteRecord = useMemo(
    () => eligibleAthletes.find((athlete) => athlete.id === applyAthlete) ?? null,
    [eligibleAthletes, applyAthlete],
  );

  // O índice destacado precisa sempre apontar para dentro da lista filtrada
  // atual — clampado no próprio render (sem efeito) para nunca ficar
  // apontando para um item que já saiu da lista após a query mudar.
  const safeAthleteHighlight =
    athleteMatches.length === 0 ? 0 : Math.min(athleteHighlight, athleteMatches.length - 1);

  function selectAthlete(athlete: Athlete) {
    setApplyAthlete(athlete.id);
    setAthleteQuery(athlete.name);
    setAthleteDropdownOpen(false);
  }

  function clearAthleteSelection() {
    setApplyAthlete("");
    setAthleteQuery("");
    setAthleteHighlight(0);
    setAthleteDropdownOpen(true);
    athleteComboboxRef.current?.querySelector("input")?.focus();
  }

  function handleAthleteQueryChange(value: string) {
    setAthleteQuery(value);
    setApplyAthlete("");
    setAthleteHighlight(0);
    setAthleteDropdownOpen(true);
  }

  function handleAthleteKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!athleteDropdownOpen) { setAthleteDropdownOpen(true); return; }
      setAthleteHighlight((index) => Math.min(index + 1, athleteMatches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAthleteHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (athleteDropdownOpen && athleteMatches[safeAthleteHighlight]) {
        event.preventDefault();
        selectAthlete(athleteMatches[safeAthleteHighlight]);
      }
    } else if (event.key === "Escape") {
      if (athleteDropdownOpen) {
        event.preventDefault();
        setAthleteDropdownOpen(false);
      }
    }
  }

  // Fecha a lista ao clicar fora, sem descartar uma seleção já confirmada.
  useEffect(() => {
    if (!athleteDropdownOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!athleteComboboxRef.current?.contains(event.target as Node)) {
        setAthleteDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [athleteDropdownOpen]);

  async function confirmApply() {
    if (!applyCombo || !applyAthlete || !startDate || !firstDueDate) return;
    setApplying(true);
    const response = await fetch("/api/finance/combos/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comboId: applyCombo.id, athleteId: applyAthlete, startDate, firstDueDate }),
    });
    const payload = await readApiResponse<{ error?: string }>(response);
    setApplying(false);
    if (!response.ok) return notify(payload.error ?? "Não foi possível aplicar o combo.");
    notify("Combo aplicado ao aluno com sucesso.");
    setApplyCombo(null);
    await load();
  }

  async function confirmCancelContract() {
    if (!cancelContract) return;
    const response = await fetch(`/api/finance/combos/contracts/${cancelContract.id}/cancel`, { method: "POST" });
    const payload = await readApiResponse<{ error?: string; releasedMonths?: string[] }>(response);
    if (!response.ok) return notify(payload.error ?? "Nao foi possivel cancelar o contrato.");
    notify(`Contrato cancelado. Competencias liberadas: ${payload.releasedMonths?.length ?? 0}.`);
    setCancelContract(null);
    await load();
  }

  return (
    <div className="finance-page-content combos-page">
      <div className="section-heading section-heading-with-back finance-heading">
        <button type="button" className="section-back-button" onClick={onBack} aria-label="Voltar para o início"><ArrowLeft size={20} strokeWidth={2} /></button>
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

      <section className="combo-contracts-section">
        <div className="section-heading finance-heading compact">
          <div><span className="eyebrow">CONTRATOS</span><h2>Combos aplicados aos alunos</h2><p>Cancelar contrato encerra um Combo de aluno. Desativar modelo apenas bloqueia novas contratacoes.</p></div>
        </div>
        <div className="combo-grid">
          {contracts.map((contract) => (
            <article className="card combo-card" key={contract.id}>
              <div className="combo-card-head">
                <div><span className="eyebrow">{contract.athleteName}</span><h3>{contract.comboNameSnapshot}</h3></div>
                <span className={contract.status === "active" ? "combo-status active" : "combo-status inactive"}>{contract.status === "active" ? "Ativo" : "Cancelado"}</span>
              </div>
              <p className="combo-meta">{contract.startDate} ate {contract.endDate} · {contract.installmentCount} {contract.installmentCount === 1 ? "parcela" : "parcelas"}</p>
              <strong className="combo-price">{money(contract.finalAmountCents)}</strong>
              <div className="combo-card-actions">
                <button className="combo-action danger" disabled={contract.status !== "active"} onClick={() => setCancelContract(contract)}><X size={16} /> Cancelar contrato</button>
              </div>
            </article>
          ))}
        </div>
        {!contracts.length && <div className="card finance-empty"><strong>Nenhum contrato de Combo aplicado</strong><small>Quando um Combo for aplicado a um aluno, ele aparecera aqui.</small></div>}
      </section>

      {open && <div className="modal-backdrop"><form className="modal-card combo-modal" role="dialog" aria-modal="true" aria-labelledby="combo-form-modal-title" onSubmit={save}>
        <header className="combo-modal-header"><div><span className="eyebrow">FINANCEIRO</span><h2 id="combo-form-modal-title">Novo Combo</h2><p>Configure o pacote comercial e as condições de cobrança.</p></div><button type="button" className="combo-modal-close" onClick={() => setOpen(false)} aria-label="Fechar"><X size={18} /></button></header>
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

      {applyCombo && <div className="modal-backdrop"><div className="modal-card combo-modal apply-combo-modal" role="dialog" aria-modal="true" aria-labelledby="combo-apply-modal-title">
        <header className="combo-modal-header"><div><span className="eyebrow">CONTRATAÇÃO</span><h2 id="combo-apply-modal-title">Aplicar combo</h2><p>Escolha o aluno e confirme o período de cobertura.</p></div><button type="button" className="combo-modal-close" onClick={() => setApplyCombo(null)} aria-label="Fechar"><X size={18} /></button></header>
        <label>Aluno
          <div className="combo-athlete-combobox" ref={athleteComboboxRef}>
            <div className="combo-athlete-input-wrap">
              <input
                type="text"
                role="combobox"
                aria-expanded={athleteDropdownOpen}
                aria-controls="combo-athlete-listbox"
                aria-autocomplete="list"
                aria-activedescendant={
                  athleteDropdownOpen && athleteMatches[safeAthleteHighlight]
                    ? `combo-athlete-option-${athleteMatches[safeAthleteHighlight].id}`
                    : undefined
                }
                placeholder="Buscar ou selecionar aluno..."
                value={athleteQuery}
                onChange={(event) => handleAthleteQueryChange(event.target.value)}
                onFocus={() => setAthleteDropdownOpen(true)}
                onKeyDown={handleAthleteKeyDown}
                aria-label="Buscar ou selecionar aluno"
              />
              {athleteQuery ? (
                <button
                  type="button"
                  className="combo-athlete-clear"
                  aria-label="Limpar seleção do aluno"
                  onClick={clearAthleteSelection}
                >
                  <X size={14} />
                </button>
              ) : (
                <ChevronDown size={16} className="combo-athlete-chevron" />
              )}
            </div>
            {athleteDropdownOpen && (
              <ul className="combo-athlete-options" role="listbox" id="combo-athlete-listbox">
                {athleteMatches.length ? (
                  athleteMatches.map((athlete, index) => (
                    <li
                      key={athlete.id}
                      id={`combo-athlete-option-${athlete.id}`}
                      role="option"
                      aria-selected={athlete.id === selectedAthleteRecord?.id}
                      className={index === safeAthleteHighlight ? "highlighted" : ""}
                      onMouseEnter={() => setAthleteHighlight(index)}
                      onMouseDown={(event) => { event.preventDefault(); selectAthlete(athlete); }}
                    >
                      {athlete.name}
                    </li>
                  ))
                ) : (
                  <li className="combo-athlete-empty">Nenhum aluno encontrado</li>
                )}
              </ul>
            )}
          </div>
        </label>
        <div className="combo-form-grid"><label>Data de início<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Primeiro vencimento<input type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} /></label></div>
        <div className="combo-apply-summary"><span>Combo selecionado</span><strong>{applyCombo.name}</strong><small>{applyCombo.durationMonths} meses · {applyCombo.billingMode === "upfront" ? "1 cobrança" : `${applyCombo.installmentCount} parcelas`}</small><b>{money(applyCombo.finalAmountCents)}</b></div>
        <div className="combo-modal-actions"><button type="button" onClick={() => setApplyCombo(null)}>Cancelar</button><button className="primary-button" disabled={applying || !applyAthlete || !startDate || !firstDueDate} onClick={() => void confirmApply()}>{applying ? "Aplicando..." : "Confirmar combo"}</button></div>
      </div></div>}

      {cancelContract && <div className="modal-backdrop"><div className="modal-card combo-modal apply-combo-modal" role="dialog" aria-modal="true" aria-labelledby="combo-cancel-modal-title">
        <header className="combo-modal-header"><div><span className="eyebrow">CANCELAMENTO</span><h2 id="combo-cancel-modal-title">Cancelar contrato de Combo</h2><p>Competencias passadas e a competencia atual permanecem preservadas. Somente competencias futuras elegiveis serao liberadas.</p></div><button type="button" className="combo-modal-close" onClick={() => setCancelContract(null)} aria-label="Fechar"><X size={18} /></button></header>
        <div className="combo-apply-summary"><span>Contrato selecionado</span><strong>{cancelContract.comboNameSnapshot}</strong><small>{cancelContract.athleteName} · {cancelContract.startDate} ate {cancelContract.endDate}</small><b>{money(cancelContract.finalAmountCents)}</b></div>
        <div className="combo-cancel-summary">
          <span>Parcelas pagas: <strong>{cancelContract.paidInstallments ?? 0}</strong></span>
          <span>Parcelas pendentes: <strong>{cancelContract.pendingInstallments ?? 0}</strong></span>
          <span>Competencias preservadas: <strong>{cancelContract.preservedMonths?.join(", ") || "nenhuma"}</strong></span>
          <span>Competencias futuras liberaveis: <strong>{cancelContract.releasableMonths?.join(", ") || "nenhuma"}</strong></span>
        </div>
        <div className="combo-modal-actions"><button type="button" onClick={() => setCancelContract(null)}>Voltar</button><button className="primary-button" onClick={() => void confirmCancelContract()}>Confirmar cancelamento</button></div>
      </div></div>}
    </div>
  );
}
