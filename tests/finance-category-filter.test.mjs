import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/FinanceManagement.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("conexão financeira usa ícone compacto no canto superior", () => {
  assert.match(source, /className=\{`billing-connection-icon/);
  assert.match(source, /<Wifi size=\{19\}/);
  assert.doesNotMatch(source, />\s*Conexão\s*<\/button>/);
  assert.match(styles, /\.billing-connection-icon \{[\s\S]*position: absolute;[\s\S]*top: 0;[\s\S]*right: 0;/);
});

test("filtro financeiro aplica categoria além de situação e busca", () => {
  assert.match(source, /chargeCategoryFilter !== "all" && chargeCategory !== chargeCategoryFilter/);
  assert.match(source, /\[data\.charges, chargeCategoryFilter, chargeQuery, chargeStatusFilter\]/);
  assert.match(source, /className="athlete-category-filter finance-category-filter-trigger"/);
});

test("modal de categorias permite pesquisar e informa mensalidades vencidas", () => {
  assert.match(source, /function ChargeCategoryFilterModal/);
  assert.match(source, /placeholder="Pesquisar categoria\.\.\."/);
  assert.match(source, /charge\.status === "overdue"/);
  assert.match(source, /\{item\.overdue\} vencida\(s\)/);
  assert.match(source, /role="radiogroup"/);
});

test("filtros de situação e categoria ocupam duas colunas no mobile", () => {
  assert.match(styles, /\.finance-page \.finance-charges-toolbar \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.finance-page \.finance-charges-toolbar \.athlete-search-wrap \{ grid-column: 1 \/ -1; \}/);
});
