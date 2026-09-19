import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createPrismaClient } from "../../packages/database/src/client.js";
import { startReplayWorker } from "../../workers/data-sync/src/main.js";
import { createProductionEnrichmentExecutor } from "../../workers/data-sync/src/jobs/enrichment.js";
import { ApiFootballClient } from "../../packages/football-data/src/index.js";

export const PROVIDER_API_ORIGIN = "http://127.0.0.1:3241";
export const PROVIDER_WEB_ORIGIN = "http://127.0.0.1:3240";
type Runtime = { pg: string; redis: string; api?: ChildProcess; web?: ChildProcess; worker?: ReturnType<typeof startReplayWorker>; databaseUrl: string; redisUrl: string };
let owned: Runtime | null = null;
export const LIVE_FIXTURES = {
  fallback: "live-fallback-fixture",
  limited: "live-limited-fixture",
  comparison: "live-comparison-fixture",
} as const;
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function wait(url: string) { for (let i=0;i<120;i++){ try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r=>setTimeout(r,500)); } throw new Error(`SERVICE_NOT_READY:${url}`); }
function stop(child?: ChildProcess) { if (!child?.pid) return; try { execFileSync("taskkill", ["/pid",String(child.pid),"/T","/F"], { stdio:"ignore" }); } catch {} }
function observe(child: ChildProcess, label: string) { for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => { const safe=String(chunk).replace(/postgresql:\/\/[^\s]+/g,"[REDACTED_DATABASE_URL]").replace(/deterministic/g,"[REDACTED]"); process.stderr.write(`[${label}] ${safe}`); }); return child; }
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
    const api=observe(run(["pnpm","--filter","@bet-stats/api","dev"],{DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,POSTGRES_READY:"true",REDIS_READY:"true",API_HOST:"127.0.0.1",API_PORT:"3241",NODE_ENV:"test",ELIGIBILITY_ALLOWED_REGIONS:"PL"}),"api"); await wait(`${PROVIDER_API_ORIGIN}/health/ready`);
    execFileSync("cmd.exe",["/d","/s","/c","corepack","pnpm","--filter","@bet-stats/web","build"],{cwd:process.cwd(),env:{...process.env,API_ORIGIN:PROVIDER_API_ORIGIN},stdio:"pipe"});
    const web=observe(run(["pnpm","--filter","@bet-stats/web","exec","next","start","--hostname","127.0.0.1","--port","3240"],{API_ORIGIN:PROVIDER_API_ORIGIN,ELIGIBILITY_REGION:"PL",ELIGIBILITY_AGE_ACKNOWLEDGED:"true",ELIGIBILITY_CHECKED_AT:new Date().toISOString()}),"web"); await wait(PROVIDER_WEB_ORIGIN);
    owned={pg,redis,api,web,worker,databaseUrl,redisUrl}; return {databaseUrl,redisUrl,workerReady:true,seeded:["PL","39","78","848"],productionCounts};
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
  const observation = async (id:string, endpointFamily:string, observedAt:string) => db.sourceObservation.create({ data: { id, provider: "api-football", endpointFamily, externalIdentity: id, observedAt: new Date(observedAt), payloadHash: `${id}-hash`, rawPayload: { deterministic: true }, payloadBytes: 22 } });
  await observation("live-fallback-observation", "FIXTURES", "2026-09-12T12:00:02.000Z");
  await observation("live-last-valid-observation", "FIXTURES", "2026-09-11T12:00:00.000Z");
  await db.providerRouteReceipt.create({ data: { id: "live-fallback-route", contentHash: "live-fallback-route-hash", policyVersion: "provider-policy-v1", policyHash: "live-policy-hash", competitionId: "live-pl", seasonId: "live-pl-2026", endpointFamily: "FIXTURES", candidates: ["football-data.org","api-football"], selectedProvider: "api-football", trigger: "PRIMARY_UNAVAILABLE", outcome: "SUCCEEDED", capabilitySnapshot: {}, budgetSnapshot: {}, circuitSnapshot: {}, correlationId: "live-fallback", createdAt: new Date("2026-09-12T12:00:03.000Z"), attempts: { create: [
    { id: "live-primary-attempt", attemptKey: "live-primary-attempt", provider: "football-data.org", state: "FAILED", reason: "UPSTREAM_UNAVAILABLE", admitted: true, createdAt: new Date("2026-09-12T12:00:01.000Z") },
    { id: "live-fallback-attempt", attemptKey: "live-fallback-attempt", provider: "api-football", state: "SUCCEEDED", observationId: "live-fallback-observation", admitted: true, createdAt: new Date("2026-09-12T12:00:02.000Z") },
  ] } } });
  await db.providerRouteReceipt.create({ data: { id: "live-prior-route", contentHash: "live-prior-route-hash", policyVersion: "provider-policy-v1", policyHash: "live-policy-hash", competitionId: "live-uel", seasonId: "live-uel-2026", endpointFamily: "FIXTURES", candidates: ["api-football"], selectedProvider: "api-football", trigger: "SCHEDULED", outcome: "SUCCEEDED", capabilitySnapshot: {}, budgetSnapshot: {}, circuitSnapshot: {}, correlationId: "live-prior", createdAt: new Date("2026-09-11T12:00:01.000Z"), attempts: { create: { id: "live-prior-attempt", attemptKey: "live-prior-attempt", provider: "api-football", state: "SUCCEEDED", observationId: "live-last-valid-observation", admitted: true } } } });
  await db.providerRouteReceipt.create({ data: { id: "live-limited-route", contentHash: "live-limited-route-hash", policyVersion: "provider-policy-v1", policyHash: "live-policy-hash", competitionId: "live-uel", seasonId: "live-uel-2026", endpointFamily: "FIXTURES", candidates: ["api-football"], selectedProvider: null, trigger: "PROVIDER_UNAVAILABLE", outcome: "NO_FALLBACK", capabilitySnapshot: {}, budgetSnapshot: {}, circuitSnapshot: {}, correlationId: "live-limited", createdAt: new Date("2026-09-13T12:00:01.000Z"), attempts: { create: { id: "live-limited-attempt", attemptKey: "live-limited-attempt", provider: "api-football", state: "NO_FALLBACK", reason: "PROVIDER_UNAVAILABLE", admitted: false } } } });
  await db.providerCapability.create({ data: { provider: "api-football", leagueId: "live-pl", seasonId: "live-pl-2026", endpoint: "LINEUPS", supported: true, verifiedAt: new Date("2026-09-20T00:00:00.000Z"), expiresAt: new Date("2026-09-22T00:00:00.000Z") } });
  await db.providerCircuitState.create({ data: { provider: "api-football", endpointFamily: "LINEUPS", state: "CLOSED" } });
  const lineupEnvelope = { get: "lineups", parameters: { fixture: "1379123" }, errors: [], results: 2, paging: { current: 1, total: 1 }, response: [42,49].map((teamId) => ({ team: { id: teamId, name: `Team ${teamId}`, logo: null, colors: null }, formation: "4-3-3", coach: { id: teamId + 100, name: `Coach ${teamId}`, photo: null }, startXI: Array.from({length:11},(_,index)=>({player:{id:teamId*100+index,name:`Player ${teamId}-${index}`,number:index+1,pos:"M",grid:"1:1"}})), substitutes: [] })) };
  const enrichment = createProductionEnrichmentExecutor({ database: db, apiFootballFactory: () => new ApiFootballClient({ apiKey: "stub", now: () => new Date("2026-09-21T14:00:00.000Z"), fetcher: async () => new Response(JSON.stringify(lineupEnvelope)) }) });
  const enrichmentResult = await enrichment({ fixtureId: LIVE_FIXTURES.comparison, endpoint: "LINEUPS", cutoff: "2026-09-21T14:05:00.000Z", policyVersion: "enrichment-v1" });
  if (enrichmentResult.status !== "completed" || enrichmentResult.evidenceState !== "OBSERVED") throw new Error("PRODUCTION_ENRICHMENT_NOT_COMPLETED");
  const lineup = await db.lineupObservation.findFirstOrThrow({ where: { fixtureId: LIVE_FIXTURES.comparison, status: "OFFICIAL_CONFIRMED" } });
  const probabilities = (home:number) => ({ ONE_X_TWO: [{selection:"HOME",probability:home,fairOdds:(1/home).toFixed(2)},{selection:"DRAW",probability:0.25,fairOdds:"4.00"},{selection:"AWAY",probability:0.75-home,fairOdds:(1/(0.75-home)).toFixed(2)}], OVER_UNDER_2_5: [{selection:"OVER_2_5",probability:0.55,fairOdds:"1.82"},{selection:"UNDER_2_5",probability:0.45,fairOdds:"2.22"}], BTTS: [{selection:"YES",probability:0.6,fairOdds:"1.67"},{selection:"NO",probability:0.4,fairOdds:"2.50"}] });
  for (const [id,kind,revision,cutoff,home,lineupId] of [["live-left","INITIAL",1,"2026-09-20T10:00:00.000Z",0.4,null],["live-right","PRE_MATCH",1,"2026-09-21T10:00:00.000Z",0.5,null],["live-newer","LINEUP_CONFIRMED",1,"2026-09-21T14:00:00.000Z",0.55,lineup.id]] as const) {
    const dto:any={id,fixtureId:LIVE_FIXTURES.comparison,kind,officialLineupObservationId:lineupId,revision,cutoff,modelVersion:"poisson-ensemble-v1",modelHash:`model-${id}`,configVersion:"forecast-config-v1",configHash:"live-config",inputHash:`input-${id}`,evidenceFingerprint:`evidence-${id}`,evidenceBuildIds:["live-home-evidence","live-away-evidence"],probabilities:probabilities(home),confidence:{version:"confidence-v1",score:0.8,components:{completeness:0.8,lineupAvailability:lineupId?1:0,freshness:0.9,sourceReliability:0.8,modelStability:0.8}},limitations:lineupId?[]:["LINEUP_NOT_CONFIRMED"],tail:{retainedMass:0.999,tailMass:0.001,warning:false,normalizationVersion:"retained-mass-v1"},assumptions:[],receipt:{forecastSnapshotId:id,officialLineupObservationId:lineupId,evidenceBuildIds:["live-home-evidence","live-away-evidence"],sourceRefs:[],expectedGoals:{home:1.4,away:1.1},adjustments:{home:{multiplier:1,components:{}},away:{multiplier:1,components:{}}}},issuedAt:new Date(new Date(cutoff).getTime()+1000).toISOString()};
    await db.forecastSnapshot.create({ data: { id, fixtureId: LIVE_FIXTURES.comparison, kind, state:"ISSUED", revision, officialLineupObservationId:lineupId, cutoff:new Date(cutoff), modelVersion:dto.modelVersion, modelHash:dto.modelHash, configVersion:dto.configVersion, configHash:dto.configHash, inputHash:dto.inputHash, evidenceFingerprint:dto.evidenceFingerprint, sourceRefs:[], probabilities:dto.probabilities, confidence:dto.confidence, assumptions:[], receipt:dto, issuedAt:new Date(dto.issuedAt), markets:{create:Object.entries(dto.probabilities).map(([market,values])=>({market,probabilities:values as never}))} } });
  }
  return { enrichmentDecisions: await db.enrichmentDecisionReceipt.count(), lineupObservations: await db.lineupObservation.count(), sourceObservations: await db.sourceObservation.count({ where: { endpointFamily: "LINEUPS" } }) };
}
export async function stopLiveProviderStack(partial?:{pg:string;redis:string}) { const state=owned; if(state){stop(state.web);stop(state.api);await state.worker?.close();} for(const name of [partial?.redis??state?.redis,partial?.pg??state?.pg])if(name)try{docker("rm","-f",name)}catch{} owned=null; }

export default async function setup() { await startLiveProviderStack(); return async () => stopLiveProviderStack(); }
