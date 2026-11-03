# shipmate:uiux — POLISH verdict (SIL-641 residual, diff trên branch fix/sil641-action-slot)

Mode: **POLISH** (touch-up trên surface có sẵn — section Nhận diện lô, form Tạo lô hàng, role CUS).
Domains touched: layout (slot geometry), accessibility (boundary/icon contrast, focus), UI polish (surface chip).
Domains not touched: writing, typography, colors-as-palette → Not reviewed (không đổi copy/type/palette).

## Recon

Framework React 18 + Tailwind v4 + csc-* page CSS; tokens `frontend/src/styles/tokens.css`
(--control-border được docs chính là token "WCAG 1.4.11 non-text" 3.05:1);
viewports 320/390/768/1366/1440; preview local 7175 (make dev, DB :5441).

## Changes reviewed (diff)

1. `uui-searchable-field.tsx` — `hideSearchIcon` → `icon={<></>}` (glyph ra khỏi DOM).
2. `ShipmentCreateIdentitySection.tsx` — 2 combobox identity opt-out glyph.
3. `ClerkShipmentCreatePage.css` — inner-box parity scope `.csc-identity-grid`;
   chip `.csc-append-button` thêm boundary 1px `--control-border` + `--surface`.

## Verification duty (rendered, local 7175)

- Contrast (1.4.11, measured bằng polish-probe): icon accent #4A9E7D trên
  --surface = **3.24:1** ✓; boundary chip --control-border #89978F = **3.05:1** ✓
  (finding ban đầu: dùng --border-1 đo được 1.44:1 → đã sửa trong review, thấy
  `qa/2026-11-03_sil641/after/polish-contrast-focus.log`).
- Focus ring: chip ':focus-visible' outline 2px accent, offset 1 — đo được
  `outline: rgb(74,158,125) solid 2px`, focused=true ✓ (không phải outline:none).
- Hit area 36×36 ≥ 24px AA (2.5.8); 36 ≥ 32 touch floor theo FB-114 (owner) ✓.
- Keyboard + click: dropdown mở khi focus (45 options), pick commit vào input
  ('LOG COM'), '+' mở dialog khách hàng, pencil mở dialog hãng tàu, Escape đóng
  (`qa/2026-11-03_sil641/after/behavior-check.log`, GREEN 0 fail).
- Geometry @1440/1366/768/390: slot gap sau field = 8 (±0), overrun mép ô = 0,
  slot 36, placeholder 36 + visibility:hidden + cùng margin-top 26 — GREEN
  (`qa/2026-11-03_sil641/after/ui-driver.log`, RESULT GREEN failures=0).
- 320px: không overflow-x, cell 288, slot 36, overrun 0
  (`sil641-after-identity-320.png`).
- Icons: lucide Plus/Pencil, màu từ CSS var (currentColor chain), aria-hidden ✓.

## Findings (cap 15 — trigger trước, rồi severity/reach)

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | MEDIUM (1.4.11) | Chip boundary dùng `--border-1` đo 1.44:1 < 3:1 | `ClerkShipmentCreatePage.css` `.csc-append-button` (bản đầu diff) | **Fixed trong review** → `--control-border` 3.05:1 ✓ re-measured |

Không còn finding mở. Không trigger nào nổ (accessible name 2/2 nút, focus
indicator ✓, keyboard path ✓, 320px ✓, contrast 2 cặp đo được ✓, meaning-by-
color-only không xảy ra — icon + boundary + aria-label).

## Verdict

**Approve** — theo skill verdict rule (không còn HIGH; finding duy nhất đã fix
kèm re-measure). Coverage: 1440/1366/768/390/320 + keyboard + contrast đo thật.
Not covered: 200% zoom (không drive), dark mode (app chỉ light), vai trò khác
CUS (scope ticket), staging (bằng chứng local theo brief).
