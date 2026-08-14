import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { filterAthletesForQuery } from "../app/combo-athlete-search.ts";

// A prova de que a filtragem em si funciona (BRU -> só Bruno, CATA -> só
// Catarina, JO -> Jose+Joao, XYZ -> [], "" -> todos, sequência de
// digitação sem atraso, elegibilidade por active) está em
// tests/combo-athlete-search.test.mjs, importando e executando a MESMA
// função (../app/combo-athlete-search.ts) que app/CombosManagement.tsx usa
// para desenhar o dropdown — não uma cópia.
//
// Este arquivo cobre o que aquele não cobre: que o componente realmente
// usa esse resultado (seleção mantém o athlete.id certo, confirmApply
// intocado, a11y/teclado, clique fora, nenhum <select> residual).

const athletes = [
  { id: "a1", name: "Catarina Oliveira", active: true },
  { id: "a2", name: "Catarina Silva", active: true },
  { id: "a3", name: "João Pedro", active: true },
];

test("selecionar um item mantém o athlete.id correto para envio (não o nome)", () => {
  const results = filterAthletesForQuery(athletes, "catarina silva");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "a2");
});

// ------------------------------------------------------------------
// Fonte real
// ------------------------------------------------------------------
const source = readFileSync(new URL("../app/CombosManagement.tsx", import.meta.url), "utf8");

test("fonte real: existe um único campo de combobox para o aluno (sem select separado)", () => {
  assert.match(source, /combo-athlete-combobox/);
  assert.doesNotMatch(source, /<select value=\{applyAthlete\}/);
});

test("fonte real: o dropdown desenha exatamente athleteMatches, nunca eligibleAthletes/athletes direto", () => {
  assert.match(source, /athleteMatches\.map\(\(athlete, index\) => \(/);
  assert.doesNotMatch(source, /eligibleAthletes\.map\(/);
  assert.doesNotMatch(source, /\bathletes\.map\(\(athlete/);
});

test("fonte real: athleteMatches vem da função pura importada de combo-athlete-search.ts", () => {
  assert.match(source, /import \{ filterAthletesForQuery, getEligibleAthletes \} from "\.\/combo-athlete-search"/);
  assert.match(
    source,
    /const athleteMatches = useMemo\(\s*\n\s*\(\) => filterAthletesForQuery\(athletes, athleteQuery\),\s*\n\s*\[athletes, athleteQuery\],\s*\n\s*\);/,
  );
});

test("fonte real: regra de elegibilidade (getEligibleAthletes) preservada, nenhuma reimplementação local do filtro", () => {
  assert.match(source, /getEligibleAthletes\(athletes\)/);
  assert.doesNotMatch(source, /function normalizeForSearch/);
});

test("fonte real: seleção grava athlete\\.id em applyAthlete", () => {
  assert.match(source, /setApplyAthlete\(athlete\.id\)/);
});

test("fonte real: mensagem de nenhum resultado presente", () => {
  assert.match(source, /Nenhum aluno encontrado/);
});

test("fonte real: confirmApply não foi alterado (continua lendo applyAthlete como string simples)", () => {
  assert.match(
    source,
    /async function confirmApply\(\) \{\s*\n\s*if \(!applyCombo \|\| !applyAthlete \|\| !startDate \|\| !firstDueDate\) return;/,
  );
  assert.match(source, /body: JSON\.stringify\(\{ comboId: applyCombo\.id, athleteId: applyAthlete, startDate, firstDueDate \}\)/);
});

test("fonte real: semântica de combobox/listbox presente", () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-expanded=\{athleteDropdownOpen\}/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /aria-activedescendant=/);
});

test("fonte real: suporte a teclado (setas, Enter, Escape)", () => {
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /"Enter"/);
  assert.match(source, /"Escape"/);
});

test("fonte real: highlight é clampado à lista filtrada atual no próprio render (sem setState em effect)", () => {
  assert.match(
    source,
    /const safeAthleteHighlight =\s*\n\s*athleteMatches\.length === 0 \? 0 : Math\.min\(athleteHighlight, athleteMatches\.length - 1\);/,
  );
});

test("fonte real: fechamento por clique fora não descarta seleção confirmada", () => {
  assert.match(source, /handlePointerDown/);
  const effectMatch = source.match(
    /useEffect\(\(\) => \{\s*\n\s*if \(!athleteDropdownOpen\) return;[\s\S]*?\n {2}\}, \[athleteDropdownOpen\]\);/,
  );
  assert.ok(effectMatch, "click-outside effect not found");
  assert.doesNotMatch(effectMatch[0], /setApplyAthlete/);
});

test("fonte real: nenhuma referência a lógica financeira/backend de combos foi tocada nesta feature", () => {
  assert.doesNotMatch(source, /athlete_combos|coverage|reservation|asaas|whatsapp/i);
});
