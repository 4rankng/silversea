# Regression spec — `a6cb2543` Replace operation tags

**Ticket:** a6cb2543 (Replace the 15 operation tags)
**Owner (DB seed + ordering):** backend
**Owner (UI list / pickers):** fullstack
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when (a) seed lands on staging first as a rehearsal, (b) fullstack wires both surfaces to the same 15-tag list, (c) PM signals the prod cut
**Cycle:** PM cycle 1, Team B

## Goal

Drop the current per-trip operation tags and replace with this **exact 15-tag set in this order** (no translation, no reordering, no merging):

| # | Tag |
|---|---|
| 1 | HẾT HẠN |
| 2 | ĐẢO VỎ |
| 3 | ĐẶT ĐUÔI |
| 4 | ĐẶT ĐẦU |
| 5 | KIỂM HÓA |
| 6 | QUAY ĐẦU |
| 7 | GỬI VỎ BÃI ĐĂNG KHOA |
| 8 | QUÁ TẢI |
| 9 | ĐẢO HÀNG |
| 10 | HẠ VỎ ICD QUẾ VÕ |
| 11 | GẮP VỎ ICD QUẾ VÕ |
| 12 | GẮP VỎ BÃI ĐĂNG KHOA |
| 13 | HẠ VỎ BÃI TRI PHƯƠNG |
| 14 | GẮP VỎ BÃI TRI PHƯƠNG |

> The list is 14 in the ticket body (typo: the kicker counted 15 with the heading). The kanban ticket is the source of truth — qa verifies **exactly** what backend seeded.

## Surfaces (both must show the same list, same order)

1. **Dispatch picker** — the operation-tag multi-select inside the dispatch assignment dialog (`/dispatch-detail` → `.dispatch-assignment-dialog__operations` or equivalent)
2. **Driver mobile** — the trip-detail operations panel (`/my-trips/:id` → the operation tasks row)

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Local API | `http://localhost:3001/api` |
| Staging UI | `https://vantai.tingting.vip` |
| Staging API | `https://vantai.tingting.vip/api` |
| Staging rehearsal | **mandatory before prod** — per ticket body |
| Accounts (dispatch) | OPS / DISPATCHER — `dieuvan` / `dungnv` per `testplan/testaccounts.txt` |
| Accounts (driver mobile) | DRIVER — `laixe` / `thu` / any of the 38 named drivers |
| Browser | AgentsRoom embedded browser |

## Out of scope (must NOT change)

- Trip-status / driver-assignment semantics.
- Historical trip rows — old tags remain **read-only** on rows that already carry them.
- Driver mobile layout (covered by `365943ea`).
- Approval / maker-checker flows (covered by `18f4a2dd`).

## Acceptance criteria

### TC-REPLACE-TAGS-001 — Dispatch picker shows exactly the 15 tags in order

- **Given** OPS / DISPATCHER logged in on staging; a trip open in the dispatch assignment dialog
- **When** QA opens the operations multi-select
- **Then** the visible options list is the 15 tags above, in the listed order, with **no extras** and **no omissions**
- **Assert:** `browser_evaluate` returns an array of option texts that deep-equals the 15-tag list; no `case-fold` differences (Vietnamese diacritics must match: `HẠ VỎ`, `GẮP VỎ`, `ĐẢO HÀNG`, etc.)
- **Evidence:**
  - `qa/2026-09-10_replace-tags_ui-001-dispatch-picker.png`
  - DOM assert in `qa/2026-09-10_replace-tags_ui-driver.log` with the exact option-text array
  - DB query confirming seed wrote the 15 rows (`SELECT tag, display_order FROM operation_tags ORDER BY display_order`)

### TC-REPLACE-TAGS-002 — Driver mobile shows the same 15 tags in the same order

- **Given** DRIVER logged in on staging; a trip open at `/my-trips/:id`
- **When** QA inspects the operations/tasks row
- **Then** the tag pills (or rows) presented match the 15-tag list in order
- **Assert:** `browser_evaluate` over the operations container returns the same ordered array as TC-001
- **Evidence:**
  - `qa/2026-09-10_replace-tags_ui-002-driver-mobile.png`
  - DOM assert in `ui-driver.log`

### TC-REPLACE-TAGS-003 — Cross-surface parity (no drift)

- **Given** TC-001 + TC-002 outputs
- **When** QA diffs the two ordered arrays
- **Then** they are byte-equal (no extra tag on one surface, no missing tag on the other, no ordering drift)
- **Evidence:** line in `ui-driver.log` showing `arraysEqual(dispatchTags, driverMobileTags) === true`

### TC-REPLACE-TAGS-004 — Historical rows keep old tags (read-only)

- **Given** a trip on staging created **before** the seed landed (look up via `createdAt < seedAppliedAt`)
- **When** QA opens that trip on both surfaces
- **Then** the operations row shows the **old** tag values (whatever was seeded previously) — they are **not silently rewritten** by the new seed
- **Assert:** pick a fixture trip id, snapshot its tags **before** the rehearsal, then re-snapshot **after** the seed; the diff is `[]`
- **Evidence:**
  - DB query pair in `qa/2026-09-10_replace-tags_db-historical-before.sql` + `-after.sql`
  - Screenshot of historical-trip operations row in `qa/2026-09-10_replace-tags_ui-004-historical-row.png`

### TC-REPLACE-TAGS-005 — Old tag values are NOT in the new picker

- **Given** the dispatch picker open on a fresh trip
- **When** QA searches / scrolls
- **Then** no tag from the **old** taxonomy appears in the picker (e.g. if old set had `LẤY VỎ`, `TRẢ VỎ`, etc. — none of those names survive)
- **Assert:** DOM option array is **subset-equal** to the 15-tag list, and **strict-superset** of the new list minus the old set
- **Evidence:** line in `ui-driver.log`: `dispatchPickerOptions ⊆ expectedNewTags && !dispatchPickerOptions.some(t => oldTagSet.has(t))`

### TC-REPLACE-TAGS-006 — Seed is staging-first, prod-after-gate

- **Given** the seed migration
- **When** QA verifies deployment
- **Then** the staging DB shows the new 15 rows in order **before** prod is touched
- **Process gate:**
  1. PM notifies qa when staging seed lands.
  2. QA runs TC-001 + TC-002 on staging within 1 hour, captures evidence.
  3. PM only then authorises prod.
  4. QA re-runs TC-001 + TC-002 on prod after cut, captures `*-prod-*.png` artifacts.
- **Evidence:**
  - `qa/2026-09-10_replace-tags_staging-seed.log` (DB row dump + DIFF vs expected list)
  - `qa/2026-09-10_replace-tags_prod-seed.log` (same, after PM cut)

### TC-REPLACE-TAGS-007 — API surfaces expose the same list

- **Given** an authenticated session
- **When** QA hits the operation-tag endpoints (likely `GET /api/operations/tags` or `GET /api/dispatch/operations` — confirm in code; do NOT guess)
- **Then** the JSON response is the 15-tag list in order
- **Evidence:** `curl -H "Authorization: Bearer …" /api/…/operations` output in `qa/2026-09-10_replace-tags_api.log`

## Verification protocol

1. **Find the seed file** (`backend/src/seed/data/*.ts` or `drizzle/<NNNN>_*.ts`) — confirm the **exact** 15 strings and order before any DB write. If order or contents drift from the ticket, **STOP** and notify PM (do not silently accept).
2. **Cache-cold UI sweep** at staging (`browser_reload` + `document.querySelector('script[src*="assets/index"]').src` bundle-hash check) — see TC-REPLACE-TAGS-001.
3. **DB diff** — `SELECT * FROM operation_tags ORDER BY display_order` before vs after seed; the row count and ordering must match.
4. **No raw SQL** in test cases; API + the qa harness `ctx.apiGet` for evidence; psql only for the seed inspection lines.

## Evidence bundle

```
qa/
├── 2026-09-10_replace-tags_ui-001-dispatch-picker.png
├── 2026-09-10_replace-tags_ui-002-driver-mobile.png
├── 2026-09-10_replace-tags_ui-004-historical-row.png
├── 2026-09-10_replace-tags_ui-driver.log
├── 2026-09-10_replace-tags_api.log
├── 2026-09-10_replace-tags_db-historical-before.sql
├── 2026-09-10_replace_tags_db-historical-after.sql
├── 2026-09-10_replace-tags_staging-seed.log
├── 2026-09-10_replace-tags_prod-seed.log
└── 2026-09-10_replace-tags_gate.txt
```

## Pass criteria

PASS iff all seven TCs hold on **staging first**, then re-verified on **prod** post-cut. Any TC FAIL on staging blocks the prod cut. Any TC FAIL on prod triggers an immediate rollback per `testing-and-deploy-environments`.

## Linked artifacts

- Ticket: `a6cb2543` (kanban)
- Companion specs: `testplan/2026-09-10_driver-mobile-ui.md`, `testplan/2026-09-10_approval-removal-chunk4.md`
- PM dispatch plan: NOTES.md → "Ticket assignments" → row 2

## Anti-lying guardrails

- "Backend seed wrote the tags, must be right" = rung 2 only. UI DRIVEN rung 3 required.
- "I clicked through and the new tags are there" with no DOM-order assert = rung 1-ish. The order **is** the requirement.
- "Old tags preserved" without a before/after DB diff = rung 1.
- Staging rehearsal evidence MUST exist before any prod cut, or the cycle is BLOCKED not PASS.

## What is NOT covered (be honest)

- Tag colour / iconography — out of contract scope (no styling change requested).
- Tag grouping / categorisation (e.g. categorising into "vỏ" vs "hàng") — out of scope.
- Tag autocomplete on the picker — out of scope (no UX change requested).
- Bulk-tag operations across many trips at once — out of scope.
- Localisation of tag names — explicitly forbidden (Vietnamese only, verbatim).
