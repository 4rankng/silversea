# SIL-641 (id 745) — Form tạo lô, section "Nhận diện lô": 2 input columns equal width (50/50)

## Problem & Root Cause

### 1. Where the unequal tracks were defined
- **File & Line**: `frontend/src/pages/clerk/ClerkShipmentCreatePage.css:480-486`
- **Previous Rule**:
  ```css
  @media (max-width: 820px) {
    .csc-identity-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .csc-identity-grid > * { grid-column: auto; }
    .csc-identity-grid__customer, .csc-identity-grid__flags--solo { grid-column: 1 / -1; }
  }
  ```
- **Root Cause**:
  Under `@media (max-width: 820px)` (which affects viewports between 641px and 820px, including standard tablet 768px), `.csc-identity-grid__customer` had `grid-column: 1 / -1`. This forced the Left column ("Khách hàng") to expand across the full 100% width on row 1, while the Right column ("Hình thức xuất nhập khẩu") wrapped to row 2 at 50% width. Below it, "Số Bill/Booking" and "Hãng tàu" sat side-by-side at 50% width on row 3. This caused the input columns in the "Nhận diện lô" section to be uneven and misaligned.
- **House Scale**:
  - The house grid uses equal multi-column tracks (`repeat(12, minmax(0, 1fr))` on desktop with `span 6` / `span 6` for 50/50 division; `repeat(2, minmax(0, 1fr))` on tablet $\ge$768px for 50/50 division).
  - Mobile (<768px, specifically $\le$640px) uses single-column stack (`minmax(0, 1fr)`).

## What Changed, Per File

### 1. `frontend/src/pages/clerk/ClerkShipmentCreatePage.css`
- Lines 480–486:
  Removed `.csc-identity-grid__customer` from `grid-column: 1 / -1` under `@media (max-width: 820px)`. Only `.csc-identity-grid__flags--solo` (the "Tuỳ chọn" options row) spans `1 / -1`.
  Both input columns now take `grid-column: auto` within the 2-column track `repeat(2, minmax(0, 1fr))`, ensuring exact 50/50 equal width across viewports $\ge$768px.
  Mobile $\le$640px remains a clean single-column stack (`grid-template-columns: minmax(0, 1fr)`).

### 2. `frontend/src/pages/clerk/ClerkShipmentCreatePage.styles.test.ts`
- Updated the existing pin test:
  - Renamed from `'gives customer identity the widest column and reflows cleanly by viewport'` to `'equalises the 2 identity columns (50/50) and reflows cleanly by viewport (SIL-641)'`.
  - Replaced the pin expecting `grid-column: 1 / -1` on customer with negative assertion `expect(css).not.toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid__customer[^{]*\{[^}]*grid-column:\s*1 \/ -1;/)`.
  - Added assertions for equal column tracks (`repeat(2, minmax(0, 1fr))` and `.csc-identity-grid > * { grid-column: auto; }`).

### 3. `frontend/src/features/shipments/create/ShipmentCreateIdentitySection.styles.test.ts` (new)
- Added dedicated style pin tests verifying:
  1. Desktop 50/50 equality: `repeat(12, minmax(0, 1fr))` where customer span equals trade-direction span (`leftTrackSpan === rightTrackSpan`, both 6 cols) and booking span equals shipping-line span (`bookingSpan === shippingSpan`, both 6 cols).
  2. Tablet 50/50 equality: `repeat(2, minmax(0, 1fr))` where customer does NOT expand to `1 / -1` and items use `auto` span.
  3. Phone single-column stack: `repeat(1, minmax(0, 1fr))` / `minmax(0, 1fr)` preserved at $\le$640px / 390px.

## How Equality is Proven (Assertion & Measurements)

### Comparative Assertion
Rather than checking arbitrary magic numbers, the test compares the two column definitions directly:
```typescript
const leftTrackSpan = Number(custMatch![1]);
const rightTrackSpan = Number(tradeMatch![1]);
expect(leftTrackSpan).toBe(rightTrackSpan); // 6 === 6
expect(leftTrackSpan + rightTrackSpan).toBe(12);

const bookingSpan = Number(bookingMatch![1]);
const shippingSpan = Number(shippingMatch![1]);
expect(bookingSpan).toBe(shippingSpan); // 6 === 6
```
And under `@media (max-width: 820px)`:
```typescript
expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
expect(css).toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid\s*>\s*\*\s*\{[^}]*grid-column:\s*auto;/);
expect(css).not.toMatch(/@media\s*\(max-width:\s*820px\)[\s\S]*?\.csc-identity-grid__customer[^{]*\{[^}]*grid-column:\s*1 \/ -1;/);
```

### Live Browser Measurements (Puppeteer)
At Desktop (1307px):
- Band 1: `customerCol.w = 595px`, `tradeCol.w = 595px` (Exact 50/50 equality, height 62px)
- Band 2: `bookingCol.w = 595px`, `shippingCol.w = 595px` (Exact 50/50 equality, height 77px)

At Tablet (820px):
- Band 1: `customerCol.w = 376px`, `tradeCol.w = 376px` (Exact 50/50 equality, height 62px)
- Band 2: `bookingCol.w = 376px`, `shippingCol.w = 376px` (Exact 50/50 equality, height 77px)

At Tablet (768px):
- Band 1: `customerCol.w = 350px`, `tradeCol.w = 350px` (Exact 50/50 equality, height 68px)
- Band 2: `bookingCol.w = 350px`, `shippingCol.w = 350px` (Exact 50/50 equality, height 91px)

At Phone (390px):
- `customerCol.w = 358px`, `tradeCol.w = 358px` (Single-column stack preserved)
- `bookingCol.w = 358px`, `shippingCol.w = 358px` (Single-column stack preserved)

## Verbatim Gate Counts

1. **Vitest Tests**:
   - `cd frontend && pnpm exec vitest run src/features/shipments/create/ src/pages/clerk/ClerkShipmentCreatePage.styles.test.ts`
   - Output: `Test Files: 47 passed (47)`, `Tests: 363 passed (363)`
   - Raw output saved to: `qa/2026-11-02_sil641_vitest.txt`
2. **TypeScript Check**:
   - `cd frontend && pnpm exec tsc -b`
   - Output: `0 errors`
   - Raw output saved to: `qa/2026-11-02_sil641_tsc.txt`
3. **ESLint**:
   - `cd frontend && pnpm exec eslint src/pages/clerk/ClerkShipmentCreatePage.styles.test.ts src/features/shipments/create/ShipmentCreateIdentitySection.styles.test.ts`
   - Output: `0 errors`
   - Raw output saved to: `qa/2026-11-02_sil641_eslint.txt`

## Design-Language Source Consulted
- **Untitled UI PRO v8**: Queried via `cd frontend && pnpm uui:search "form grid"`.
- Consulted component patterns: `contact-simple-form-01`, `contact-simple-form-02`. These patterns utilize 2-column balanced grid layouts (`grid-cols-2` with equal tracks / 50-50 width distribution) collapsing to single-column stack on mobile viewports (<768px).

## UI Verification Contract (§9)
- Screenshot @ 1307px: `qa/2026-11-02_sil641_ui-1307.png`
- Screenshot @ 820px: `qa/2026-11-02_sil641_ui-820.png`
- Screenshot @ 768px: `qa/2026-11-02_sil641_ui-768.png`
- Screenshot @ 390px: `qa/2026-11-02_sil641_ui-390.png`
- Driver Log: `qa/2026-11-02_sil641_ui-driver.log`

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| SIL-641 equal column widths (50/50) at $\ge$768px and single-column at 390px | UI DRIVEN (Rung 3) | `qa/2026-11-02_sil641_ui-1307.png`, `qa/2026-11-02_sil641_ui-820.png`, `qa/2026-11-02_sil641_ui-768.png`, `qa/2026-11-02_sil641_ui-390.png`, `qa/2026-11-02_sil641_ui-driver.log` | Other pages outside shipment create |

```
Status: DONE
Summary: Equalised the 2 input columns in "Nhận diện lô" section to 50/50 equal width tracks across all viewports >=768px, while preserving single-column stack at 390px. Verified with green unit and style pin tests and Puppeteer DOM layout measurements.
Concerns/Blockers: none
```
