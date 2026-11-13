import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("filtros de turmas mantêm três colunas móveis sem labels fixos nem largura mínima", () => {
  assert.match(css, /\.teams-page \.team-toolbar\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.teams-page \.team-toolbar \.athlete-category-filter\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.teams-page \.team-toolbar \.athlete-category-filter > span\s*\{\s*display:\s*none/s);
  assert.match(css, /\.teams-page \.team-toolbar \.athlete-category-filter select\s*\{[^}]*min-width:\s*0/s);
  assert.match(page, /aria-label="Categoria" value=\{teamCategory\}/);
  assert.match(page, /aria-label="Dia" value=\{teamDay\}/);
  assert.match(page, /aria-label="Ordenar" value=\{teamSort\}/);
});
