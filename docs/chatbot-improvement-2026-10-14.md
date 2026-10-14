# Chatbot (bot.tingting.vip) — Read-Only Review

**Date:** 2026-10-14
**Scope:** Read-only investigation. No config changes, no restarts, no writes to the server.
**Target:** `bot.tingting.vip` → `143.198.221.92` (host `vfic-bot`), pinned in `~/.ssh/config`
to bypass a stale second DNS A record (`165.232.168.242`) that answers SSH but runs no app.
**Source audited:** `/Volumes/LexarSSD/projects/chatbot`, `origin=git@github.com:4rankng/vfic-chatbot.git`,
branch `main`, HEAD `e74355be` — the exact commit behind the running image
`ghcr.io/4rankng/tinghire-be:e74355be`. `git diff e74355be..HEAD` is empty, so every source
finding below describes code that is actually running in production.

Note: `~/Documents/projects/ChatBot` is **not** a repo — it contains only an empty
`Claude outputs/` directory. The real checkout is on the LexarSSD volume.

---

## Fleet state (2026-10-14 15:43 UTC)

15 containers running from `/opt/vfic/docker-compose.yml` (project `vfic`). All report
`healthy` except `vfic-metrics-watch-1`, which has **no healthcheck at all**.

| Container | Image | Uptime | Memory |
|---|---|---|---|
| vfic-web-blue-1 | tinghire-be:e74355be | 3 days | 270.9MiB / 512MiB (52.9%) |
| vfic-worker-chatbot-593..596 (4) | tinghire-be:e74355be | 3 days | ~155MiB / 512MiB (30%) |
| vfic-worker-maintenance-1 | tinghire-be:e74355be | 3 days | 31.9MiB / 384MiB |
| vfic-frontend-1 | tinghire-fe:96dfe73b | 4 days | 3.3MiB / 64MiB |
| vfic-postgres-1 | pgvector/pgvector:pg16 | 2 weeks | **401.8MiB / 448MiB (89.4%)** |
| vfic-caddy-1 / redis-1 | caddy:2 / redis:7-alpine | 2 weeks | healthy |

Stale exited containers still present: `vfic-web-green-1`, `vfic-oa-profile-backfill-1` (3 days),
`vfic-adminer-1` (2 weeks).

Host: 2 vCPU, 3915 MiB RAM, load **4.16 / 3.62 / 3.51** (~2× core count). Disk 18% of 77G.
Database 198 MB. Webhook volume: 69 new conversations in 24h.

**Version drift:** frontend image is `96dfe73b` (2026-10-10) vs backend at `e74355be` (2026-10-11),
2 commits behind. `git diff 96dfe73b..HEAD -- frontend/` is **empty** — the two unpulled commits
touch backend only. No functional frontend drift; the tag skew is cosmetic.

---

## Top 5 improvements, ranked by impact

### 1. `run_knowledge_recovery_tick` has failed 100% of executions — orphan recovery is entirely dead

**Impact: critical.** The job that recovers knowledge-ingest work orphaned by dead workers has
never completed a single run. Every crash of `worker-ingest`/`worker-category` now leaves
permanently stuck documents and revisions that nothing will ever fail or release.

**Evidence.** In `backend/app/services/knowledge/recovery_sweep.py`, three queries inside
`async def` functions call `.all()` on the coroutine returned by `db.scalars(...)` instead of
awaiting it:

- `recovery_sweep.py:145-153` — `_sweep_abandoned_training_batches`
- `recovery_sweep.py:210-220` — `_abandon_training_batch` (revisions query)
- `recovery_sweep.py:233-239` — `_abandon_training_batch` (child documents query)

Contrast the correct sites in the same file, which do `await db.execute(...)`
(`recovery_sweep.py:253`, `:280`).

Production log (`vfic-worker-maintenance-1`, 24h):

```
AttributeError: 'coroutine' object has no attribute 'all'
```

**153 occurrences since the container started on 2026-10-11** — every 30 minutes without
exception (48 in the last 24h alone). The failure is on the first statement of the sweep, so
all three legs (`training_batches`, `orphan_documents`, `orphan_revisions`) return nothing.

**Why tests did not catch it.** `backend/tests/test_knowledge_recovery_sweep.py:51` defines
`FakeSession.scalars()` as a **synchronous** method returning `SimpleNamespace(all=lambda: rows)`
(`:53-55`). A sync fake makes the missing-`await` code valid, so the suite passes against a
shape that cannot exist on a real `AsyncSession`. This is precisely the failure mode the report
at `plans/reports/diagnosis-261004-2149-samsung-sds-ingest-error.md:89-90` claims the tests
already caught once — it recurred.

**Live backlog consistent with the dead sweep:** 8 `STAGED` revisions sharing parent
`9fb7b428-be4f-4296-8910-bb121fd8b1de`, all created `2026-10-01 16:31:08Z` with
`processing_token IS NULL` — orphaned 13 days, unreachable by any retry path.

**Recommendation:** add `await` at the three `.all()` sites; make `FakeSession.scalars`/`execute`
`async def` so the fake matches `AsyncSession`; add a regression test that a real or
async-faithful session sweep completes all three legs.

---

### 2. Real-time conversation events fail on lazy ORM loads — `MissingGreenlet`, silently swallowed

**Impact: high.** `conversation.updated` publishes raise on every inbound message whose
conversation relationship was not eagerly loaded. The failure is caught, downgraded to WARNING,
and the recruiter UI silently stops live-updating. Users see stale conversation state with no
error surfaced.

**Evidence.** `backend/app/services/conversation/events.py:37`:

```python
def _conv_payload(conv) -> dict:
    return ConversationOut.model_validate(conv).model_dump(mode="json")
```

Production traceback from `vfic-web-blue-1` (6 occurrences in 24h, 2026-10-13 20:02 through
2026-10-14 13:34):

```
File "/app/app/services/conversation/bot_path.py", line 461, in record_inbound
    await self.events.conversation_updated(conv)
File "/app/app/services/conversation/events.py", line 52, in conversation_updated
    await publish_event("conversation.updated", _conv_payload(conv))
File "/app/app/services/conversation/events.py", line 37, in _conv_payload
    return ConversationOut.model_validate(conv).model_dump(mode="json")
pydantic_core._pydantic_core.ValidationError: 1 validation error for ConversationOut
contact.primary_channel
  Error extracting attribute: MissingGreenlet: greenlet_spawn has not been called;
  can't call await_only() here.
```

`ConversationOut` declares nested `contact: ContactSummaryOut | None`
(`backend/app/schemas/conversation.py:60`); `from_attributes=True` (`:44`) makes pydantic walk
into `Contact.primary_channel`, which triggers a lazy load on an async session outside a
greenlet. The swallow at `bot_path.py:461-467` logs
`"inbound realtime events failed; message is durable"` — durable, but not live.

**Coverage gap.** `backend/tests/integration/test_first_message_resilience.py:55`
(`test_created_conversation_carries_loaded_relationships`) asserts eager loading via
`conv.__dict__` but never calls `_conv_payload`. The only test that exercises
`ConversationOut.model_validate` (`test_concurrency.py:414`) monkeypatches `_conv_payload` away
entirely. **There is no test anywhere in the suite that forces an exception through the
realtime seam** — `grep 'side_effect=Exception' backend/tests` → 0 hits.

**Secondary:** `app/services/realtime.py:34` swallows without `exc_info`, discarding tracebacks
one level further down.

**Recommendation:** eager-load `contact.primary_channel` (or serialize explicitly instead of via
`from_attributes`) in `record_inbound`; add `exc_info` to the `realtime.py` swallow; add a test
that calls `_conv_payload` against a real ORM conversation.

---

### 3. Postgres is pinned at 89% of its 448 MiB cap with no headroom, on a saturated 2-vCPU host

**Impact: high and rising.** A memory-pressure spike has roughly 46 MiB of headroom before the
container is OOM-killed — which would take the database down, not just slow it. Load average is
sustained at ~2× the core count.

**Evidence.**

```
docker stats: vfic-postgres-1  401.8MiB / 448MiB  89.41%
HostConfig.Memory: 469762048 (448 MiB)
/proc/loadavg:   4.16 3.62 3.51 11/587
Host: Mem 3915 total / 2149 used / 1766 available, swap 48MiB of 4095 used
```

Database size is only 198 MB, so the footprint is Postgres runtime + shared buffers, not data
volume. The top CPU consumers at snapshot time were `dockerd` (16.2%) and `containerd` (17.7%);
no application container exceeded 0.86% CPU — the load is spread across infrastructure overhead
on only 2 cores.

**Recommendation:** raise the postgres memory limit (or tune `shared_buffers`/`work_mem` to the
new bound) and confirm the 448 MiB cap was deliberate; add container-level memory alerting at
~80% so this is caught before OOM.

---

### 4. Nothing alerts on swallowed errors — the whole class of failures above is invisible by construction

**Impact: high (systemic).** Every failure in findings 1 and 2 was discoverable only by reading
container logs. There is no escalation path from a WARNING-level swallow to a human.

**Evidence.**

- No APM or exception reporting anywhere: `grep -rl 'sentry|prometheus|opentelemetry' backend/app`
  → **0 files**; none in `pyproject.toml` dependencies.
- `/metrics` (`app/main.py:198-236`) exposes RQ queue depths, `Worker.count` and nine
  `reconcile_*` counters (`main.py:222-232`). **No realtime/publish/payload-failure counter
  exists.**
- `scripts/ops-alerts.sh:9-12` polls `/metrics` for queue depth, worker saturation and reconcile
  counters — so it structurally cannot see the `_conv_payload` failure. Its cron install is
  itself still outstanding (`ops-alerts.sh:20-22`).
- `/health` (`main.py:192`) and `/health/queue` (`main.py:238`) report liveness and queue
  pressure only.
- The near-alert path, `app/services/push/service.py:124 alert_once(...)`, is itself wrapped in
  `except Exception: # noqa: BLE001 — an alert must not break the sweep`
  (`reconcile_worker.py:230`, `zalo.py:332,359`) — **alerts fail silently too.**
- `vfic-metrics-watch-1` has no healthcheck and produced 0 log lines in 24h.

**Recommendation:** add counters for realtime publish failures and per-job exceptions, export
them on `/metrics`, install the `ops-alerts.sh` cron, and give `metrics-watch` a healthcheck.
Also note the convention that a WARNING swallow is the *designed* terminal state
(`events.py:89-93`, `bot_path.py:463-467`, `lanes.py:1310`) is documented nowhere — `grep` for
`BLE001|broad except` across `AGENTS.md`, `backend/AGENTS.md`, `.claude/CLAUDE.md` returns zero
hits.

---

### 5. Dead scheduler entries and unenforced lint/test gates let defects ship silently

**Impact: medium.** Three stale rq-scheduler jobs and a broken lint/test contract compound the
runtime failures above.

**Evidence — phantom jobs.** `rq:scheduler:scheduled_jobs` contains eight jobs; two point at
worker modules that do not exist:

```
vfic-tick-run_external_source_sync_tick
vfic-tick-run_single_page_external_source_sync_tick
```

`app/workers/` has neither `external_source_sync_worker.py` nor
`single_page_external_source_sync_worker.py`. The feature was removed by migration
`alembic/versions/0067_drop_external_source_sync.py:23`, but the registry entries survive in
Redis. Each fire raises:

```
ValueError: Invalid attribute name: run_single_page_external_source_sync_tick
AttributeError: module 'app.workers' has no attribute 'external_source_sync_worker'
```

**Evidence — lint.** `[tool.ruff]` sets only `line-length` and `target-version`
(`backend/pyproject.toml:64-66`); there is no `[tool.ruff.lint] select`, and `Makefile:66`
invokes bare `ruff check .`. The default select (`E4,E7,E9,F`) excludes `BLE`, so all
**231 `# noqa: BLE001` labels across the backend enforce nothing** — they are decorative
commentary, not a gate.

**Evidence — test gate.** `Makefile:66` runs
`pytest -q -m "not integration" --cov --cov-config=.coveragerc`. All **48 `integration`-marked
tests are excluded** from the default gate — and those are precisely the tests that exercise
real ORM objects with real selectin relationships (see finding 2). Every relationship-eager-load
guard lives outside the gate that is supposed to be green.

**Evidence — CI.** `.github/` contains only `dependabot.yml`; there are no workflows. Gates run
locally and are not enforced on push.

**Recommendation:** purge the two stale scheduler entries from `rq:scheduler:scheduled_jobs`;
enable `BLE` in the ruff select so the existing `noqa` labels become meaningful (and audit the
36 unlabelled `except Exception` sites); decide whether the `integration` suite belongs in the
release gate; add a CI workflow running `make release-check`.

---

## Also observed (not ranked)

- **Zalo OA misrouting.** 76 events in 24h log
  `zalo oa event for an unlinked oa_id length=19 -> default account`
  (`app/channels/providers/zalo_account.py:113-116`). The linked TingTing OA is present and
  valid — `channel_accounts` row `zalo_oa / tingting`, `ACTIVE`, metadata
  `oa_id=3383849659955472174`, `verified_at=2026-09-28`. The linked id is also 19 digits, so
  length alone cannot distinguish it. Worth instrumenting with a hashed id to confirm whether
  this is a genuinely different OA or a parsing/normalization mismatch. Routing falls back to the
  default account rather than dropping events, so no messages are lost.
- **Facebook account paused.** `channel_accounts` shows
  `facebook_messenger / 486833177846024` with `bot_paused=t` while the other three accounts are
  `f`. Consistent with the recent pause work in `e74355be`, but worth confirming it is intended
  rather than left over from debugging.
- **Clean 24h elsewhere.** `vfic-frontend-1` (8526 lines, 0 errors), `vfic-caddy-1`,
  `vfic-redis-1` and `vfic-postgres-1` produced zero error lines. `vfic-worker-chatbot-593`,
  `worker-ingest`, `worker-persistence`, `worker-category` were all clean.
- **Stale containers.** `vfic-web-green-1` and `vfic-oa-profile-backfill-1` (exited 3 days ago),
  `vfic-adminer-1` (exited 2 weeks ago) remain defined.

---

## Verification method

All figures from `docker logs --since 24h`, `docker stats --no-stream`, `docker inspect`,
`/proc/loadavg`, and read-only `SELECT` queries via `psql -U vfic -d vfic` (no writes, no locks,
no state changes). Source claims verified against the checkout at `e74355be`, confirmed identical
to the running image. No server file was modified, no container was restarted, and no deployment
action was taken.