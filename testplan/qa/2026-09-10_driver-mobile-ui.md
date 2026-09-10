# Regression spec — `365943ea` Driver mobile UI reorder

**Ticket:** 365943ea (Driver mobile UI reorder — lái xe)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** PREP — ready to execute when fullstack lands + staging cut
**Cycle:** PM cycle 1, Team B

## Goal

Reorder the driver (lái xe) mobile trip detail so the most-glanced fields land in the order the user wants (see ticket screenshot `IMG_6041.jpg`). No new fields, no role changes, no copy edits to anything but the mobile screen.

### Required field order on the driver mobile screen (top → bottom)

1. **Nhà máy** (factory name, **abbreviated** when long)
2. **Tuyến** (route)
3. **Số cont** (container number)
4. **Cảng nâng / Cảng hạ** (lift port / drop port — stay side-by-side)
5. **Tác vụ** (operation tasks: đặt đầu / đặt đuôi / đảo vỏ / …)

## Environment

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7174` |
| Local API | `http://localhost:3001/api` |
| Staging UI | `https://vantai.tingting.vip` |
| Staging API | `https://vantai.tingting.vip/api` |
| Driver mobile surface | `/my-trips/:id` (`DriverTripDetailPage.tsx`) |
| Account (local demo) | `laixe` / `Abc123` — local only |
| Account (local demo, alt) | `thu` / `Abc123` (DRIVER, plate 60C-392.15) — local only |
| Account (staging) | any DRIVER from `testplan/testaccounts.txt` (38 named drivers, all `Abc123`) |
| Browser | AgentsRoom embedded browser (`browser_set_viewport` for 360 / 390 / 768) |
| NO prod access | deploy + bare health only, per AGENTS.md |

> Pick the driver that already has an assigned trip on the chosen env (probe `/api/driver/me/trips` after login). **NO driver creation in this cycle** — only the existing seeded drivers.

## Out of scope (must NOT change)

- Web trip-list card layout (desktop dispatcher view).
- Field schema (no new columns, no new labels).
- RBAC / role matrix.
- Operation-tag taxonomy itself (covered by ticket `a6cb2543` — separate spec).
- Approval / maker-checker flows (covered by ticket `18f4a2dd` — separate spec).

## Acceptance criteria — UI contract (rung 3 required)

Each criterion below is rung 3 (`UI DRIVEN`): must be backed by a post-click screenshot + DOM assert + driver log, per the UI verification contract.

### TC-DRV-MOBILE-001 — Field order at 390 px (iPhone-class)

- **Given** a driver logged in on local **or** staging; viewport `390 × 844` (iPhone 14)
- **And** a trip is open at `/my-trips/:id`
- **When** the bento block renders
- **Then** the visible order of the labelled rows, top → bottom, is exactly:
  1. `Nhà máy`
  2. `Tuyến`
  3. `Số cont` (or `Container / lô hàng` — same field, label may carry "container / lô hàng" per existing copy; the **data** shown is the container number)
  4. `Cảng nâng` and `Cảng hạ` (side-by-side, see TC-DRV-MOBILE-003)
  5. `Tác vụ` (operation tasks)
- **Evidence:**
  - `qa/2026-09-10_driver-mobile-ui_ui-001-order-390.png`
  - DOM assert via `browser_evaluate`: array of `getBoundingClientRect().top` for each labelled `.task-fact` (or equivalent `data-testid`) — strictly increasing and matching the order above within ±2 px
  - `qa/2026-09-10_driver-mobile-ui_ui-driver.log`

### TC-DRV-MOBILE-002 — No horizontal scroll at 360 / 390 / 768 px

- **Given** driver mobile surface
- **When** page is fully rendered (cache-cold hard reload, no in-flight network) at viewport widths `360`, `390`, `768`
- **Then**:
  - `document.documentElement.scrollWidth ≤ clientWidth` at all three widths (assert via `browser_evaluate`)
  - No element overflows the viewport horizontally (`document.querySelectorAll('*')` filtered by `el.scrollWidth > clientWidth` returns `[]`)
- **Evidence:**
  - `qa/2026-09-10_driver-mobile-ui_ui-002-noscroll-360.png`
  - `qa/2026-09-10_driver-mobile-ui_ui-002-noscroll-390.png`
  - `qa/2026-09-10_driver-mobile-ui_ui-002-noscroll-768.png`
  - DOM assert per width (one row per viewport in `ui-driver.log`)

### TC-DRV-MOBILE-003 — Container + ports side-by-side at all three widths

- **Given** driver mobile surface, viewport `360 / 390 / 768`
- **When** the bento block renders
- **Then** the "Số cont" row sits in the same column band as `Cảng nâng` and `Cảng hạ`:
  - At `390 px`: cont + ports share one row, cont label short (`Số cont` only), ports stacked as `Cảng nâng / Cảng hạ` within the same band (per `responsive-space-utilisation` pairing rule)
  - At `768 px`: same side-by-side pairing (pairing rule is pointer-density-based, not width-based — but at tablet width both must remain paired, not stacked)
  - At `360 px`: still paired, **no wrap that would create a 3rd row** (if the design collapses, it must collapse into 2 rows, not 3)
- **Pairing assertion:** via `browser_evaluate`, the `top` of `Cảng nâng`'s bounding rect must equal the `top` of `Số cont`'s bounding rect within ±2 px; `left` of `Cảng hạ` must be **greater than** `right` of `Số cont` minus 8 px (small gap, not full-width stack)
- **Evidence:** same three screenshots as TC-DRV-MOBILE-002, plus DOM assertions on `top`/`left`/`right`

### TC-DRV-MOBILE-004 — 390 px screenshot is the canonical reference

- **Given** the 390 px screenshot from TC-DRV-MOBILE-001
- **When** QA publishes findings
- **Then** the screenshot is referenced in the fix report and the gate verdict; it lives at `qa/2026-09-10_driver-mobile-ui_ui-390-canonical.png`
- **Note:** this is the artifact other agents (PM, fullstack) will check first

### TC-DRV-MOBILE-005 — Existing DRV-LIST-01..06 acceptance still hold

- **Given** the trip-list (`/my-trips`) — not the detail page, but it shares the driver surface
- **When** QA re-runs `DRV-LIST-01` (full-bleed at 390 px) and `DRV-LIST-04` (tap target ≥ 48 px) from `testplan/roles/03-laixe.md`
- **Then** both still PASS — the reorder must not regress the list or its tap targets
- **Evidence:** reference to `testplan/roles/03-laixe.md` flow 1 acceptance rows 1 + 4; new screenshots `qa/2026-09-10_driver-mobile-ui_ui-005-list-390.png` and DOM tap-target size assert

### TC-DRV-MOBILE-006 — Vietnamese labels match approved terminology

- **Given** the rendered bento block
- **When** QA greps visible label text
- **Then** the labels are exactly: `Nhà máy`, `Tuyến`, `Số cont` (or `Container / lô hàng` if the existing copy is retained), `Cảng nâng`, `Cảng hạ`, `Tác vụ` — no transliteration drift, no English fallbacks
- **Evidence:** DOM text assert captured in `ui-driver.log`; spelling matches `*_LABELS` map in `shared/src` (or the inline literals in `DriverTripDetailPage.tsx`)

### TC-DRV-MOBILE-007 — Long factory name abbreviates without breaking layout

- **Given** a trip whose `factoryName` exceeds ~24 characters
- **When** the bento block renders at 360 / 390 / 768
- **Then** the factory row wraps or truncates within its cell, **does not push the layout**, and the order below it (Tuyến, Số cont, …) remains intact
- **Evidence:** re-run TC-DRV-MOBILE-001 + 002 with the long-name fixture; capture before/after

## Verification protocol (cache-cold)

Per [[responsive-space-utilisation]] memory note: cache-cold sweeps are required to defeat stale-bundle false findings.

1. **Auth injection**: use `puppeteer-spa-auth` skill (`evaluateOnNewDocument` injecting the JWT **before** first navigation); otherwise the SPA silently redirects to `/login` and a login-page screenshot masquerades as a PASS.
2. **Bundle check**: `browser_evaluate(() => document.querySelector('script[src*="assets/index"]').src)` — the hashed filename must match the **deployed** bundle (no stale dev cache).
3. **Hard reload**: `browser_evaluate(() => location.reload())` then re-await the bento block.
4. **Width set**: `browser_set_viewport({ width: <360|390|768> })`, then re-await + re-screenshot.
5. **Computed-style read**: assert `getComputedStyle(el).display`, `flex-direction`, `grid-template-columns` where the pairing rule is implemented — do **not** rely on visual approximation alone.
6. **Log + screenshot**: every assertion writes to `qa/2026-09-10_driver-mobile-ui_ui-driver.log` with `[{ width, selector, top, left, right, scrollWidth, clientWidth, pass }]`.

## Evidence bundle (mandatory for the cycle's gate verdict)

```
qa/
├── 2026-09-10_driver-mobile-ui_ui-001-order-390.png
├── 2026-09-10_driver-mobile-ui_ui-002-noscroll-360.png
├── 2026-09-10_driver-mobile-ui_ui-002-noscroll-390.png
├── 2026-09-10_driver-mobile-ui_ui-002-noscroll-768.png
├── 2026-09-10_driver-mobile-ui_ui-390-canonical.png
├── 2026-09-10_driver-mobile-ui_ui-005-list-390.png
├── 2026-09-10_driver-mobile-ui_ui-driver.log
└── 2026-09-10_driver-mobile-ui_ui-gate.txt     # PASS / FAIL line + per-TC verdict
```

## Pass criteria

The cycle's verdict is **PASS** iff all seven TCs above hold on **both** local (`:7174`) and staging (`https://vantai.tingting.vip`) with cache-cold sweeps. Any TC FAIL on either env → cycle FAIL, full artifact set still required (failing artifact gets the `fix-and-re-run` block appended).

## Linked artifacts

- Ticket: `365943ea` (kanban)
- Companion gate prep: `testplan/2026-09-10_replace-tags.md` (own prep)
- Memory: [[responsive-space-utilisation]] (pairing rule + cache-cold protocol)
- Role walkthrough: `testplan/roles/03-laixe.md` (DRV-LIST-01..06 unchanged)

## Anti-lying guardrails

- "Verified the reorder works" without the seven screenshots + DOM asserts = rung 1 (`CODE-READ ONLY`) and is **not** a PASS for this cycle.
- Reading `DriverTripDetailPage.tsx` and noting the order in JSX = rung 1 only.
- Hitting `GET /api/driver/me/trips/:id` and confirming the field is present = rung 2 (`DB/API VERIFIED`), still **not** a PASS.
- Only rung 3 (browser click + screenshot + DOM + log) counts.

## What is NOT covered (be honest)

- Mobile viewport < 360 px (e.g. 320 px Galaxy Fold cover) — out of contract scope
- Landscape orientation — out of contract scope; pair-programmer to add if it surfaces
- Right-to-left / i18n — out of contract scope
- Offline / PWA install path — covered separately by `03-laixe.md` flow 4
- Web dispatcher trip-detail card — out of scope per ticket
