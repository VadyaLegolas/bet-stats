---
phase: quick-261016-nbo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - "apps/api/src/modules/evidence/evidence.service.ts"
  - "apps/api/src/modules/evidence/evidence.controller.ts"
  - "apps/web/app/teams/[teamId]/evidence/page.tsx"
  - "tests/unit/evidence-display.test.ts"
  - "tests/unit/evidence-page-heading.test.ts"
autonomous: true
requirements: []

estimate:
  tokens: 20000
  raw_tokens: 15000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "GET /teams/{teamId}/evidence always carries team and fixture display keys: team is { id, name } for a resolvable team and null otherwise (unknown team id still answers 200 with team null, never a 404); fixture is null unless a fixtureId query param is supplied and resolvable — while every projection field (teamId, requestedAsOf, resolvedAsOfUtc, cutoffBoundary, state, freshness, buildId, publishedAt, receipt, coverage, components) stays deep-equal to today's response."
    - "The evidence controller accepts an optional fixtureId query param (trimmed, empty string treated as absent) and threads it into the service; without it no fixture lookup is issued at all (unit-asserted with a spy)."
    - "Display enrichment is best-effort: with no Prisma client (unit environment) or a rejecting lookup, the response still returns the full projection with team null and fixture null — an enrichment failure can never fail an evidence read."
    - "The web heading renders exactly '{team name}: исторические доказательства' when the API supplies a name and exactly 'Исторические доказательства' otherwise — no id string can reach any heading, because evidenceHeading is the sole input to the h1 (unit-tested)."
    - "The page forwards its fixtureId search param to the internal-api evidence fetch (and to the effect deps), so the existing sentence 'Доказательства запрошены к началу матча …' activates for resolvable fixtures."
    - "Gates green: both new unit test files observed RED then GREEN, the full unit project passes, api and web typecheck pass, a temporary API_PORT=3099 instance served a real team name plus the composed fixture name/kickoff against the dev DB, and HEAD is exactly one atomic commit of the five planned files."
  artifacts:
    - "tests/unit/evidence-display.test.ts — attachEvidenceDisplay / loadEvidenceDisplay / composeFixtureDisplay contract incl. null-lookup degradation and parseEvidenceProjection tolerance"
    - "tests/unit/evidence-page-heading.test.ts — evidenceHeading name/plain contract"
    - "apps/api/src/modules/evidence/evidence.service.ts exports EvidenceResponse, EvidenceDisplay*, EvidenceDisplayLookup, attachEvidenceDisplay, loadEvidenceDisplay, composeFixtureDisplay, plus EvidenceService.get composition and the database-bound displayLookup adapter"
    - "apps/api/src/modules/evidence/evidence.controller.ts with the optional fixtureId query param"
    - "apps/web/app/teams/[teamId]/evidence/page.tsx with the widened Evidence type, evidenceHeading export, fixtureId-forwarding fetch and id-free h1"
  key_links:
    - "controller @Query(fixtureId) -> EvidenceService.get -> loadEvidenceDisplay -> fixture display entity in JSON -> page fixture sentence (the internal-api proxy already forwards the full search string)"
    - "this.database null -> displayLookup() returns null -> loadEvidenceDisplay null branch -> team/fixture null (the exact unit-tested degradation path)"
    - "page fetch query (fixtureId) -> internal-api proxy pass-through (untouched) -> API controller fixtureId -> response fixture"
    - "data.team?.name -> evidenceHeading -> h1 (the only data path into the heading)"
---

<objective>
Stop the team evidence page from rendering a raw cuid in its heading: enrich the API evidence response with nullable team and fixture display entities (display-only, domain contract untouched), accept an optional fixtureId query param on the evidence endpoint, and make the web page forward fixtureId while rendering the heading from the team name only — falling back to the plain Russian heading with no ids ever shown.

Purpose: the evidence DTO is a projection of build state and never carried display entities, so the page had no name to show and fell back to the raw URL id. Names must come from the API as a single source, degrade to null when unresolvable (never 404, never fail the read), and the page must never interpolate ids into headings.

Output: enriched API response + controller param, id-free web heading with fixtureId forwarding, two new unit test files (RED first), unit/typecheck/live-HTTP gates green, exactly one atomic commit. packages/domain, packages/database schema, workers/data-sync, the internal-api proxy route, and tests/e2e stay untouched.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md

# Evidence service — resolveTeamEvidence (line 96, pure; KEEP byte-identical), EvidenceService class (117), database field initializer (118, null when DATABASE_URL is absent), repository (119), get() (126 — the composition point):
apps/api/src/modules/evidence/evidence.service.ts

# Controller, full 14-line file — @Get(":teamId/evidence") currently accepts only asOf:
apps/api/src/modules/evidence/evidence.controller.ts

# Web page — Evidence type (18-33), fixtureId from search (91), fetch URL (99), effect deps (109), heading fallback (119), h1 + fixture sentence (122):
apps/web/app/teams/[teamId]/evidence/page.tsx

# READ ONLY — existing pure-function unit style for API modules (imports from apps/api with .js specifier):
tests/unit/privacy-consent-retry.test.ts

# READ ONLY — evidence projection test-fixture style with a fake repository (integration project, NOT a gate):
tests/integration/evidence-api.test.ts

# READ ONLY — fixture display pattern: kickoff as row.kickoffUtc.toISOString() (line 75); the web composes fixture names as "{home} против {away}" (fixtures/page.tsx line 111, fixture h1 line 23, e2e name assertions):
apps/api/src/modules/fixtures/fixtures.service.ts

# READ ONLY — Team (line 154: id/name) and Fixture (line 184: homeTeamId/awayTeamId/kickoffUtc + homeTeam/awayTeam relations) models:
packages/database/prisma/schema.prisma

# READ ONLY — e2e stub already supplies team/fixture keys (lines 24-25); do not modify e2e:
tests/e2e/team-evidence.spec.ts

# READ ONLY — already forwards the full search string to the API; do NOT modify:
apps/web/app/internal-api/teams/[teamId]/evidence/route.ts

# Vitest unit project (tests/unit/**) is the gate; integration/e2e are NOT gates (replay.test.ts has 6 pre-existing failures) and must not be run:
vitest.config.ts

# Live stack facts: turbo run dev --env-mode=loose runs node --enable-source-maps dist/main.js (API :3001 + data-sync worker) and next dev (:3000). The API process has NO file watcher and was started from the old dist — do NOT restart or kill it. Next dev hot-reloads the web page. Live API verification therefore uses a throwaway API_PORT=3099 instance built from the new dist (Task 2); after the task the orchestrator restarts the stack when convenient.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED the evidence display-enrichment unit tests, GREEN with pure helpers</name>
  <files>tests/unit/evidence-display.test.ts, apps/api/src/modules/evidence/evidence.service.ts</files>
  <behavior>
    - attachEvidenceDisplay(base, null, null) resolves to an object deep-equal to the base projection plus team null and fixture null; Object.keys(result) sorted equals the base's sorted keys plus fixture and team; the base object itself gains no properties (no mutation).
    - attachEvidenceDisplay(base, { id, name: "Arsenal" }, { id, name, kickoff }) attaches both display entities verbatim while every projection field (teamId, state, resolvedAsOfUtc, components, …) stays deep-equal to base.
    - loadEvidenceDisplay(null, "team-1", "fix-1") resolves { team: null, fixture: null } — the exact path EvidenceService takes when its Prisma client is null.
    - With a fake lookup: findTeam returning a row attaches { id, name }; findTeam returning null yields team null without throwing (unknown id must not throw).
    - fixtureId absent, empty, or whitespace-only yields fixture null and findFixture is NEVER called (vi.fn assertion).
    - fixtureId given and findFixture returning { id, homeTeam: { name }, awayTeam: { name }, kickoffUtc: Date } yields fixture { id, name: "&lt;home&gt; против &lt;away&gt;", kickoff: kickoffUtc.toISOString() }; findFixture returning null yields fixture null.
    - A lookup whose findTeam/findFixture rejects resolves to { team: null, fixture: null } and never rejects (display enrichment is best-effort).
    - parseEvidenceProjection(attached) from @bet-stats/domain does not throw and still carries team and fixture (toMatchObject) — the domain contract tolerates the display keys without modification.
    - RED: the new file fails today because the display exports do not exist; GREEN: all cases pass after the helpers are added, with resolveTeamEvidence itself untouched.
  </behavior>
  <action>RED first. Create tests/unit/evidence-display.test.ts in the style of tests/unit/privacy-consent-retry.test.ts (import from ../../apps/api/src/modules/evidence/evidence.service.js with the .js specifier): import attachEvidenceDisplay, loadEvidenceDisplay, composeFixtureDisplay, resolveTeamEvidence and build base projections with resolveTeamEvidence({ teamId: "team-arsenal", asOf: "2026-08-29T14:00:00.000Z" }) without a repository (PENDING projection is a valid base). Fake lookups are plain objects with vi.fn findTeam/findFixture. Implement every behavior case above, including a case where loadEvidenceDisplay receives the fixture row shaped exactly like the Prisma typed select result. Run corepack pnpm vitest run --project unit tests/unit/evidence-display.test.ts and confirm a non-zero exit caused by the new describe block (the display exports are missing); record the RED observation in the task done, never weaken an assertion to get green.

GREEN. In apps/api/src/modules/evidence/evidence.service.ts add ONLY the display-enrichment surface, placed below resolveTeamEvidence and above the EvidenceService class: exported types EvidenceDisplayTeam (id, name), EvidenceDisplayFixture (id, name, kickoff), EvidenceDisplayFixtureRow (id, homeTeam.name, awayTeam.name, kickoffUtc as Date), EvidenceDisplay (team, fixture — both nullable), EvidenceResponse (EvidenceProjection intersected with team and fixture nullable), exported interface EvidenceDisplayLookup { findTeam(teamId): Promise&lt;EvidenceDisplayTeam | null&gt;; findFixture(fixtureId): Promise&lt;EvidenceDisplayFixtureRow | null&gt; }; exported attachEvidenceDisplay(projection: EvidenceProjection, team: EvidenceDisplayTeam | null, fixture: EvidenceDisplayFixture | null): EvidenceResponse (pure spread, no mutation); exported async loadEvidenceDisplay(lookup: EvidenceDisplayLookup | null, teamId: string, fixtureId?: string): Promise&lt;EvidenceDisplay&gt; — a null lookup short-circuits to both nulls, each lookup invocation is individually wrapped so a rejection degrades to null, the fixtureId is trimmed and empty-after-trim behaves as absent (findFixture never invoked), and a resolved row is mapped through exported composeFixtureDisplay(row): EvidenceDisplayFixture joining the display name as `${row.homeTeam.name} против ${row.awayTeam.name}` — i.e. home-name, space, the Russian word for versus, space, away-name — this is the product's fixture-name convention (fixtures page line 111, fixture h1 line 23, e2e name assertions); the brief's em-dash join was an assumption and is deliberately NOT used, since the fixtures module returns the two team names separately and has no joined-name helper — and kickoff as row.kickoffUtc.toISOString() (fixtures.service.ts line 75 pattern). Keep resolveTeamEvidence, EvidenceRepository, PublishedEvidenceBuild/Component, contractError, parseCutoff and every existing export byte-identical. Do NOT change EvidenceService.get or the controller yet (Task 2 wire-up); do NOT touch packages/domain, the Prisma schema, generated clients, or workers. Re-run the target test file to GREEN, then corepack pnpm --filter @bet-stats/api typecheck. Reversibility: reversible — purely additive exports, no behavior change yet.</action>
  <verify>
    <automated>corepack pnpm vitest run --project unit tests/unit/evidence-display.test.ts; if ($LASTEXITCODE -ne 0) { exit 1 }; corepack pnpm --filter @bet-stats/api typecheck; if ($LASTEXITCODE -ne 0) { exit 1 }</automated>
  </verify>
  <done>RED was observed first (failures confined to the new describe block), then the file went GREEN without touching resolveTeamEvidence; EvidenceService.get and the controller are still byte-unchanged at this point; api typecheck is clean; nothing committed yet.</done>
  <reversibility rating="reversible">Adding unused exported helpers; git revert removes them with no behavioral effect.</reversibility>
</task>

<task type="auto">
  <name>Task 2: Wire EvidenceService.get() enrichment + fixtureId controller param, live-verify on a temporary API instance</name>
  <files>apps/api/src/modules/evidence/evidence.service.ts, apps/api/src/modules/evidence/evidence.controller.ts</files>
  <action>Rework EvidenceService.get to get(teamId: string, asOf?: string, fixtureId?: string): Promise&lt;EvidenceResponse&gt; in two ordered steps: first await resolveTeamEvidence({ teamId, asOf }, this.repository) so invalid asOf/teamId still fail before any display query runs, then const display = await loadEvidenceDisplay(this.displayLookup(), teamId, fixtureId) and return attachEvidenceDisplay(projection, display.team, display.fixture). Add private displayLookup(): EvidenceDisplayLookup | null that returns null exactly when this.database is null (this is the unit-covered degradation path), otherwise returns an adapter bound to the database captured into a local const inside the method: findTeam uses database.team.findUnique({ where: { id }, select: { id: true, name: true } }) and findFixture uses database.fixture.findUnique({ where: { id }, select: { id: true, kickoffUtc: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }) — typed Prisma selects only, never a full-row select, ids go only into parameterized where clauses. In evidence.controller.ts add a third parameter @Query("fixtureId") fixtureId?: string, pass fixtureId?.trim() || undefined into this.evidence.get(teamId, asOf, …), and change the declared return type to Promise&lt;EvidenceResponse&gt; (import EvidenceResponse from the service); keep @Controller/@Get/@Header Cache-Control no-store and the asOf param unchanged. Then run corepack pnpm --filter @bet-stats/api build so apps/api/dist carries the new code (dist is gitignored; replacing it does NOT affect the already-running stack process — do not restart, kill, or touch any existing PID, and note for the SUMMARY whether http://127.0.0.1:3001 already serves the new payload; if it does not, that is expected under the no-restart rule and the orchestrator restarts the stack later). LIVE GATE (see verify): boot a throwaway API instance from the freshly built dist on API_PORT=3099 against the dev DB, exercise fixtures + evidence GETs with curl.exe, then kill ONLY that throwaway process. The running stack, the worker, Redis and the web process are never restarted. Reversibility: reversible — a git revert restores the plain projection response; no schema or stored data changes.</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/api build; if ($LASTEXITCODE -ne 0) { exit 1 }; corepack pnpm vitest run --project unit tests/unit/evidence-display.test.ts; if ($LASTEXITCODE -ne 0) { exit 1 }; if (Test-Path .env) { Get-Content .env | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value ($Matches[2].Trim().Trim('"')) } } }; if (-not $env:DATABASE_URL) { Write-Output 'DATABASE_URL missing from .env'; exit 1 }; $env:API_PORT='3099'; $out="$env:TEMP\nbo-api-out.log"; $err="$env:TEMP\nbo-api-err.log"; $api=Start-Process -FilePath node -ArgumentList '--enable-source-maps','dist/main.js' -WorkingDirectory apps/api -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err; try { $probe=''; for ($i=0; $i -lt 30; $i++) { $raw=((curl.exe -s "http://127.0.0.1:3099/teams/probe-team-x/evidence?asOf=2026-08-29T14:00:00.000Z") -join "`n"); if ($raw) { $probe=$raw; break }; Start-Sleep -Seconds 1 }; if (-not $probe) { Write-Output 'temp API not ready:'; Get-Content $out,$err -Tail 40; exit 1 }; if ($probe -notmatch '"teamId":"probe-team-x"' -or $probe -notmatch '"team":null' -or $probe -notmatch '"fixture":null') { Write-Output "probe payload wrong: $probe"; exit 1 }; $fxraw=((curl.exe -s "http://127.0.0.1:3099/fixtures?from=2026-10-09T00:00:00.000Z&to=2026-10-23T00:00:00.000Z") -join "`n"); $fx=$fxraw | ConvertFrom-Json; $first=@($fx.items)[0]; if (-not $first) { Write-Output "no fixtures in window: $fxraw"; exit 1 }; $home=$first.teams.home.id; $fid=$first.id; $ko=$first.kickoff; $ev=((curl.exe -s "http://127.0.0.1:3099/teams/$home/evidence?asOf=$ko&fixtureId=$fid") -join "`n") | ConvertFrom-Json; if ($ev.team.id -ne $home -or [string]::IsNullOrWhiteSpace($ev.team.name)) { Write-Output "team enrichment missing: $($ev | ConvertTo-Json -Depth 6)"; exit 1 }; $want="$($first.teams.home.name) против $($first.teams.away.name)"; if ($ev.fixture.id -ne $fid -or $ev.fixture.name -ne $want -or $ev.fixture.kickoff -ne $ko) { Write-Output "fixture enrichment wrong: $($ev.fixture | ConvertTo-Json)"; exit 1 }; if ([string]::IsNullOrWhiteSpace($ev.state) -or $ev.teamId -ne $home) { Write-Output 'projection fields missing'; exit 1 }; $ev2=((curl.exe -s "http://127.0.0.1:3099/teams/$home/evidence?asOf=$ko") -join "`n") | ConvertFrom-Json; if ($ev2.PSObject.Properties.Name -notcontains 'fixture' -or $null -ne $ev2.fixture -or $ev2.team.id -ne $home) { Write-Output 'without fixtureId the fixture must be an explicit null'; exit 1 } } finally { if ($api -and -not $api.HasExited) { $api.Kill() } }</automated>
    <human-check>After the gates pass, report in the SUMMARY whether the stack's :3001 already serves the new payload (it will not, unless the orchestrator set up a watcher — the observed process is plain node dist/main.js from the old dist) and that a stack restart is the orchestrator's action.</human-check>
  </verify>
  <done>The service composes projection + display enrichment in the documented order (invalid input fails before any display query); the controller accepts and trims fixtureId; api build is green; the targeted unit test stays GREEN; the throwaway :3099 instance answered the probe with team null/fixture null and 200, returned a real team name plus the exact "против" fixture name and ISO kickoff for a real fixture, returned an explicit fixture null when fixtureId was omitted, and was killed afterwards; no existing process was restarted or killed.</done>
  <reversibility rating="reversible">git revert restores get() delegation and the single-param controller; the rebuilt dist is regenerated on the next build.</reversibility>
</task>

<task type="auto" tdd="true">
  <name>Task 3: RED the heading contract, GREEN the web page (type widening, fixtureId forwarding, id-free heading), full gates, one atomic commit</name>
  <files>apps/web/app/teams/[teamId]/evidence/page.tsx, tests/unit/evidence-page-heading.test.ts</files>
  <behavior>
    - evidenceHeading("Arsenal") returns exactly "Arsenal: исторические доказательства".
    - evidenceHeading(null), evidenceHeading(undefined), evidenceHeading("") and evidenceHeading("   ") each return exactly "Исторические доказательства" — plain, no colon, no id.
    - evidenceHeading("  Arsenal  ") trims and returns the named form.
    - RED first (the helper does not exist yet), GREEN after the page exports it; the rendered h1 calls only evidenceHeading(data.team?.name), so no other value can reach the heading.
  </behavior>
  <action>RED. Create tests/unit/evidence-page-heading.test.ts importing { evidenceHeading } from "../../apps/web/app/teams/[teamId]/evidence/page.js" (same import style as tests/integration/evidence-publication.test.ts line 8) with the four behavior cases above; run corepack pnpm vitest run --project unit tests/unit/evidence-page-heading.test.ts and confirm it fails today.

GREEN — edit ONLY apps/web/app/teams/[teamId]/evidence/page.tsx, four scoped changes: (1) widen the Evidence type lines 19/21 to team?: { id: string; name: string } | null and fixture?: { id: string; name: string; kickoff: string } | null (keep teamId?: string — the projection echoes it — and every other field as-is); (2) export function evidenceHeading(teamName: string | null | undefined): string implementing the behavior above (trim, named form only when a non-empty name exists, plain form otherwise); (3) in the useEffect fetch (line 99) append the fixtureId value already read at line 91 (search.get("fixtureId")) to the evidence query string when it is a non-empty string, and add fixtureId to the effect dependency array at line 109 alongside asOf and params.teamId — the internal-api proxy route already forwards the whole search string, do NOT touch it; (4) replace the heading computation at line 119 and the h1 at line 122: delete the id-based fallback chain that currently feeds the heading, and render the h1 as evidenceHeading(data.team?.name) so it shows "&lt;name&gt;: исторические доказательства" when a name exists and "Исторические доказательства" when it does not — ids must never be interpolated into any heading. Keep the fixture sentence on line 122 (the data.fixture && branch) byte-identical — it activates on its own now that the API returns fixture — and keep every other Russian string, including the loading and failure headings, byte-unchanged: the only user-visible text change in this task is the disappearance of the raw id. Do not touch packages/domain, workers/data-sync, tests/e2e/team-evidence.spec.ts (its stub already supplies team/fixture), the Prisma schema, or generated clients.

Then GREEN the heading test, run the full unit project, both typechecks, and commit. Run: corepack pnpm vitest run --project unit; corepack pnpm --filter @bet-stats/web typecheck; corepack pnpm --filter @bet-stats/api typecheck. Commit EXACTLY ONE atomic commit staging ONLY these five files: apps/api/src/modules/evidence/evidence.service.ts, apps/api/src/modules/evidence/evidence.controller.ts, apps/web/app/teams/[teamId]/evidence/page.tsx, tests/unit/evidence-display.test.ts, tests/unit/evidence-page-heading.test.ts — message `fix(evidence): show team name instead of raw id on the evidence page` with an optional English body referencing quick id 261016-nbo. HARD BLACKLIST — never stage: .env, .env2, infra/docker-compose.yml, package.json, pnpm-lock.yaml, packages/database/src/generated/**, tsconfig.json, apps/web/next-env.d.ts, .agents/, .claude/, .planning/** (planning artifacts are committed by the orchestrator), .gsd/, .tmp-tok.cjs, skills-lock.json, untracked scripts (enqueue-*.cjs, seed-fixture*, sync-fixture*, etc.), apps/api/dist/**, plus every other unrelated working-tree file. Final staging check: git diff --cached --name-only lists exactly the five paths before committing. Do not touch ROADMAP.md or any docs; do not restart or kill the running stack; do not run integration or e2e suites. Reversibility: reversible — a git revert restores the old heading behavior.</action>
  <verify>
    <automated>corepack pnpm vitest run --project unit tests/unit/evidence-page-heading.test.ts; if ($LASTEXITCODE -ne 0) { exit 1 }; corepack pnpm vitest run --project unit; if ($LASTEXITCODE -ne 0) { exit 1 }; corepack pnpm --filter @bet-stats/web typecheck; if ($LASTEXITCODE -ne 0) { exit 1 }; corepack pnpm --filter @bet-stats/api typecheck; if ($LASTEXITCODE -ne 0) { exit 1 }; $files = git show --name-only --format= HEAD | ForEach-Object { $_.Trim() } | Where-Object { $_ }; $expected = @('apps/api/src/modules/evidence/evidence.controller.ts','apps/api/src/modules/evidence/evidence.service.ts','apps/web/app/teams/[teamId]/evidence/page.tsx','tests/unit/evidence-display.test.ts','tests/unit/evidence-page-heading.test.ts'); $diff = Compare-Object -ReferenceObject ($expected | Sort-Object) -DifferenceObject ($files | Sort-Object); if ($diff) { $diff | Out-String | Write-Output; exit 1 }</automated>
    <human-check>Open http://localhost:3000/teams/&lt;home-team-id&gt;/evidence?asOf=&lt;kickoff&gt;&amp;fixtureId=&lt;fixture-id&gt; (real ids from the Task 2 fixtures response, or the id from the defect screenshot with any valid ISO asOf). Expected immediately (web hot-reload, stack API still on old dist): the h1 is exactly "Исторические доказательства" — no cuid, no id. Expected after the orchestrator restarts the stack: the h1 is "&lt;Team Name&gt;: исторические доказательства" and the fixture sentence appears when fixtureId resolves. In neither state may any heading contain a raw id.</human-check>
  </verify>
  <done>The heading test was RED before the page change and is GREEN after; the full unit project, web typecheck and api typecheck all exit 0; the h1 renders one of exactly two Russian strings depending on whether the API returned a team name, with no id fallback anywhere; fixtureId flows from the page URL to the evidence fetch and its effect deps; HEAD is a single commit containing exactly the five planned files; the stack was never restarted, and no integration/e2e suite ran.</done>
  <reversibility rating="reversible">git revert of the single commit restores the previous heading and fetch behavior; no data or external state changes.</reversibility>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser URL path/query (teamId, asOf, fixtureId) -> Nest evidence controller -> Prisma lookups | User-supplied identifiers now reach two additional database reads (team, fixture) that shape the response body. |
| API JSON -> internal-api proxy -> React heading | Display strings from the database are interpolated into the page h1; a bad fallback would expose internal ids to users (the reported defect). |
| Throwaway verification instance -> dev PostgreSQL/Redis | A second API process is started briefly against the live dev database to verify the fix without touching the stack. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-nbo-01 | Tampering | fixtureId/teamId inputs in EvidenceService display lookup (evidence.service.ts displayLookup) | medium | mitigate | Ids are used only as parameterized findUnique where values (never string-interpolated into queries) and the response is built from typed Prisma selects restricted to id/name/kickoff fields; unknown ids resolve to null with 200 instead of an error oracle. |
| T-quick-nbo-02 | Information Disclosure | display enrichment accidentally widening the evidence payload | low | mitigate | Explicit select projections only (team: id+name; fixture: id, kickoffUtc, home/away team name) — never full-row selects; a unit test pins Object.keys of the response to the projection keys plus exactly team and fixture, and asserts every projection field stays deep-equal. |
| T-quick-nbo-03 | Denial of Service (availability of evidence reads) | enrichment DB failure failing the evidence endpoint | medium | mitigate | loadEvidenceDisplay wraps each lookup individually so a rejection degrades to null, the null-lookup path covers a missing Prisma client, and the unit suite includes a rejecting-lookup case — an evidence read can never fail because of display data. |
| T-quick-nbo-04 | Repudiation | stale stack process serving the old response after the fix ships | low | accept | Under the no-restart rule the running :3001 keeps its loaded code until the orchestrator restarts it; meanwhile the web fix alone already removes the raw id from the heading (plain fallback), and the SUMMARY records the pending restart explicitly. |
| T-quick-nbo-SC | Tampering | npm/pip/cargo installs | high | mitigate | No package installs in this task; only existing tooling (corepack pnpm, tsc, vitest, node, curl.exe) is used and the staging blacklist plus the exact five-file staging check prevent unrelated artifacts from entering the commit. |
</threat_model>

<verification>
- Task 1: tests/unit/evidence-display.test.ts RED observed first (missing display exports), then GREEN; api typecheck clean; resolveTeamEvidence and EvidenceService.get byte-unchanged at that point.
- Task 2: api build green; targeted unit test green; throwaway API_PORT=3099 instance (fresh dist, dev DB) answers the unknown-team probe with team null/fixture null and 200, returns a real team name plus the exact "против" fixture name and ISO kickoff for a real fixture with fixtureId, returns an explicit fixture null without fixtureId, keeps projection fields (state, teamId), and its process is killed in the finally block — no existing PID touched.
- Task 3: heading test RED then GREEN; full unit project green; web + api typecheck exit 0; HEAD stat equals exactly the five planned files (Compare-Object gate).
- Out of scope everywhere: no integration or e2e suites executed; no stack restart/kill; packages/domain, packages/database schema/generated, workers/data-sync, the internal-api proxy route, ROADMAP.md and docs untouched; .env/.env2 and other blacklisted paths never staged.
</verification>

<success_criteria>
The evidence endpoint returns display enrichment (team name when resolvable, composed fixture name/kickoff when fixtureId is provided, explicit nulls otherwise, projection unchanged), the controller accepts optional fixtureId, the web page forwards fixtureId and renders one of exactly two Russian headings — team name present or plain — with no id ever shown, all unit/typecheck gates are green, and one atomic commit contains exactly the five planned files.
</success_criteria>

<output>
Create `.planning/quick/261016-nbo-team-evidence-page-shows-a-raw-cuid-in-t/261016-nbo-SUMMARY.md` when done
</output>
