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
  | 97 |  |  |  |
  | 98 |  |  |  |
  | 99 |  |  |  |
  | 100 |  |  |  |
  | 101 |  |  |  |
  | 102 |  |  |  |

- [ ] If observed == current for every idx: SKIP to step 4 (nothing to
      align). Never run alignment UPDATEs "just in case".

## 3. Marker-row alignment (exact-match UPDATEs, one transaction)

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
