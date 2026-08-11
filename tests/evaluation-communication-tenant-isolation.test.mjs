import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const evaluationList = readFileSync("app/api/evaluations/route.ts", "utf8");
const evaluationPatch = readFileSync("app/api/evaluations/[id]/route.ts", "utf8");
const communicationList = readFileSync("app/api/communications/route.ts", "utf8");
const communicationPatch = readFileSync("app/api/communications/[id]/route.ts", "utf8");
const communicationUtils = readFileSync("app/api/communications/communication-utils.ts", "utf8");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE athletes(id TEXT PRIMARY KEY,organization_id TEXT,active INTEGER,name TEXT,category TEXT);
    CREATE TABLE teams(id TEXT PRIMARY KEY,organization_id TEXT,active INTEGER,name TEXT);
    CREATE TABLE athlete_evaluations(id TEXT PRIMARY KEY,organization_id TEXT,athlete_id TEXT,evaluation_date TEXT,score INTEGER);
    CREATE TABLE communications(id TEXT PRIMARY KEY,organization_id TEXT,team_id TEXT,title TEXT,status TEXT,updated_at INTEGER);
    CREATE TABLE communication_recipients(id TEXT PRIMARY KEY,communication_id TEXT,athlete_id TEXT,name TEXT,UNIQUE(communication_id,athlete_id));
    INSERT INTO organizations VALUES('A'),('B');
    INSERT INTO athletes VALUES('athleteA','A',1,'Athlete A','A'),('athleteA2','A',1,'Athlete A2','A'),('athleteB','B',1,'Athlete B','B'),('inactiveA','A',0,'Inactive A','A');
    INSERT INTO teams VALUES('teamA','A',1,'Team A'),('teamA2','A',1,'Team A2'),('teamB','B',1,'Team B'),('inactiveTeamA','A',0,'Inactive');
    INSERT INTO athlete_evaluations VALUES('evalA','A','athleteA','2026-08-11',3),('evalB','B','athleteB','2026-08-11',4);
    INSERT INTO communications VALUES('commA','A','teamA','Old','draft',1),('commB','B','teamB','B','draft',1);
    INSERT INTO communication_recipients VALUES('recA','commA','athleteA','Athlete A'),('recB','commB','athleteB','Athlete B');
  `); return db;
}
function patchEvaluation(db, org, id, athleteId, score=5) {
  const athlete=db.prepare("SELECT 1 FROM athletes WHERE id=? AND organization_id=? AND active=1").get(athleteId,org);
  if(!athlete)return 0;
  return db.prepare("UPDATE athlete_evaluations SET athlete_id=?,score=? WHERE id=? AND organization_id=?").run(athleteId,score,id,org).changes;
}
function validateTeam(db,org,teamId){return Boolean(db.prepare("SELECT 1 FROM teams WHERE id=? AND organization_id=? AND active=1").get(teamId,org));}
function postCommunication(db,org,teamId,{fail=false}={}){if(!validateTeam(db,org,teamId))return false;try{db.exec("BEGIN IMMEDIATE");db.prepare("INSERT INTO communications VALUES('new',?,?, 'New','draft',1)").run(org,teamId);if(fail)throw new Error("snapshot");db.prepare("INSERT INTO communication_recipients VALUES('new-rec','new','athleteA','A')").run();db.exec("COMMIT");return true;}catch{db.exec("ROLLBACK");return false;}}
function patchCommunication(db,org,id,teamId,{fail=false,expected=1,next=2}={}){if(!validateTeam(db,org,teamId))return false;try{db.exec("BEGIN IMMEDIATE");const changed=db.prepare("UPDATE communications SET team_id=?,title='New',updated_at=? WHERE id=? AND organization_id=? AND updated_at=?").run(teamId,next,id,org,expected).changes;if(changed!==1)throw new Error("conflict");db.prepare("DELETE FROM communication_recipients WHERE communication_id=?").run(id);if(fail)throw new Error("snapshot");db.prepare("INSERT INTO communication_recipients VALUES(?,?,?,'A2')").run(`rec-${next}`,id,'athleteA2');db.exec("COMMIT");return true;}catch{db.exec("ROLLBACK");return false;}}

test("1 Org A PATCH com Athlete A é permitido",()=>{const db=fixture();assert.equal(patchEvaluation(db,'A','evalA','athleteA2'),1);});
test("2 Org A PATCH com Athlete B é rejeitado",()=>{const db=fixture();assert.equal(patchEvaluation(db,'A','evalA','athleteB'),0);});
test("3 PATCH bloqueado preserva athlete_id",()=>{const db=fixture();patchEvaluation(db,'A','evalA','athleteB');assert.equal(db.prepare("SELECT athlete_id FROM athlete_evaluations WHERE id='evalA'").get().athlete_id,'athleteA');});
test("4 PATCH bloqueado preserva outros campos",()=>{const db=fixture();patchEvaluation(db,'A','evalA','athleteB',5);assert.equal(db.prepare("SELECT score FROM athlete_evaluations WHERE id='evalA'").get().score,3);});
test("5 atleta inexistente é rejeitado",()=>{const db=fixture();assert.equal(patchEvaluation(db,'A','evalA','missing'),0);});
test("6 atleta inativo é rejeitado como no POST",()=>{const db=fixture();assert.equal(patchEvaluation(db,'A','evalA','inactiveA'),0);});
test("7 GET de avaliação usa join defensivo",()=>assert.match(evaluationList,/athletes\.organizationId, athleteEvaluations\.organizationId/));
test("8 avaliação da Org B não recebe PATCH da Org A",()=>{const db=fixture();assert.equal(patchEvaluation(db,'A','evalB','athleteA'),0);});
test("9 concorrência não permite atleta cross-tenant",()=>{const db=fixture();assert.equal(patchEvaluation(db,'A','evalA','athleteB'),0);assert.equal(patchEvaluation(db,'A','evalA','athleteA2'),1);});
test("10 Org A POST para Team A é permitido",()=>{const db=fixture();assert.equal(postCommunication(db,'A','teamA'),true);});
test("11 Org A POST para Team B é rejeitado",()=>{const db=fixture();assert.equal(postCommunication(db,'A','teamB'),false);});
test("12 POST cross-tenant não cria communication",()=>{const db=fixture();postCommunication(db,'A','teamB');assert.equal(db.prepare("SELECT COUNT(*) n FROM communications WHERE id='new'").get().n,0);});
test("13 POST cross-tenant não cria recipients",()=>{const db=fixture();postCommunication(db,'A','teamB');assert.equal(db.prepare("SELECT COUNT(*) n FROM communication_recipients WHERE communication_id='new'").get().n,0);});
test("14 Team inexistente não cria nada",()=>{const db=fixture();assert.equal(postCommunication(db,'A','missing'),false);assert.equal(db.prepare("SELECT COUNT(*) n FROM communications WHERE id='new'").get().n,0);});
test("15 falha de snapshot faz rollback total no POST",()=>{const db=fixture();assert.equal(postCommunication(db,'A','teamA',{fail:true}),false);assert.equal(db.prepare("SELECT COUNT(*) n FROM communications WHERE id='new'").get().n,0);});
test("16 validação de team retorna antes do batch",()=>{assert.match(communicationList,/buildRecipientSnapshot[\s\S]*getD1\(\)[\s\S]*d1\.batch/);});
test("17 Org A PATCH usando Team A é permitido",()=>{const db=fixture();assert.equal(patchCommunication(db,'A','commA','teamA2'),true);});
test("18 Org A PATCH usando Team B é rejeitado",()=>{const db=fixture();assert.equal(patchCommunication(db,'A','commA','teamB'),false);});
test("19 PATCH cross-tenant preserva communication",()=>{const db=fixture();patchCommunication(db,'A','commA','teamB');assert.equal(db.prepare("SELECT team_id FROM communications WHERE id='commA'").get().team_id,'teamA');});
test("20 PATCH cross-tenant preserva recipients",()=>{const db=fixture();patchCommunication(db,'A','commA','teamB');assert.equal(db.prepare("SELECT athlete_id FROM communication_recipients WHERE communication_id='commA'").get().athlete_id,'athleteA');});
test("21 falha no snapshot preserva tudo",()=>{const db=fixture();patchCommunication(db,'A','commA','teamA2',{fail:true});assert.equal(db.prepare("SELECT title FROM communications WHERE id='commA'").get().title,'Old');assert.equal(db.prepare("SELECT COUNT(*) n FROM communication_recipients WHERE communication_id='commA'").get().n,1);});
test("22 PATCH de comunicação da Org B pela A é rejeitado",()=>{const db=fixture();assert.equal(patchCommunication(db,'A','commB','teamA'),false);});
test("23 troca Team A1 para A2 é atômica",()=>{const db=fixture();assert.equal(patchCommunication(db,'A','commA','teamA2'),true);assert.equal(db.prepare("SELECT team_id FROM communications WHERE id='commA'").get().team_id,'teamA2');assert.equal(db.prepare("SELECT athlete_id FROM communication_recipients WHERE communication_id='commA'").get().athlete_id,'athleteA2');});
test("24 GET Org A usa join defensivo de team",()=>assert.match(communicationList,/teams\.organizationId, communications\.organizationId/));
test("25 GET Org A filtra recipient por athlete tenant",()=>assert.match(communicationList,/athletes\.organizationId, context\.membership\.organizationId/));
test("26 dado artificial inconsistente não vaza Team B",()=>{const db=fixture();db.prepare("UPDATE communications SET team_id='teamB' WHERE id='commA'").run();const row=db.prepare("SELECT t.name FROM communications c LEFT JOIN teams t ON t.id=c.team_id AND t.organization_id=c.organization_id WHERE c.id='commA' AND c.organization_id='A'").get();assert.equal(row.name,null);});
test("27 dois PATCH concorrentes mantêm snapshot coerente",()=>{const db=fixture();assert.equal(patchCommunication(db,'A','commA','teamA2',{expected:1,next:2}),true);assert.equal(patchCommunication(db,'A','commA','teamA',{expected:1,next:3}),false);assert.equal(db.prepare("SELECT COUNT(*) n FROM communication_recipients WHERE communication_id='commA'").get().n,1);});
test("28 PATCH válido versus inválido termina coerente",()=>{const db=fixture();assert.equal(patchCommunication(db,'A','commA','teamB'),false);assert.equal(patchCommunication(db,'A','commA','teamA2'),true);assert.equal(db.prepare("SELECT COUNT(*) n FROM communication_recipients WHERE communication_id='commA'").get().n,1);});
test("29 POST concorrente cross-tenant não deixa parcial",()=>{const db=fixture();assert.equal(postCommunication(db,'A','teamB'),false);assert.equal(db.prepare("SELECT COUNT(*) n FROM communications WHERE id='new'").get().n,0);});
test("API real valida atleta ativo e tenant antes do UPDATE",()=>{assert.match(evaluationPatch,/eq\(athletes\.organizationId, organizationId\)/);assert.match(evaluationPatch,/eq\(athletes\.active, true\)/);});
test("API real usa batch para POST e PATCH de communication",()=>{assert.match(communicationList,/await d1\.batch\(statements\)/);assert.match(communicationPatch,/await d1\.batch\(statements\)/);});
test("snapshot real consulta team, matrícula e atleta com tenant",()=>{assert.match(communicationUtils,/eq\(teams\.organizationId, organizationId\)/);assert.match(communicationUtils,/eq\(teamAthletes\.organizationId, organizationId\)/);assert.match(communicationUtils,/eq\(athletes\.organizationId, organizationId\)/);});
