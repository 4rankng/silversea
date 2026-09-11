# Regression spec — `36d0183d` Driver-app enhancements (lái xe mobile)

**Ticket:** 36d0183d (driver mobile trip-detail polish + operational chips + invoice/POD)
**Owner (implement):** fullstack (FE primary; BE gates FE with data contracts)
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when fullstack lands + staging cut
**Cycle:** PM cycle 1, Team B (wave 2026-09-11)

## Goal

Surface the driver app's trip-detail / operational block with the user's preferred polish. Decomposed scope (per ticket text, 2026-09-11):

1. **Collapsible chips** — operation-task chips collapse/expand so a long task list doesn't push the layout.
2. **Route line = factory ADDRESS** (not the factory NAME) — route line shows the actual factory address text, not the human-readable factory name; matches the dispatcher ledger.
3. **Kho phone** — show the storage facility's phone number on the trip detail (where data exists).
4. **Remove đầu kéo / mooc fields** — drop the tractor/trailer plate fields the user no longer uses (data may still be in the DB but UI no longer shows them on the driver mobile screen).
5. **Invoice block (MST / company / address)** — show invoice tax-code + company name + address block where master data exists; hide gracefully when missing.
6. **Đóng / trả chip** — render a single chip indicating the trip's close-status (Đóng = locked-final, Trả = returned-to-customer); one chip, not two stacked labels.
7. **POD biên bản photo** — POD (proof of delivery) photo uploadable; reuse the existing evidence-photo upload pattern; tap → full detail.

Confined to the driver mobile surface. Web dispatcher surfaces, master-plan, and reports are NOT in scope.

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Local API | `http://localhost:3001/api` |
| Staging UI | `https://vantai.tingting.vip` |
| Staging API | `https://vantai.tingting.vip/api` |
| Driver mobile surface | `/my-trips/:id` (`DriverTripDetailPage.tsx`) |
| Account (local demo) | `laixe` / `thu` per `testplan/testaccounts.txt` |
| Account (staging) | any DRIVER from `testplan/testaccounts.txt` |
| Browser | AgentsRoom embedded browser (`browser_set_viewport` for 360 / 390 / 768) |
| NO prod access | deploy + bare health only, per AGENTS.md |

> Pick the driver that already has an assigned trip on the chosen env (probe `/api/driver/me/trips` after login). **NO driver creation in this cycle** — only the existing seeded drivers.

## Out of scope (must NOT change)

- Field schema (no new columns beyond what BE probes provide).
- The field-order reordering on the trip-detail (covered by `365943ea` — separate spec, frozen reference).
- Operation-tag taxonomy itself (covered by `a6cb2543`).
- Approval / maker-checker flows (covered by `18f4a2dd`).
- CUS-side / dispatcher-side surfaces.

## Acceptance criteria — UI contract (rung 3 required)

Each criterion below is rung 3 (`UI DRIVEN`): must be backed by a post-click screenshot + DOM assert + driver log.

### TC-DA-001 — Collapsible chips: long task list collapses by default

- **Given** driver logged in on staging; viewport 390 px; trip with **N ≥ 6** operation tags attached (the typical dense case)
- **When** the bento block renders
- **Then**:
  - Only the first ~4 chips are visible by default
  - A "Mở rộng / Thu gọn" toggle is present and labelled in Vietnamese
  - Clicking the toggle reveals ALL chips and re-labels the toggle
  - Clicking again collapses back to the default
- **Assert:**
  - `browser_evaluate(() => Array.from(document.querySelectorAll('[data-testid="operation-chip"], .dispatch-assignment-dialog__operations .chip, [class*="operation-chip"]')).length)` returns the visible chip count
  - Default (collapsed) count ≤ 4; after toggle = N
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-001-collapsed.png`
  - `qa/2026-09-10_driver-app-enhancements_ui-001-expanded.png`
  - DOM asserts in `ui-driver.log`

> **Architect amendment (2026-09-11):** the detail wire embeds `knownTagLabels[]` — the SAME contract the journey-board response carries since 320aad6b — and the FE resolves chips by reusing `parseNote` from `lib/dispatchTaskTags`, exactly as `DriverTripsPage` does. NO backend parseNote-equivalent: tag-resolution logic stays in one place.

### TC-DA-002 — Route line shows factory ADDRESS, not factory name

- **Given** driver trip on staging where the shipment has a factory with both `factoryName` ("Nhà máy ABC") and `factoryAddress` ("123 Nguyễn Văn A, Bình Dương")
- **When** the trip-detail renders
- **Then**:
  - The "Tuyến" row carries the **address** string, NOT the factory name
  - The address matches the dispatcher master-plan's route line for the same shipment (no drift)
- **Assert:**
  - `browser_evaluate` over the "Tuyến" row returns text matching `/123 Nguyễn Văn A/` (the address)
  - Same row's text does NOT start with the factory name
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-002-route-address.png`
  - Cross-check: master-plan row's "Tuyến" cell captured for parity
- **Anti-lying:** "code says factoryAddress is used" without the rendered row text = rung 1. The rendered text IS the requirement.

### TC-DA-003 — Kho phone shown where data exists; hidden where missing

- **Given** driver trip on staging
- **When** the trip-detail renders
- **Then**:
  - If the master-data row carries a `khoPhone` (e.g. `0901234567`), the trip-detail shows a "Kho: 0901234567" (or Vietnamese-equivalent) label
  - If `khoPhone IS NULL`, the label is **not rendered** (no empty dash, no "—" placeholder) — graceful hide
- **Assert:**
  - `browser_evaluate` on the kho block: phone matches `/0[0-9]{9,10}/` when present; not present when null
  - DB-side: `SELECT contact_phone FROM operational_sites WHERE id = $1` (the trip's container factory/kho site) matches the rendered phone string OR is NULL. *(Architect amendment 2026-09-11: no `kho_phone` column exists anywhere — the spec's original `shipment_containers.kho_phone` probe was wrong. Render source = `operational_sites.contact_phone` (structured single value, nullable). `warehouse_contact_info` is free-text multi-phone and is NOT the render source.)*
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-003a-with-phone.png`
  - `qa/2026-09-10_driver-app-enhancements_ui-003b-without-phone.png` (master-data trip with NULL kho_phone)

### TC-DA-004 — Đầu kéo / mooc fields removed from driver mobile

- **Given** driver trip on staging (regardless of whether the row carries đầu kéo / mooc data — the BE probes confirm whether they're still in the API response)
- **When** the trip-detail renders
- **Then**:
  - No "Đầu kéo" or "Mooc" label appears on the mobile surface
  - The row data (if any) is still preserved in the API response (we drop the UI surface only)
- **Assert:**
  - `browser_evaluate(() => /Đầu kéo|Mooc/.test(document.body.innerText))` returns false
  - API: `GET /api/driver/me/trips/:id` body may or may not still include tractor/trailer fields — confirm via BE probe; the absence from UI is the requirement, the API is the BE owner's call
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-004-no-tractor.png`
  - BE probe log: `qa/2026-09-10_driver-app-enhancements_api-004.log`

### TC-DA-005 — Invoice block: MST / company / address

- **Given** driver trip on staging where the shipment's CUS / factory row carries invoice master data (`taxCode` / `companyName` / `address`)
- **When** the trip-detail renders
- **Then**:
  - The invoice block shows three fields, in order: MST (tax code), Tên công ty (company name), Địa chỉ (address)
  - Each field uses the Vietnamese label exactly (not transliteration, not English fallback)
  - If master data is missing, the block is hidden (no empty placeholder rows)
- **Assert:**
  - `browser_evaluate` over the invoice block returns three labelled rows
  - The label text deep-equals the expected Vietnamese labels
  - DB query: `SELECT tax_code, company_name, address FROM customers WHERE id = $1` matches the rendered values (when present)
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-005a-invoice-with-data.png`
  - `qa/2026-09-10_driver-app-enhancements_ui-005b-invoice-hidden.png` (trip without master data)

### TC-DA-006 — Đóng / trả chip

- **Given** driver trip on staging with a known `taskStatus`
- **When** the trip-detail renders
- **Then**:
  - **One** chip appears carrying the close-status label ("Đóng" or "Trả")
  - Two stacked labels or a generic "Hoàn thành" replacement are NOT present
  - The chip colour matches the design-system `BadgeWithDot` family (per [[design-system-contracts]])
- **Assert:**
  - `browser_evaluate` over the close-status block: returns exactly one chip node
  - The chip's text deep-equals "Đóng" or "Trả" (or the exact implemented Vietnamese equivalent — locked in at implement time)
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-006-dong.png`
  - `qa/2026-09-10_driver-app-enhancements_ui-006-tra.png` (different fixture trips for both states)

### TC-DA-007 — POD biên bản photo uploadable + tap → full detail

- **Given** driver on staging at a trip-detail page
- **When** the driver taps the POD upload affordance
- **Then**:
  - The upload picker opens with the device camera / gallery (browser: file input; native: system picker)
  - Selecting an image uploads it to the same evidence endpoint used by trip photos (reuse the pattern, no new endpoint)
  - The uploaded image renders as a thumbnail in the POD block
  - Tapping the thumbnail opens the full-detail view (modal / sheet, per the existing evidence-photo UX)
- **Assert:**
  - `browser_evaluate(() => document.querySelectorAll('[data-testid="pod-photo-upload"], [class*="pod-photo"]').length)` ≥ 1
  - After upload, a thumbnail with a `src` attribute appears (src is the uploaded asset URL, not a placeholder)
  - Tap thumbnail → full-detail modal opens; the modal carries the image at full size
- **Evidence:**
  - `qa/2026-09-10_driver-app-enhancements_ui-007a-upload.png`
  - `qa/2026-09-10_driver-app-enhancements_ui-007b-thumb.png`
  - `qa/2026-09-10_driver-app-enhancements_ui-007c-full-detail.png`
  - API: `qa/2026-09-10_driver-app-enhancements_api-007.log` (POST + GET evidence URL)

## BE contract probes (must pass BEFORE FE gate)

These run in the BE lane; FE gating depends on them.

| Probe | Why |
|---|---|
| `SELECT factory_name, factory_address FROM shipments WHERE id = $1` for fixture trips | TC-DA-002 parity with master-plan |
| `SELECT contact_phone, warehouse_contact_info FROM operational_sites WHERE id = $1` (container factory/kho site; mixed NULL + populated) | TC-DA-003 hide/show behaviour — render source is `contact_phone` |
| `SELECT tractor_plate, trailer_plate FROM trips WHERE id = $1` (any leftover fields?) | TC-DA-004 — confirm whether the BE keeps the fields |
| `SELECT tax_code, company_name, address FROM customers WHERE id = $1` for invoice data | TC-DA-005 |
| `GET /api/driver/me/trips/:id` response shape (full diff before/after FE work) | TC-DA-007 — POD upload endpoint |

Evidence: `qa/2026-09-10_driver-app-enhancements_be-probes.sql` + driver log.

## Verification protocol (cache-cold)

Per [[responsive-space-utilisation]] memory note + the 365943ea protocol:

1. **Auth injection** via `puppeteer-spa-auth` skill (`evaluateOnNewDocument` injecting the JWT before first navigation).
2. **Bundle check** — `browser_evaluate(() => document.querySelector('script[src*="assets/index"]').src)` matches the deployed bundle hash.
3. **Hard reload** — `browser_evaluate(() => location.reload())` then re-await the bento block.
4. **Width set** — `browser_set_viewport({ width: 360 | 390 | 768 })` per TC, then re-screenshot.
5. **DB-side parity** — every UI render must be cross-checked with a DB query (where data drives the test).
6. **Log + screenshot** — every assertion writes to `qa/2026-09-10_driver-app-enhancements_ui-driver.log` with the same JSON shape used by 365943ea.

## QA gates required (run before push)

```
pnpm lint                                                        # 0 errors
cd backend && npx tsc --noEmit                                   # 0 errors
cd backend && pnpm test                                          # all pass
cd frontend && npx tsc -b                                        # 0 errors
cd frontend && pnpm test                                         # all pass
make build                                                       # succeeds
```

The chunk commit must push per-chunk (commit+push after every task rule). After push, qa runs the gate on **staging first**; if green, PM authorises the next ticket.

- **Evidence:** `qa/2026-09-10_driver-app-enhancements_gates.log`

### G-mig — migration hash check (wave gate, pm Amendment 2 2026-09-10)

After every migrate on staging AND prod, verify `__drizzle_migrations` carries hash prefix `2d8af75377` (0067, the chunk-7 supersede migration):

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
WHERE hash LIKE '2d8af75377%' ORDER BY id DESC LIMIT 1;
```

- If **MISSING** on staging post-cut: HARD STOP, ping pm; do not hand-patch.
- If **MISSING** on prod post-deploy: HARD STOP, ping pm; user explicit approval required through pm.

Evidence: `qa/2026-09-10_driver-app-enhancements_g-mig.log` (psql output per env).

## Evidence bundle

```
qa/
├── 2026-09-10_driver-app-enhancements_ui-001-collapsed.png
├── 2026-09-10_driver-app-enhancements_ui-001-expanded.png
├── 2026-09-10_driver-app-enhancements_ui-002-route-address.png
├── 2026-09-10_driver-app-enhancements_ui-003a-with-phone.png
├── 2026-09-10_driver-app-enhancements_ui-003b-without-phone.png
├── 2026-09-10_driver-app-enhancements_ui-004-no-tractor.png
├── 2026-09-10_driver-app-enhancements_ui-005a-invoice-with-data.png
├── 2026-09-10_driver-app-enhancements_ui-005b-invoice-hidden.png
├── 2026-09-10_driver-app-enhancements_ui-006-dong.png
├── 2026-09-10_driver-app-enhancements_ui-006-tra.png
├── 2026-09-10_driver-app-enhancements_ui-007a-upload.png
├── 2026-09-10_driver-app-enhancements_ui-007b-thumb.png
├── 2026-09-10_driver-app-enhancements_ui-007c-full-detail.png
├── 2026-09-10_driver-app-enhancements_ui-driver.log
├── 2026-09-10_driver-app-enhancements_api-004.log
├── 2026-09-10_driver-app-enhancements_api-007.log
├── 2026-09-10_driver-app-enhancements_be-probes.sql
├── 2026-09-10_driver-app-enhancements_gates.log
├── 2026-09-10_driver-app-enhancements_g-mig.log
└── 2026-09-10_driver-app-enhancements_gate.txt
```

## Pass criteria

PASS iff TC-DA-001 through TC-DA-007 ALL hold on **staging first** (local-only run is a smoke test). Any TC FAIL on staging is a cycle FAIL with `fix-and-re-run` block appended to the failing artifact; PM relays to fullstack.

## Linked artifacts

- Ticket: `36d0183d` (kanban)
- Companion specs in this cycle: `testplan/qa/2026-09-10_dispatch-detailed-plan.md` (8afc13a9), `testplan/qa/2026-09-10_driver-mobile-ui.md` (365943ea), `testplan/qa/2026-09-10_replace-tags.md` (a6cb2543)
- Companion historical specs: `testplan/18f4a2dd-verification-checklist.md` (approval-removal cluster A — already DONE; not a gate for this ticket)
- Memory: [[responsive-space-utilisation]] (cache-cold protocol + pairing rule), [[frontend-architecture]] (api/hook patterns)

## Anti-lying guardrails

- "Collapsible chips" without an N ≥ 6 fixture trip = rung 1. The collapse behaviour only shows with real density.
- "Route line shows address" without the rendered DOM text = rung 1. The factory name vs address is a text comparison, not a code check.
- "Kho phone shown" without a NULL-khoPhone fixture trip = rung 1. The graceful hide is the harder half.
- "Đầu kéo removed" without a screenshot proving absence = rung 1.
- "Invoice block" without both with-data + without-data fixtures = rung 1.
- "POD upload works" without the rendered thumbnail + full-detail modal screenshot = rung 1.

## What is NOT covered (be honest)

- Other drivers' trip details (single fixture trip is enough — the surfaces are read-only data renderings).
- Landscape orientation — out of contract scope (matches `365943ea`).
- Right-to-left / i18n — out of contract scope.
- Offline / PWA install path — covered by `03-laixe.md` flow 4 separately.
- POD photo size limits / EXIF stripping — out of scope; reuse the existing evidence-photo pipeline.
- Tax-code validation logic (the user-facing display only, not the input form).
- Đóng / trả label localization (Vietnamese-only per the ticket body).
