import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createPrismaClient } from "../../packages/database/src/client.js";
import { startReplayWorker } from "../../workers/data-sync/src/main.js";

export const PROVIDER_API_ORIGIN = "http://127.0.0.1:3241";
export const PROVIDER_WEB_ORIGIN = "http://127.0.0.1:3240";
type Runtime = { pg: string; redis: string; api?: ChildProcess; web?: ChildProcess; worker?: ReturnType<typeof startReplayWorker>; databaseUrl: string; redisUrl: string };
let owned: Runtime | null = null;
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
    const db=createPrismaClient(databaseUrl); for(const [id,name,fd,api] of [["pl","Premier League","PL","39"],["uel","Europa League",null,"78"],["uecl","Conference League",null,"848"]] as const){const leagueId=`live-${id}`,seasonId=`live-${id}-2026`;await db.league.create({data:{id:leagueId,name,countryCode:"EU"}});await db.season.create({data:{id:seasonId,leagueId,label:"2026",startsOn:new Date("2026-01-01"),endsOn:new Date("2026-12-31")}});if(fd){await db.leagueExternalRef.create({data:{leagueId,provider:"football-data.org",externalId:fd}});await db.seasonExternalRef.create({data:{seasonId,leagueId,provider:"football-data.org",externalId:"2026"}});}await db.leagueExternalRef.create({data:{leagueId,provider:"api-football",externalId:api}});await db.seasonExternalRef.create({data:{seasonId,leagueId,provider:"api-football",externalId:"2026"}});} await db.$disconnect();
    const deterministic:any={"football-data.org":()=>({}),"api-football":()=>({fetchEnrichment:async()=>({state:"observed-empty",payload:null})})};
    const worker=startReplayWorker({databaseUrl,redisUrl,footballDataApiToken:"deterministic",apiFootballApiKey:"deterministic",providerFactories:deterministic,prefix:`p5-${suffix}`}); await worker.waitUntilReady();
    const run=(args:string[],env:NodeJS.ProcessEnv)=>spawn("cmd.exe",["/d","/s","/c","corepack",...args],{cwd:process.cwd(),env:{...process.env,...env},stdio:["ignore","pipe","pipe"],windowsHide:true});
    const api=observe(run(["pnpm","--filter","@bet-stats/api","dev"],{DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,POSTGRES_READY:"true",REDIS_READY:"true",API_HOST:"127.0.0.1",API_PORT:"3241",NODE_ENV:"test",ELIGIBILITY_ALLOWED_REGIONS:"PL"}),"api"); await wait(`${PROVIDER_API_ORIGIN}/health/ready`);
    execFileSync("cmd.exe",["/d","/s","/c","corepack","pnpm","--filter","@bet-stats/web","build"],{cwd:process.cwd(),env:{...process.env,API_ORIGIN:PROVIDER_API_ORIGIN},stdio:"pipe"});
    const web=observe(run(["pnpm","--filter","@bet-stats/web","exec","next","start","--hostname","127.0.0.1","--port","3240"],{API_ORIGIN:PROVIDER_API_ORIGIN,ELIGIBILITY_REGION:"PL",ELIGIBILITY_AGE_ACKNOWLEDGED:"true",ELIGIBILITY_CHECKED_AT:new Date().toISOString()}),"web"); await wait(PROVIDER_WEB_ORIGIN);
    owned={pg,redis,api,web,worker,databaseUrl,redisUrl}; return {databaseUrl,redisUrl,workerReady:true,seeded:["PL","39","78","848"]};
  } catch(error){await stopLiveProviderStack({pg,redis});throw error;}
}
export async function stopLiveProviderStack(partial?:{pg:string;redis:string}) { const state=owned; if(state){stop(state.web);stop(state.api);await state.worker?.close();} for(const name of [partial?.redis??state?.redis,partial?.pg??state?.pg])if(name)try{docker("rm","-f",name)}catch{} owned=null; }

export default async function setup() { await startLiveProviderStack(); return async () => stopLiveProviderStack(); }
