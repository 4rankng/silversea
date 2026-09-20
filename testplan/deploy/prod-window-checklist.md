# Prod deploy-window checklist — migration tracking alignment + deploy

Status: PREPARED, NOT EXECUTED. Prod stays user-gated — every step below runs
only inside a user-approved deploy window (standing rule: prod DB is touched
by deploy backup+migrate, nothing else, ever).

Prepared by BE lane 2026-09-20 after the journal `when` restamp incident
(20260919_29/_40 wave). Background: migration journal idx 98–102 `when`
values were re-stamped after several environments had already applied them;
drizzle joins `__drizzle_migrations` tracking rows on `when`, so any env
holding pre-restamp tracking must be realigned BEFORE the next migrate or it
re-runs applied migrations and halts on a 42710 (unique/constraint) error.
Staging and dev were realigned 2026-09-19/20 (5 marker rows each); prod is
the remaining environment.

## 0. Preconditions (all must hold before step 1)

- [ ] User has given the explicit go for this window.
- [ ] Cut HEAD chosen; the journal at that HEAD is the single source of truth
      for `when` values. Read them fresh — never from this document:
      `python3 -c "import json;j=json.load(open('backend/drizzle/meta/_journal.json'));[print(e['idx'],e['when'],e['tag']) for e in j['entries'] if e['idx']>=97]"`
- [ ] No other lane is deploying; staging cuts are not in flight.

## 1. Backup FIRST (before any DB write)

- [ ] `pg_dump` the prod database from the postgres container to the droplet
      (timestamped path), e.g.:
      `ssh <prod-droplet> "docker exec <prod-postgres-container> sh -c 'pg_dump -U \$POSTGRES_USER \$POSTGRES_DB' | gzip > /root/prod-backup-$(date +%Y%m%d-%H%M%S).sql.gz"`
- [ ] Verify the backup: file size > 0, gzip integrity
      (`gzip -t`), and spot-check the dump tail for `PostgreSQL database dump
      complete`.
- [ ] Record the backup path here: `______________________________`

## 2. Read prod's current tracking (discovery, read-only)

- [ ] `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;`
      — capture the last ~8 rows.
- [ ] Identify which rows correspond to journal idx 97–102 by comparing to
      the journal read in step 0. Prod's tracked `when`s for those idx may be
      the ORIGINAL values (e.g. idx 98 = `1789814700000`, idx 99 =
      `1789815000000`, idx 100 = `1789816800000`, idx 101 = `1789815000001`,
      idx 102 = `1789815000002`) or something else — fill the table from
      what you actually see:

  | journal idx | current `when` (from journal) | prod tracked `when` (observed) | needs realign? |
  |---|---|---|---|
  | 92 | 1789744800000 | 1789719600000 (row id 93, original pre-restamp value) | YES — see §3-revised |
  | 97 | 1789826400000 | no tracking row — effect verified absent | n/a — applies fresh |
  | 98 | 1789839000000 | no tracking row — effect verified absent | n/a — applies fresh |
  | 99 | 1789844400000 | no tracking row — effect verified absent | n/a — applies fresh |
  | 100 | 1789848000000 | no tracking row — data-only, effect verified absent | n/a — applies fresh |
  | 101 | 1789849800000 | no tracking row — effect verified absent | n/a — applies fresh |
  | 102 | 1789851600000 | no tracking row — prod's `ports_code_unique` is the old plain index, not this partial variant | n/a — applies fresh (idempotent) |

- [ ] If observed == current for every idx: SKIP to step 4 (nothing to
      align). Never run alignment UPDATEs "just in case".

## 3. Marker-row alignment (exact-match UPDATEs, one transaction)

> **2026-09-20 census result: the five-pair template below does NOT hold on
> prod — do not run step 3 as written.** Prod holds exactly ONE divergent
> tracking row (idx 92) and zero rows for idx 93–102; effects for 93–105 are
> all verified absent, so nothing else needs realigning or marking. Run
> §3-revised below instead.

Rules: one UPDATE per row, matched ONLY on the exact observed `when` value;
wrap in BEGIN/COMMIT with pre/post counts inside the transaction. If any
pre-count differs from expectation → ROLLBACK and stop (the mapping table is
wrong; re-derive from step 2).

Template (fill `<observed_N>` from step 2, `<new_N>` from the journal; the
2026-09-19 restamp values were idx 98 = `1789839000000`, 99 =
`1789844400000`, 100 = `1789848000000`, 101 = `1789849800000`, 102 =
`1789851600000`):

```sql
BEGIN;
-- pre-count: must equal the number of rows you intend to realign
SELECT count(*) FROM drizzle.__drizzle_migrations
  WHERE created_at IN (<observed_98>, <observed_99>, <observed_100>, <observed_101>, <observed_102>);

UPDATE drizzle.__drizzle_migrations SET created_at = <new_98>  WHERE created_at = <observed_98>;
UPDATE drizzle.__drizzle_migrations SET created_at = <new_99>  WHERE created_at = <observed_99>;
UPDATE drizzle.__drizzle_migrations SET created_at = <new_100> WHERE created_at = <observed_100>;
UPDATE drizzle.__drizzle_migrations SET created_at = <new_101> WHERE created_at = <observed_101>;
UPDATE drizzle.__drizzle_migrations SET created_at = <new_102> WHERE created_at = <observed_102>;

-- post-counts: old must be 0, new must equal the row count you touched
SELECT count(*) FROM drizzle.__drizzle_migrations
  WHERE created_at IN (<observed_98>, <observed_99>, <observed_100>, <observed_101>, <observed_102>);
SELECT count(*) FROM drizzle.__drizzle_migrations
  WHERE created_at IN (<new_98>, <new_99>, <new_100>, <new_101>, <new_102>);
COMMIT;
```

- [ ] Pre-count matched expectation: ______
- [ ] Every UPDATE reported `UPDATE 1` (a second identical value would be a
      data problem — investigate, don't proceed).
- [ ] Post-counts: old = 0, new = ______ (expected number of realigned rows).
- [ ] Migrations already applied on prod stay untouched — this step is
      bookkeeping only; schema effects were verified live at each earlier
      cut.

Migrations NEWER than idx 102 (idx 103 invoice-policy alignment, idx 104
shipment code counter, anything landed after) apply FRESH in step 4 — no
alignment needed for them as long as the journal `when` ban holds
(append-only, `Date.now()`-based).

## 3-revised. Marker-row alignment — 2026-09-20 observed state

Prepared by the peer census lane 2026-09-20, superseding step 3 for this
window. Census executed strictly read-only against prod (single `BEGIN READ
ONLY` transaction, `ON_ERROR_STOP=1`) with the local dev DB (all 106 journal
entries applied, cursor at idx 105) as the fully-applied reference. Journal
anchor: commit 330cadaa. Re-verify anchors at window time: cut #6 may append
journal entries — appends are harmless (they apply fresh); only a RE-RESTAMP
would invalidate this plan (re-run the census if `max(created_at)` on prod
changes or idx 92's `when` in the journal moves off 1789744800000).

### Observed prod state (journal idx 92–105)

| idx | migration | prod observed | verdict |
|---|---|---|---|
| 92 | 20260918152000_shipment_container_raw_factory_route | `raw_factory_name` + `raw_route_name` present; tracking row id 93 holds the original pre-restamp `when` 1789719600000; file sha256 (6ef30ecb…f71617) equals the row hash — file unamended | APPLIED — realign `when` (3R-1) |
| 93 | 20260918210000_shipment_cost_locks | neither table exists | absent — applies fresh |
| 94 | 20260918144811_shipment_container_ps_actual | `ps_actual_amount`/`ps_actual_note` absent | absent — applies fresh |
| 95 | 20260919030413_slow_star_brand | `debit_note_lots` absent; `billing_documents_active_period_unique` (which 95 drops) still present | absent — applies fresh |
| 96 | 20260919131000_expense_type_category | `category` column absent | absent — applies fresh |
| 97 | 20260919140000_declaration_customs_channel | `channel` column absent | absent — applies fresh |
| 98 | 20260919173000_trip_children_trip_fks | 0 of 22 FK constraints | absent — applies fresh |
| 99 | 20260919190000_port_identity_out_of_code | `ports.is_lach_huyen` still present; `dispatch_zones.is_default` absent; its unique index absent | absent — applies fresh |
| 100 | 20260919200000_debit_trip_scope_backfill | data-only backfill; no tracking row; 0 unlinked active trips on prod (consistent) | absent — applies fresh |
| 101 | 20260919203000_shipment_children_fks | 0 of 40 FK constraints | absent — applies fresh |
| 102 | 20260919210000_ports_code_partial_unique | prod's `ports_code_unique` is the OLD plain index `ON (code)` with NO WHERE predicate — not this migration's partial variant; SQL is idempotent (IF EXISTS / IF NOT EXISTS) so fresh apply converts it cleanly | absent — applies fresh |
| 103 | 20260919213000_align_expense_type_invoice_policy | the five codes return 0 rows on prod (seed differs from dev) — UPDATE matches nothing | absent — applies as no-op |
| 104 | 20260919161608_shipment_code_counter | table absent | absent — applies fresh |
| 105 | 20260919163645_port_zone_surcharges | table absent | absent — applies fresh |

No interleaving: applied = {92} is a clean prefix of the re-apply window;
absent = {93–105} contiguous. Migrator semantics (drizzle-orm 0.45.2
`pg-core/dialect.js migrate()`: single max(created_at) cursor, applies every
journal entry with `when > cursor`, everything else silently skipped, all in
one transaction) would make any absent entry BELOW the new cursor skip
forever — that case does not occur here. Therefore: **no INSERT markers are
needed, and inserting any would be wrong** — a marker for an absent entry
would make migrate skip it permanently, and a marker for idx 92 would
duplicate its existing row instead of realigning it.

### 3R-1. Realign the one divergent row (one transaction, exact-match UPDATE)

Journal anchor (330cadaa): idx 92 `when` = 1789744800000. Prod row id 93
still carries the original 1789719600000. This is step 3's own template with
a single pair:

```sql
BEGIN;
-- pre-counts: if either differs from expectation → ROLLBACK and stop
SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1789719600000; -- expect 1
SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1789744800000; -- expect 0 (target free)

UPDATE drizzle.__drizzle_migrations SET created_at = 1789744800000 WHERE created_at = 1789719600000;  -- must report UPDATE 1

-- post-counts: old must be 0, new must be 1
SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1789719600000; -- expect 0
SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1789744800000; -- expect 1
COMMIT;
```

No `hash` update: the migrator compares `created_at` only (verified in the
0.45.2 source); prod's row hash still equals the unamended idx-92 file hash
(6ef30ecb…f71617, verified 2026-09-20).

### 3R-2. Pre-migrate verify (read-only)

- [ ] `SELECT max(created_at), count(*) FILTER (WHERE created_at = 1789744800000) FROM drizzle.__drizzle_migrations;` → 1789744800000 / 1
- [ ] Journal at the cut HEAD re-read per step 0: idx 92 = 1789744800000 (current journal value)
      and entries 93–105 all have `when` > 1789744800000
- [ ] If either check fails → STOP: re-run the census (queries + full outputs
      preserved in `plans/reports/census-260920-1057-prod-journal-realign.md`)
      and re-derive before touching anything.

### 3R-3. Then migrate (step 4)

Migrate applies idx 93–105 fresh, in journal order, one drizzle transaction
for all of it. Expected after success: 13 new tracking rows (ids 94–106),
max `when` = 1789853402000 (or higher if the cut appended idx 106+), and the
census probes flip to local's reference values: 22 trip FKs, 40 shipment
FKs, partial `ports_code_unique` WITH its WHERE predicate, `debit_note_lots`
exists and `billing_documents_active_period_unique` gone, `category` +
`channel` columns present, `shipment_code_counters` + `port_zone_surcharges`
tables present.

## 4. Migrate

- [ ] Run the deploy's migrate step per the standard prod runbook (`make
      deploy` flow / backend container `npx drizzle-kit migrate` with the
      prod DATABASE_URL).
- [ ] Expect: pending migrations apply cleanly; NO re-runs of idx ≤ 102. A
      `42710` (duplicate_object / constraint exists) or `23505` during
      migrate means tracking was NOT aligned — STOP, rollback per section 6,
      re-check step 2.

## 5. Post-condition verify

- [ ] Tracking sanity: re-run the step-2 SELECT — the aligned `when`s match
      the journal one-to-one, no duplicates, no gaps in idx order.
- [ ] Schema spot-checks for the wave's migrations (adjust to the cut):
      `to_regclass('shipment_code_counters')` is non-null (idx 104);
      `pg_indexes` shows `ports_code_unique` WITH its WHERE predicate (idx
      102); the FK census from the trip/shipment-children waves matches the
      approved policies.
- [ ] App health: the deployed backend answers `/api/health` and the payload
      carries the CURRENT `buildHash` (must equal the hash stamped at this
      cut, not the previous one); UI footer hash matches.
- [ ] Smoke: log in with a prod-safe account, open one shipment page, one
      financial page — pages render, no 5xx in the backend logs.

## 6. Rollback path (only if step 4/5 fails)

- App: redeploy the previous image/tag (the pre-cut build). Code rollback
  alone is safe — journal + tracking remain consistent.
- DB: restore the step-1 backup into a NEW database, verify row counts /
  app boot against it, then swap the connection. Do NOT hand-patch the live
  DB to "undo" a half-applied migration — restore instead. The backup
  predates every step above, so restoring also reverts any step-3 alignment
  (re-run steps 2–3 after a rollback, before any retry).
- Escalate to LEAD + user with the migrate error text before any retry.

## 7. After the window

- [ ] Record: backup path, alignment rows touched (if any), migrate output
      tail, buildHash, smoke results — into the wave's deploy notes.
- [ ] Reminder for SKILL.md (already codified): journal `when` is immutable
      post-ship; amendment = new migration; journal edits are append-only.

## 8. 2026-09-20 window execution record

- Window executed by the lead: 3R-1 realign (1789719600000 → 1789744800000)
  + migrate applied idx 93–105; prod tracking now 106 rows, cursor =
  1789853402000 (journal idx 105); postverify schema probes (9/9) +
  /api/health buildHash PASSED.
- Postverify when-list check flagged pre-idx-92 tracking rows whose stored
  `when` differs from today's journal (rows 71–74: 1789269610891–94 vs
  journal 1789269611890 / 1789269614890; row 81: 1789400000001 vs
  1789400001000; row 89: 1789570029711 vs 1789570029000; row 90:
  1789572048120 vs 1789572048000 — re-verified read-only 2026-09-20).
  **Finding (documented, no action taken):** these are restamp-era rows —
  the 2026-09-19 restamp rewrote journal `when` values for entries well
  below idx 92 (git -S traces the rewrites to bd6951f2 / 5b30c336) —
  and they sit OUTSIDE the census's idx 92–105 scope. Bookkeeping-only
  under cursor semantics: every flagged row is BELOW the post-realign
  cursor (1789744800000), and the migrator only applies entries with
  `when > max(created_at)`, so no re-run is possible; those migrations'
  effects shipped long ago under the stored original values. Left as-is:
  no UPDATEs without explicit user re-authorization (prod halted,
  user directive 2026-09-20).

## 9. 2026-09-20 window #2 execution record (pricing-and-billing wave)

- Trigger: user order "once done deploy to staging and prod" after the wave
  drained QA_PASSED (35 cards, cut #8 + cut #9 both green on staging).
- Backup: /root/prod-backup-20260920-152552.sql.gz (1,039,249 bytes, gzip OK,
  "PostgreSQL database dump complete" verified) — taken before any write.
- Preflight: prod cursor 1789853402000 (idx 105), single row, row93 intact;
  no new journal entries in the wave (last idx still 105) → migrate no-op.
- Deploy: `make deploy` exit 0, clean tree at 8fe28cbd (includes cut #9).
- Postverify: schema probes 9/9 PASS, /api/health ok, buildHash = 8fe28cbd
  (matches cut). When-list FAIL is the SAME documented restamp-era finding as
  window 1 (§8): pre-idx-92 rows hold pre-restamp whens, below the cursor,
  bookkeeping-only, no action.

## 10. 2026-09-20 window #3 execution record (UX overhaul wave, cuts #10-13)

- Trigger: user order "once done deploy to staging and prod" after the second
  wave drained (customers overhaul, filter grid, and the 7 defect cards).
- Backup: /root/prod-backup-20260920-090112.sql.gz (BE pre-staged, 1,042,109
  bytes, complete-marker verified) + the deploy's own server-side backup.
- Preflight: PASS (cursor 1789853402000, row93 intact; no new migrations —
  journal idx still 105, migrate no-op).
- Staging cuts: #10 (3dc7cd82), #11 (452bc6e6), #12 (731cac7f), #13 (3682733a)
  — each with buildHash match + asset guard OK; rung sheets Y/Z + delta + the
  7-card sheet, all green.
- One refused first attempt (dirty tree from mid-flight _45/_46 test-infra
  WIP) — resolved by land-or-park: 427f45f4 + f239e787 landed, tree clean.
- Deploy: `make deploy` exit 0 at f239e787. Postverify: probes 9/9, health ok,
  buildHash match; when-list = the same documented restamp-era finding.

## 11. 2026-09-20 window #4 execution record (workboard quick-edit wave)

- Trigger: explicit user go-ahead ("Deploy to prod now") via the lead's
  approval question after `_49`+`_51` drained QA_PASSED on staging cut #14.
- Ships: `_49` (44add77e — workboard schedule/notes quick-edit opened to
  CUS/ADMIN/DISPATCHER) + `_51` (7aedcfed — both note fields decoupled from
  the accounting lock across FE trigger / fieldAccess / update-route tiers)
  + wave-close docs (b1d23b63 openwiki reconciliation).
- Backup FIRST: /root/prod-backup-20260920-215350.sql.gz (1,051,629 bytes,
  gzip -t OK, "PostgreSQL database dump complete" verified via zcat tail).
- Journal re-read at HEAD: 106 entries, idx 105 = 1789853402000 unchanged,
  idx 92 = 1789744800000 → no new migrations this wave, migrate no-op.
- Preflight: PASS by inspection — max_when 1789853402000 (= journal idx 105),
  old_rows 0, row93_when 1789744800000, row93_hash 6ef30ecb823b intact. The
  script's printed FAIL is its hard-coded FIRST-window expectation (cursor
  == pre-realign value) and does not apply from window #2 onward.
- Deploy: `make deploy` exit 0 at b1d23b63; health ok, buildHash match.
- Postverify: schema probes 9/9 PASS, tracking 106 rows with cursor
  unchanged, /api/health ok + buildHash = b1d23b63. When-list FAIL = the
  SAME documented restamp-era finding as §8 (all diffed rows BELOW the
  cursor, bookkeeping-only, effects shipped long ago; left as-is per the
  standing user directive — no prod UPDATEs without explicit
  re-authorization).
