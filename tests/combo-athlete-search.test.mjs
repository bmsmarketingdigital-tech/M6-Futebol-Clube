import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeForSearch,
  getEligibleAthletes,
  filterAthletesForQuery,
} from "../app/combo-athlete-search.ts";

// Estes testes importam e EXECUTAM a função real usada pelo dropdown do
// combobox de aluno (app/CombosManagement.tsx importa exatamente este
// módulo — não é uma cópia). Isso comprova o resultado real de filtragem,
// não apenas que o código-fonte "contém" um padrão esperado.

const dataset = [
  { id: "r1", name: "Rafael", active: true },
  { id: "j1", name: "Jose", active: true },
  { id: "j2", name: "Joao Silva", active: true },
  { id: "b1", name: "Bruno Martin", active: true },
  { id: "c1", name: "Catarina Martin", active: true },
];

test("BRU retorna exatamente Bruno Martin", () => {
  const result = filterAthletesForQuery(dataset, "BRU");
  assert.deepEqual(result.map((a) => a.name), ["Bruno Martin"]);
});

test("CATA retorna exatamente Catarina Martin", () => {
  const result = filterAthletesForQuery(dataset, "CATA");
  assert.deepEqual(result.map((a) => a.name), ["Catarina Martin"]);
});

test("JO retorna exatamente Jose e Joao Silva, nessa ordem original", () => {
  const result = filterAthletesForQuery(dataset, "JO");
  assert.deepEqual(result.map((a) => a.name), ["Jose", "Joao Silva"]);
});

test("XYZ não retorna ninguém", () => {
  assert.deepEqual(filterAthletesForQuery(dataset, "XYZ"), []);
});

test("query vazia retorna todos os elegíveis, na ordem original", () => {
  const result = filterAthletesForQuery(dataset, "");
  assert.deepEqual(result.map((a) => a.name), [
    "Rafael",
    "Jose",
    "Joao Silva",
    "Bruno Martin",
    "Catarina Martin",
  ]);
});

// Sequência exata de digitação relatada no bug: nunca deve mostrar a lista
// completa depois da primeira letra.
test("sequência B -> BR -> BRU -> BRUN -> BRUNO nunca volta a mostrar Rafael/Jose/Joao/Catarina", () => {
  const steps = ["B", "BR", "BRU", "BRUN", "BRUNO"];
  for (const query of steps) {
    const result = filterAthletesForQuery(dataset, query);
    assert.deepEqual(
      result.map((a) => a.name),
      ["Bruno Martin"],
      `query "${query}" deveria retornar somente Bruno Martin, retornou: ${JSON.stringify(result.map((a) => a.name))}`,
    );
  }
});

test("apagar letras (BRUNO -> BRUN -> BRU -> BR -> B) continua retornando só Bruno Martin", () => {
  for (const query of ["BRUNO", "BRUN", "BRU", "BR", "B"]) {
    assert.deepEqual(filterAthletesForQuery(dataset, query).map((a) => a.name), ["Bruno Martin"]);
  }
});

test("aluno inativo nunca aparece, mesmo com nome compatível", () => {
  const withInactive = [...dataset, { id: "b2", name: "Bruna Souza", active: false }];
  const result = filterAthletesForQuery(withInactive, "BRU");
  assert.deepEqual(result.map((a) => a.name), ["Bruno Martin"]);
});

test("getEligibleAthletes remove inativos e preserva ordem dos ativos", () => {
  const withInactive = [...dataset, { id: "b2", name: "Bruna Souza", active: false }];
  assert.deepEqual(
    getEligibleAthletes(withInactive).map((a) => a.id),
    ["r1", "j1", "j2", "b1", "c1"],
  );
});

test("normalizeForSearch ignora acentos, caixa e espaços extras", () => {
  assert.equal(normalizeForSearch("  João   Pedro  "), "joao pedro");
  assert.equal(normalizeForSearch("CATARINA"), "catarina");
  assert.equal(normalizeForSearch("Bruno Martin").includes(normalizeForSearch("bru")), true);
  assert.equal(normalizeForSearch("Rafael").includes(normalizeForSearch("bru")), false);
});

test("busca não combina letras fora de ordem (BRU não combina com 'Rubens')", () => {
  const result = filterAthletesForQuery([...dataset, { id: "x1", name: "Rubens", active: true }], "BRU");
  assert.deepEqual(result.map((a) => a.name), ["Bruno Martin"]);
});
