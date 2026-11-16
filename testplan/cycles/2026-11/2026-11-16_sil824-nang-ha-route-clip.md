# Regression spec — `SIL-824` NÂNG/HẠ route token clipped ('VipGreenPor')

**Ticket:** SIL-824 (id 953) — /shipments-detail ledger width model; this case pins the QA FAIL regressions on builds 1a0ea1c5 + 9f999b4d + 4db1a331
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** WITH-FIX — fix landed same commit (route span track law + tooltip)
**Cycle:** 2026-11

## Goal

The NÂNG/HẠ cell of the container ledger (`ShipmentContainerLedger`) must never
lose glyphs of a site name. Root cause found 2026-11-16: the cell's value span
is a CSS grid; its implicit auto track floors at the text's min-content
('VipGreenPort' = 77.1px at 12px/600), which `overflow-wrap: break-word` does
not lower, so the token painted ~2px past the 76px line box and the next
cell's background covered the final 't' — readable as 'VipGreenPor' at every
viewport (both 1440 collapsed-sidebar and 1920 sidebar-open). Fix: explicit
`minmax(0, 1fr)` track on `__route > span` (break-word then fires inside the
item's block context; word-boundary wrap stays first) + a `title` tooltip
carrying the full Nâng/Hạ site names on container rows (lot rows already had
one).

## Out of scope

- The fixed-px width floors themselves (BILL 112, SỐ TỜ KHAI 124, NHẬP/XUẤT 76,
  HÃNG TÀU 96, THÔNG SỐ CONTAINER 116, NÂNG/HẠ 88, ...): widening NÂNG/HẠ to
  fit 'Cảng VipGreenPort' on one line (~122px) would push the table min-width
  past the 1329px canvas of a 1440 collapsed-sidebar view and force the card
  grid — a regression on the QA-PASS'd width model. The 88px floor stays.
- Card-mode layout below the 1326px container guard.

## Acceptance criteria

> UI verifications are rung 3 (`UI DRIVEN`).

### TC-SIL824-001 — No glyph of a NÂNG/HẠ site name is ever painted outside the route cell

- **Given** staging, role CUS `tiepvv`, table mode (1440 sidebar-closed or 1920 sidebar-open), row tờ khai 108590773650 / container EMCU6163403
- **When** the row renders with lift site 'Cảng VipGreenPort'
- **Then** every rendered text line of the route cell lies inside the cell's
  border box: the token wider than the line emergency-breaks
  ('VipGreenPor' / 't' on separate lines, all glyphs visible); 'Cảng' still
  wraps at the word boundary; no character is hidden under the LỊCH TRÌNH
  cell's background
- **Assert:** per-line `Range.getClientRects()` widths ≤ the span clientWidth; CSS pin
  `frontend/src/pages/ShipmentContainersPage.styles.test.ts` SCHEDULE-LAYOUT-07
  requires `grid-template-columns: minmax(0, 1fr)` on `__route > span`
- **Evidence:** measured repro 2026-11-16 (Chromium 1920×1080): before fix line
  rect 77.1px > span 75px; after fix rects 73.1px + 4px inside the span

### TC-SIL824-002 — The full site names stay reachable via tooltip

- **Given** any table-mode row with lift 'Cảng VipGreenPort' and drop 'KCN Đồng Văn, Hà Nam'
- **When** hovering (or long-pressing) the NÂNG/HẠ cell
- **Then** the cell's tooltip reads `Nâng: Cảng VipGreenPort — Hạ: KCN Đồng Văn, Hà Nam`; with both sites unset no title attribute renders
- **Assert:** component pin in `ShipmentContainerLedger.test.tsx`
  ('SIL-824 carries the full Nâng/Hạ site names…' + '…omits the tooltip')
- **Evidence:** vitest scoped run in the fix commit
