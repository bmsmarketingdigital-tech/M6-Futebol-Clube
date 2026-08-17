import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const licenseSource = readFileSync(new URL("../app/LicenseWidget.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("cadastro móvel oferece retorno explícito para o início", () => {
  assert.match(pageSource, /className="section-heading section-heading-with-back"/);
  assert.match(pageSource, /className="section-back-button"[\s\S]*aria-label="Voltar para o início"/);
  assert.match(pageSource, /onBack=\{\(\) => setSection\("Visão geral"\)\}/);
});

test("licença e ações cabem juntas no cabeçalho móvel", () => {
  assert.match(licenseSource, /className="license-badge-label"/);
  assert.match(stylesSource, /\.top-actions > \.license-badge \{[\s\S]*max-width: 86px;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.top-actions \{[\s\S]*flex: 0 0 auto;[\s\S]*gap: 6px;/);
  assert.match(stylesSource, /\.search \{[\s\S]*min-width: 0;/);
});

test("botão de novo atleta centraliza o ícone", () => {
  assert.match(pageSource, /<Plus size=\{16\} strokeWidth=\{2\} \/> <span>\{actionLabel\}<\/span>/);
  assert.match(stylesSource, /\.section-heading > \.primary-button svg \{[\s\S]*top: 50%;[\s\S]*left: 50%;[\s\S]*transform: translate\(-50%, -50%\);/);
  assert.match(stylesSource, /\.section-heading > \.primary-button > span \{ display: none; \}/);
});

test("filtro de categoria respeita a largura do card móvel", () => {
  assert.match(stylesSource, /\.app-shell \.page-content \.athlete-list-toolbar \.athlete-category-filter \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.app-shell \.page-content \.athlete-list-toolbar \.athlete-category-filter select \{[\s\S]*min-width: 0;[\s\S]*max-width: 46px;/);
});

test("lista móvel remove o limite desktop e mostra todos os atletas", () => {
  assert.match(stylesSource, /\.athletes-page \.athlete-table\.expanded,[\s\S]*max-height: none;[\s\S]*overflow: visible;/);
});
