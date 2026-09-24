import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createPrismaClient } from "../../packages/database/src/client.js";
import { createPrismaForecastRepository, createProviderRoutingRepository } from "../../packages/database/src/index.js";
import { ForecastOrchestrator, currentForecastConfigHash } from "../../packages/domain/src/index.js";
import { startReplayWorker } from "../../workers/data-sync/src/main.js";
import { createProductionEnrichmentExecutor } from "../../workers/data-sync/src/jobs/enrichment.js";
import { resolveCandidateExternalMapping } from "../../workers/data-sync/src/jobs/fixtures.js";
import { createMappedProviderCandidates, executeDurableMappedRoute, resolveEndpointCandidateMappings } from "../../workers/data-sync/src/ingestion/provider-route-runtime.js";
import { ApiFootballClient } from "../../packages/football-data/src/index.js";

export const PROVIDER_API_ORIGIN = "http://127.0.0.1:3241";
export const PROVIDER_WEB_ORIGIN = "http://127.0.0.1:3240";
const OPERATOR_TEST_ENV = { OPERATOR_CREDENTIAL: "phase-06-operator-credential", OPERATOR_PROXY_SIGNING_SECRET: "phase-06-operations-signing-secret-32-bytes", OPERATOR_AUTHORIZED_SUBJECTS: "release-operator" } as const;
const PRIVACY_TEST_ENV = { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_SUBJECT_SIGNING_SECRET: "phase-06-privacy-signing-secret-32-bytes", PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_POLICY_VERSION: "privacy-test-v1", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-09-01T00:00:00.000Z" } as const;
type Runtime = { pg: string; redis: string; api?: ChildProcess; web?: ChildProcess; supervision?: ReturnType<typeof superviseLiveChildren>; worker?: ReturnType<typeof startReplayWorker>; databaseUrl: string; redisUrl: string };
let owned: Runtime | null = null;
const diagnosticTails = new WeakMap<object, string>();
export const LIVE_FIXTURES = {
  fallback: "live-fallback-fixture",
  limited: "live-limited-fixture",
  comparison: "live-comparison-fixture",
} as const;
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function wait(url: string) { for (let i=0;i<120;i++){ try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r=>setTimeout(r,500)); } throw new Error(`SERVICE_NOT_READY:${url}`); }
async function stop(child?: ChildProcess) { if (!child?.pid || child.exitCode !== null) return; const closed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose())); try { execFileSync("taskkill", ["/pid",String(child.pid),"/T","/F"], { stdio:"ignore" }); } catch {} await Promise.race([closed,new Promise<void>((resolveTimeout)=>setTimeout(resolveTimeout,5_000))]); }
function observe(child: ChildProcess, label: string) { for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => { const safe=String(chunk).replace(/postgresql:\/\/[^\s]+/g,"[REDACTED_DATABASE_URL]").replace(/deterministic/g,"[REDACTED]"); diagnosticTails.set(child, `${diagnosticTails.get(child) ?? ""}${safe}`.slice(-4_000)); process.stderr.write(`[${label}] ${safe}`); }); return child; }
export function superviseLiveChildren(children: Array<{label:string;child: Pick<ChildProcess,"pid"|"once"|"off">;diagnostic?:()=>string}>, terminate: (child:any)=>Promise<void> = stop) {
  let disposed=false;
  let rejectFailure!: (error: Error)=>void;
  const failure=new Promise<never>((_,reject)=>{rejectFailure=reject;});
  const listeners=children.map(({label,child})=>{
    const listener=(code:number|null,signal:NodeJS.Signals|null)=>{if(disposed)return;disposed=true;void Promise.all(children.filter((entry)=>entry.child!==child).map((entry)=>terminate(entry.child))).then(()=>{const detail=(children.find((entry)=>entry.child===child)?.diagnostic?.() ?? diagnosticTails.get(child as object) ?? "").trim();rejectFailure(new Error(`LIVE_CHILD_FAILED:${label}:exit=${code ?? signal ?? "unknown"}${detail ? `:cause=${detail}` : ""}`));});};
    child.once("exit",listener);
    return {child,listener};
  });
  return {failure,dispose(){disposed=true;for(const {child,listener} of listeners)child.off("exit",listener);}};
}
export function runSupervisedLiveOwner<T>(supervision: ReturnType<typeof superviseLiveChildren>, owner: () => Promise<T>): Promise<T> {
  return Promise.race([Promise.resolve().then(owner), supervision.failure]);
}
export async function startLiveProviderStack() {
  const suffix = `${process.pid}-${Date.now()}`, pg=`bet-stats-p5-pg-${suffix}`, redis=`bet-stats-p5-redis-${suffix}`;
  try {
    docker("run","-d","--name",pg,"-e","POSTGRES_PASSWORD=postgres","-e","POSTGRES_DB=bet_stats","-p","127.0.0.1::5432","postgres:18-alpine");
    docker("run","-d","--name",redis,"-p","127.0.0.1::6379","redis:8-alpine");
    for(let i=0;i<60;i++){try{docker("exec",pg,"pg_isready","-U","postgres","-d","bet_stats");break}catch{await new Promise(r=>setTimeout(r,500));}}
    const databaseUrl=`postgresql://postgres:postgres@127.0.0.1:${docker("port",pg,"5432/tcp").split(":").at(-1)}/bet_stats`, redisUrl=`redis://127.0.0.1:${docker("port",redis,"6379/tcp").split(":").at(-1)}`;
    execFileSync(process.execPath,[resolve("packages/database/node_modules/prisma/build/index.js"),"migrate","deploy"],{cwd:resolve("packages/database"),env:{...process.env,DATABASE_URL:databaseUrl},stdio:"pipe"});
    const db=createPrismaClient(databaseUrl);
    for(const [id,name,fd,api] of [["pl","Premier League","PL","39"],["uel","Europa League",null,"78"],["uecl","Conference League",null,"848"]] as const){const leagueId=`live-${id}`,seasonId=`live-${id}-2026`;await db.league.create({data:{id:leagueId,name,countryCode:"EU"}});await db.season.create({data:{id:seasonId,leagueId,label:"2026",startsOn:new Date("2026-01-01"),endsOn:new Date("2026-12-31")}});if(fd){await db.leagueExternalRef.create({data:{leagueId,provider:"football-data.org",externalId:fd}});await db.seasonExternalRef.create({data:{seasonId,leagueId,provider:"football-data.org",externalId:"2026"}});}await db.leagueExternalRef.create({data:{leagueId,provider:"api-football",externalId:api}});await db.seasonExternalRef.create({data:{seasonId,leagueId,provider:"api-football",externalId:"2026"}});}
    const productionCounts=await seedAcceptanceData(db);
    await db.$disconnect();
    const deterministic:any={"football-data.org":()=>({}),"api-football":()=>({fetchEnrichment:async()=>({state:"observed-empty",payload:null})})};
    const worker=startReplayWorker({databaseUrl,redisUrl,footballDataApiToken:"deterministic",apiFootballApiKey:"deterministic",providerFactories:deterministic,prefix:`p5-${suffix}`}); await worker.waitUntilReady();
    const run=(args:string[],env:NodeJS.ProcessEnv)=>spawn("cmd.exe",["/d","/s","/c","corepack",...args],{cwd:process.cwd(),env:{...process.env,...env},stdio:["ignore","pipe","pipe"],windowsHide:true});
    execFileSync("cmd.exe",["/d","/s","/c","corepack","pnpm","--filter","@bet-stats/api...","build"],{cwd:process.cwd(),env:process.env,stdio:"pipe"});
    const api=observe(run(["pnpm","--filter","@bet-stats/api","dev"],{DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,POSTGRES_READY:"true",REDIS_READY:"true",API_HOST:"127.0.0.1",API_PORT:"3241",NODE_ENV:"test",ELIGIBILITY_ALLOWED_REGIONS:"PL",...OPERATOR_TEST_ENV,...PRIVACY_TEST_ENV}),"api"); await wait(`${PROVIDER_API_ORIGIN}/health/ready`);
    execFileSync("cmd.exe",["/d","/s","/c","corepack","pnpm","--filter","@bet-stats/web","build"],{cwd:process.cwd(),env:{...process.env,API_ORIGIN:PROVIDER_API_ORIGIN,...OPERATOR_TEST_ENV,...PRIVACY_TEST_ENV},stdio:"pipe"});
    const web=observe(run(["pnpm","--filter","@bet-stats/web","exec","next","start","--hostname","127.0.0.1","--port","3240"],{API_ORIGIN:PROVIDER_API_ORIGIN,ELIGIBILITY_REGION:"PL",ELIGIBILITY_AGE_ACKNOWLEDGED:"true",ELIGIBILITY_CHECKED_AT:new Date().toISOString(),...OPERATOR_TEST_ENV,...PRIVACY_TEST_ENV}),"web");
    const supervision=superviseLiveChildren([{label:"api",child:api},{label:"web",child:web}]);
    await Promise.race([wait(PROVIDER_WEB_ORIGIN),supervision.failure]);
    void supervision.failure.catch(()=>undefined);
    owned={pg,redis,api,web,supervision,worker,databaseUrl,redisUrl}; return {databaseUrl,redisUrl,workerReady:true,seeded:["PL","39","78","848"],productionCounts,supervision};
  } catch(error){await stopLiveProviderStack({pg,redis});throw error;}
}

async function seedAcceptanceData(db: ReturnType<typeof createPrismaClient>) {
  await db.team.createMany({ data: [
    { id: "live-arsenal", name: "Arsenal", normalizedName: "arsenal", countryCode: "GB" },
    { id: "live-chelsea", name: "Chelsea", normalizedName: "chelsea", countryCode: "GB" },
    { id: "live-roma", name: "Roma", normalizedName: "roma", countryCode: "IT" },
    { id: "live-ajax", name: "Ajax", normalizedName: "ajax", countryCode: "NL" },
  ] });
  await db.fixture.createMany({ data: [
    { id: LIVE_FIXTURES.fallback, leagueId: "live-pl", seasonId: "live-pl-2026", homeTeamId: "live-arsenal", awayTeamId: "live-chelsea", kickoffUtc: new Date("2026-09-20T15:00:00.000Z"), status: "SCHEDULED" },
    { id: LIVE_FIXTURES.comparison, leagueId: "live-pl", seasonId: "live-pl-2026", homeTeamId: "live-chelsea", awayTeamId: "live-arsenal", kickoffUtc: new Date("2026-09-21T15:00:00.000Z"), status: "SCHEDULED" },
    { id: LIVE_FIXTURES.limited, leagueId: "live-uel", seasonId: "live-uel-2026", homeTeamId: "live-roma", awayTeamId: "live-ajax", kickoffUtc: new Date("2026-09-22T18:00:00.000Z"), status: "SCHEDULED" },
  ] });
  await db.fixtureExternalRef.create({ data: { fixtureId: LIVE_FIXTURES.comparison, provider: "api-football", externalId: "1379123" } });
  await exerciseProductionRouting(db);
  await db.providerCapability.create({ data: { provider: "api-football", leagueId: "live-pl", seasonId: "live-pl-2026", endpoint: "LINEUPS", supported: true, verifiedAt: new Date("2026-09-20T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z") } });
  await db.providerCircuitState.create({ data: { provider: "api-football", endpointFamily: "LINEUPS", state: "CLOSED" } });
  const lineupEnvelope = { get: "lineups", parameters: { fixture: "1379123" }, errors: [], results: 2, paging: { current: 1, total: 1 }, response: [42,49].map((teamId) => ({ team: { id: teamId, name: `Team ${teamId}`, logo: null, colors: null }, formation: "4-3-3", coach: { id: teamId + 100, name: `Coach ${teamId}`, photo: null }, startXI: Array.from({length:11},(_,index)=>({player:{id:teamId*100+index,name:`Player ${teamId}-${index}`,number:index+1,pos:"M",grid:"1:1"}})), substitutes: [] })) };
  const enrichment = createProductionEnrichmentExecutor({ database: db, apiFootballFactory: () => new ApiFootballClient({ apiKey: "stub", now: () => new Date("2026-09-21T14:00:00.000Z"), fetcher: async () => new Response(JSON.stringify(lineupEnvelope)) }) });
  const enrichmentResult = await enrichment({ fixtureId: LIVE_FIXTURES.comparison, endpoint: "LINEUPS", cutoff: "2026-09-21T14:05:00.000Z", policyVersion: "enrichment-v1" });
  if (enrichmentResult.status !== "completed" || enrichmentResult.evidenceState !== "OBSERVED") throw new Error("PRODUCTION_ENRICHMENT_NOT_COMPLETED");
  const lineup = await db.lineupObservation.findFirstOrThrow({ where: { fixtureId: LIVE_FIXTURES.comparison, status: "OFFICIAL_CONFIRMED" } });
  await issueProductionForecasts(db, lineup.id);
  return {
    enrichmentDecisions: await db.enrichmentDecisionReceipt.count(),
    lineupObservations: await db.lineupObservation.count(),
    sourceObservations: await db.sourceObservation.count({ where: { endpointFamily: "LINEUPS" } }),
    routeReceipts: await db.providerRouteReceipt.count(),
    routeAttempts: await db.providerRouteAttempt.count(),
    forecastSnapshots: await db.forecastSnapshot.count({ where: { fixtureId: LIVE_FIXTURES.comparison } }),
  };
}

async function exerciseProductionRouting(db: ReturnType<typeof createPrismaClient>) {
  const expiresAt = new Date("2027-01-01T00:00:00.000Z");
  await db.providerCapability.createMany({ data: [
    { provider: "football-data.org", leagueId: "live-pl", seasonId: "live-pl-2026", endpoint: "FIXTURES", supported: true, verifiedAt: new Date(), expiresAt },
    { provider: "api-football", leagueId: "live-pl", seasonId: "live-pl-2026", endpoint: "FIXTURES", supported: true, verifiedAt: new Date(), expiresAt },
    { provider: "api-football", leagueId: "live-uel", seasonId: "live-uel-2026", endpoint: "FIXTURES", supported: true, verifiedAt: new Date(), expiresAt },
  ] });
  await db.providerCircuitState.createMany({ data: [
    { provider: "football-data.org", endpointFamily: "FIXTURES", state: "CLOSED" },
    { provider: "api-football", endpointFamily: "FIXTURES", state: "CLOSED" },
  ] });
  const repository = createProviderRoutingRepository({ database: db });
  const execute = async (scope: { competition: string; leagueId: string; seasonId: string; correlationId: string; failPrimary?: boolean; failOnly?: boolean }) => {
    const mapped = await resolveEndpointCandidateMappings({ competition: scope.competition, season: "2026", endpoint: "FIXTURES", leagueId: scope.leagueId, seasonId: scope.seasonId, resolveMapping: (leagueId, seasonId, provider) => resolveCandidateExternalMapping(db, leagueId, seasonId, provider) });
    const failure = () => { throw Object.assign(new Error("PROVIDER_UNAVAILABLE"), { code: "PROVIDER_UNAVAILABLE", classification: "fallback" }); };
    const factories = {
      "football-data.org": () => ({ run: scope.failPrimary ? failure : async () => ({ provider: "football-data.org" }) }),
      "api-football": () => ({ run: scope.failOnly ? failure : async () => ({ provider: "api-football" }) }),
    };
    return executeDurableMappedRoute({ database: db, repository, context: { assertOwner: async () => undefined }, route: mapped.route, candidates: createMappedProviderCandidates(mapped.route, mapped.mappings, factories), leagueId: scope.leagueId, seasonId: scope.seasonId, correlationId: scope.correlationId, attemptKey: scope.correlationId, allowance: 100, criticalHeadroom: 10, lane: "critical", call: async (dispatch) => dispatch.client.run() });
  };
  const fallback = await execute({ competition: "PL", leagueId: "live-pl", seasonId: "live-pl-2026", correlationId: "live-fallback", failPrimary: true });
  const prior = await execute({ competition: "UEL", leagueId: "live-uel", seasonId: "live-uel-2026", correlationId: "live-prior" });
  const limited = await execute({ competition: "UEL", leagueId: "live-uel", seasonId: "live-uel-2026", correlationId: "live-limited", failOnly: true });
  if (fallback.status !== "completed" || fallback.provider !== "api-football" || prior.status !== "completed" || limited.status !== "limited") throw new Error("PRODUCTION_ROUTING_NOT_COMPLETED");
}

async function issueProductionForecasts(db: ReturnType<typeof createPrismaClient>, lineupId: string) {
  const repository = createPrismaForecastRepository(db);
  const orchestrator = new ForecastOrchestrator();
  for (const [kind, cutoff] of [["INITIAL", "2026-09-20T10:00:00.000Z"], ["PRE_MATCH", "2026-09-21T10:00:00.000Z"], ["LINEUP_CONFIRMED", "2026-09-21T14:00:00.000Z"]] as const) {
    const runId = `live-forecast-run-${kind.toLowerCase()}`;
    await db.syncRun.create({ data: { id: runId, logicalKey: runId, revision: 1, provider: "production-evidence", endpointFamily: "RESULTS", lane: "critical", windowFrom: new Date("2026-01-01T00:00:00.000Z"), windowTo: new Date(cutoff), state: "SUCCEEDED", correlationId: runId } });
    const receipt = { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: null, returnedTo: null }, inputs: [] };
    for (const teamId of ["live-arsenal", "live-chelsea"]) {
      const buildId = `${runId}-${teamId}`;
      await db.evidenceBuild.create({ data: { id: buildId, teamId, cutoff: new Date(cutoff), configVersion: "evidence-v1", configHash: `live-evidence-${kind}`, syncRunId: runId, state: "PUBLISHED", publishedAt: new Date(cutoff), components: { create: { component: "receipt", value: receipt, sampleSize: 0, sourceTimes: [] } } } });
    }
    const forecast = await orchestrator.run({ fixtureId: LIVE_FIXTURES.comparison, asOf: cutoff, kind, modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), initiator: { type: "production", correlationId: `live-forecast-${kind.toLowerCase()}` } }, repository);
    if (kind === "LINEUP_CONFIRMED" && forecast.officialLineupObservationId !== lineupId) throw new Error("PRODUCTION_LINEUP_FORECAST_MISMATCH");
  }
}
export async function stopLiveProviderStack(partial?:{pg:string;redis:string}) { const state=owned; if(state){state.supervision?.dispose();await stop(state.web);await stop(state.api);await state.worker?.close();} for(const name of [partial?.redis??state?.redis,partial?.pg??state?.pg])if(name)try{docker("rm","-f",name)}catch{} owned=null; }

export default async function setup() { await startLiveProviderStack(); return async () => stopLiveProviderStack(); }
