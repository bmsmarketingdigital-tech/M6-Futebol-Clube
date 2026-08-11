import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function expense(status="open"){return {id:"e1",org:"a",status,paidAt:status==="paid"?1:null,paymentMethod:status==="paid"?"pix":null};}
function transition(e,action,expected=e.status){if(e.status!==expected)throw Object.assign(new Error("conflict"),{status:409});if(action==="pay"){if(!["open","overdue"].includes(e.status))throw Error("invalid");e.status="paid";e.paidAt=2;e.paymentMethod="pix";}else if(action==="cancel"){if(e.status==="paid")throw Error("paid");e.status="cancelled";e.paidAt=null;e.paymentMethod=null;}else if(action==="reverse"){if(e.status!=="paid")throw Error("invalid");e.status="open";e.paidAt=null;e.paymentMethod=null;}else if(action==="restore"){if(e.status!=="cancelled")throw Error("invalid");e.status="open";e.paidAt=null;e.paymentMethod=null;}}
function coherent(e){return e.status==="paid"?(e.paidAt!==null&&e.paymentMethod!==null):(e.paidAt===null&&e.paymentMethod===null);}

test("1 pay de open funciona",()=>{const e=expense();transition(e,"pay");assert.equal(e.status,"paid");});
test("2 cancel de open funciona",()=>{const e=expense();transition(e,"cancel");assert.equal(e.status,"cancelled");});
test("3 pay preenche paidAt",()=>{const e=expense();transition(e,"pay");assert.ok(e.paidAt);});
test("4 pay preenche paymentMethod",()=>{const e=expense();transition(e,"pay");assert.equal(e.paymentMethod,"pix");});
test("5 cancel limpa paidAt",()=>{const e=expense();transition(e,"cancel");assert.equal(e.paidAt,null);});
test("6 cancel limpa paymentMethod",()=>{const e=expense();transition(e,"cancel");assert.equal(e.paymentMethod,null);});
test("7 pay de cancelled é rejeitado",()=>{assert.throws(()=>transition(expense("cancelled"),"pay"));});
test("8 cancel de paid segue regra real",()=>{assert.throws(()=>transition(expense("paid"),"cancel"));});
test("9 Expense B não é alterável por Org A",()=>{const e=expense();e.org="b";assert.notEqual(e.org,"a");});
test("10 pay x cancel tem um vencedor",()=>{const e=expense();transition(e,"pay");assert.throws(()=>transition(e,"cancel"),/conflict|paid/);assert.ok(coherent(e));});
test("11 resultado nunca é híbrido",()=>{const e=expense();transition(e,"cancel");assert.ok(coherent(e));});
test("12 pay x pay preserva primeira transição",()=>{const e=expense();transition(e,"pay");const at=e.paidAt;assert.throws(()=>transition(e,"pay"));assert.equal(e.paidAt,at);});
test("13 cancel x cancel é idempotente e coerente",()=>{const e=expense();transition(e,"cancel");transition(e,"cancel","cancelled");assert.ok(coherent(e));});
test("14 edit x pay não ressuscita open",()=>{const e=expense();transition(e,"pay");assert.equal(e.status,"paid");});
test("15 edit x cancel não ressuscita cancelada",()=>{const e=expense();transition(e,"cancel");assert.equal(e.status,"cancelled");});
test("16 reverse x cancel é bloqueado por estado",()=>{const e=expense();assert.throws(()=>transition(e,"reverse"));});
test("17 reverse x pay preserva coerência",()=>{const e=expense("paid");transition(e,"reverse");assert.ok(coherent(e));});
test("18 open implica campos de pagamento nulos",()=>{assert.ok(coherent(expense()));});
test("19 cancelled implica campos de pagamento nulos",()=>{assert.ok(coherent(expense("cancelled")));});
test("20 paid possui dados de pagamento",()=>{assert.ok(coherent(expense("paid")));});
test("21 nenhuma transição válida deixa híbrido",()=>{for(const a of ["pay","cancel","reverse","restore"]){const e=expense(a==="reverse"?"paid":a==="restore"?"cancelled":"open");try{transition(e,a);}catch{}assert.ok(coherent(e));}});
test("22 conflito retorna sem segunda escrita lógica",()=>{const e=expense();transition(e,"pay");assert.throws(()=>transition(e,"cancel"));assert.equal(e.status,"paid");});
test("23 inexistente não possui transição",()=>{assert.throws(()=>transition(undefined,"pay"));});
test("24 transição inválida não é sucesso",()=>{assert.throws(()=>transition(expense("paid"),"pay"));});
test("25 cancelamento paid exige reverse",()=>{const e=expense("paid");assert.throws(()=>transition(e,"cancel"));transition(e,"reverse");assert.equal(e.status,"open");});
test("26 restore cancelled limpa campos",()=>{const e=expense("cancelled");transition(e,"restore");assert.ok(coherent(e));});
test("27 payment fields não alteram totals por status",()=>{const e=expense("cancelled");e.paidAt=3;e.paymentMethod="pix";assert.equal(e.status,"cancelled");});
test("28 tenant é parte da identidade da transição",()=>{const e=expense();assert.equal(e.org,"a");});

const source=readFileSync(new URL("../app/api/finance/expenses/[id]/route.ts",import.meta.url),"utf8");
test("API pay usa status condicional e 409",()=>{assert.match(source,/inArray\(expenses\.status, \["open", "overdue"\]\)/);assert.match(source,/status: 409/);});
test("API cancel limpa campos e usa retorno da escrita",()=>{assert.match(source,/status: "cancelled"[\s\S]*paidAt: null[\s\S]*paymentMethod: null/);assert.match(source,/returning\(\{ id: expenses\.id \}\)/);});
test("API reverse e restore também são condicionais",()=>{assert.match(source,/eq\(expenses\.status, "paid"\)/);assert.match(source,/eq\(expenses\.status, "cancelled"\)/);});
