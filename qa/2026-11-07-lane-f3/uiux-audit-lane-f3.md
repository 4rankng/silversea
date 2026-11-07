# uiux AUDIT — Lane F3 (SIL-702 / SIL-719 / SIL-720) — 2026-11-07

Skill: `uiux` (shipmate 4.8.0) — mode **AUDIT** (review a diff / surfaces).
Branch `fix/f3-small` (base `95e2bd13`).

## 1. Scope

Reviewed: the lane's UI diff —
the shared inline declaration cell (`frontend/src/features/shipments/detail/DeclarationInlineCell.tsx`,
new), its two skins (`frontend/src/features/shipments/create/ShipmentDeclarationInline.css`,
new + `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css` untouched), the lot
page's container row (`frontend/src/features/shipments/create/ShipmentCreateContainerRow.tsx`),
the LCL "Phân loại" option list
(`frontend/src/features/dispatch/detailed-plan/DispatchPlanCellValues.ts`), the LCL CBM
validation (`frontend/src/features/shipments/create/shipment-create-model.ts` +
`shared/src/schemas/index.ts`).

Excluded (not inspected): every other surface of the app, the dispatch grid's other cells,
the LCL allocation dialog, the accounting surfaces. `Not reviewed` below names them.

## 2. Coverage

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | `DeclarationInlineCell.tsx:236-252` (native `<button>`, `aria-label`, `:focus-visible`), `ShipmentCreateContainerRow.tsx:373-418` (the cell keeps its `data-label` + mobile label), `ShipmentDeclarationInline.css:1-52`, the driven lot page (click → type → Enter → save), `ShipmentCreateContainerRow` keyboard path | 1 finding (fixed in this lane) — 0 open |
| Layout | `ShipmentDeclarationInline.css` (the trigger keeps the cell's padding + type scale, so the column does not jump), `components/FloatingCellEditor.tsx` (the editor portals out of the cell — no clipping), the cell's mobile record label | Clear |
| Writing | the CBM error message (`shipment-create-model.ts:317-329` → the shared contract's "Thể tích phải là số không âm hợp lệ."), the save toast (`Đã lưu số tờ khai — tự điền thêm cho N container còn trống của lô.`), the trigger's `title` | Clear |
| Typography | the trigger reuses the cell's own scale (`--text-data-size`, `--fg-1`); the hint uses `--text-caption-size` | Clear |
| Colors | the trigger reuses the cell's own pairing (`--fg-1` / `--fg-3` on the cell surface) — **no new pair introduced**; not separately measured | Clear |
| UI polish | the hover/focus treatment vs the dispatch grid's twin trigger, the empty state vs the grid's empty state | 2 LOW observations |

Not reviewed: the dispatch grid's other cells, the LCL allocation dialog, the accounting
surfaces, dark mode (the app has one light theme), 320px / 200% zoom (the house review suite
owns them; this lane changed no layout width).

## 3. Findings

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM (fixed in this lane) | `frontend/src/features/shipments/detail/DeclarationInlineCell.tsx:244` | `aria-label={ariaLabel}` — the button's visible text IS the declaration number, and an `aria-label` alone replaced it, so the number never reached the accessibility tree (the cell's own display line steps aside for this trigger) | `aria-label={baseline ? \`${ariaLabel}: ${baseline}\` : ariaLabel}` | WCAG 2.5.3 Label in Name (AA): the visible label text must be contained in the accessible name; without it a screen-reader user heard only "Sửa số tờ khai" and never the number. Fixed for BOTH surfaces (the shared component owns the name). |
| LOW | `frontend/src/features/shipments/create/ShipmentDeclarationInline.css:31` vs `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:337` | the create skin's empty state is `--fg-3` upright; the grid's twin trigger is `--ink-3` italic | unify on one empty-value treatment for the shared cell | The polish doctrine: the same detail done two ways is a finding. Each skin currently follows its own feature's empty-value convention (`csc-container-cell__display--empty` is `--fg-3` upright), so this is a follow-up, not a blocker. |
| LOW | `frontend/src/features/shipments/create/ShipmentDeclarationInline.css:31` vs `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:331` | the create skin inherits the app-wide `:focus-visible` ring (`frontend/src/styles/base.css:97`); the grid's twin trigger overrides it locally | one shared focus-ring rule for the cell | Same-detail-two-ways again; both rings are visible (no `outline: none` anywhere in the new CSS) and no contrast ratio was measured here, so no ratio is claimed. |

No other actionable interface findings.

## 4. Verification

Passed:
- `node qa/2026-11-07-lane-f3/driver-sil720-inline-declaration.mjs` → exit 0: the lot page's
  SỐ TỜ KHAI cell opens the inline editor on click, Enter saves, the FB-109 auto-copy is
  reported and BOTH container rows show the number on this surface
  (`qa/2026-11-07-lane-f3/01-inline-editor-open.png`, `02-inline-saved.png`,
  `sil720-api-proof.json`, `driver-sil720.log`).
- `node qa/2026-11-07-lane-f3/driver-sil719-sil702.mjs` → exit 0: the LCL CBM field accepts
  `0` with no error and the field is not invalid (`03-lcl-cbm-zero.png`); the LCL row's
  "Phân loại" select offers exactly `Lẻ` + `Lấy Lẻ` (`04-lcl-phan-loai-select.png`).
- Keyboard path: the trigger is a native `<button>`; the editor commits on Enter and reverts
  on Escape (`DispatchDeclarationCell.test.tsx` 21/21 + the lane's SIL-720 suite 3/3).
- `pnpm lint` → 0 errors (the new CSS/TSX add no warnings).

Not verified (named limits, not defects):
- 320px / 200% zoom — the house responsive suite owns this; the lane changed no width.
- Dark mode — the app ships one light theme.
- Screen-reader pass with a real AT — the audit reasoned from the DOM/ARIA, no NVDA/JAWS run.

## 5. Verdict

**Approve** — no HIGH finding remains (the one MEDIUM was fixed inside this lane before the
commit). The two LOW observations stay as follow-up work. Coverage covers accessibility,
layout, writing, typography, colors and UI polish on the lane's diff; every surface outside
that diff is `Not reviewed`.
