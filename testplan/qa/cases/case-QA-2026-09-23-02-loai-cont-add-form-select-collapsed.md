# Case QA-2026-09-23-02 — "Loại cont" select collapses to a 2px sliver in the drawer's add-container form

- **Case ID:** QA-2026-09-23-02
- **Reported:** 2026-09-23, found while driving the customer acceptance guide for the three feedback
  features (`plans/reports/doc1-work/` — Part 1 "Sửa thêm/bớt container sau khi tạo lô"). The brief's step
  *"điền MSCU7654329 + loại + trọng lượng + ngày-giờ"* cannot be demonstrated: the "Loại cont" control is
  present and keyboard-operable but effectively invisible, and its option list has zero width.
- **Surface:** `/shipments` CUS drawer → "Chi tiết" → "Thêm container" → inline add form
  (`.cus-container-ledger__add-form`), field `UuiSelectField` (`width="content"`).
- **Introduced by:** `1fb7940d` (native `<select>` → house `UuiSelectField` migration for card
  `20260923_1`; native selects are banned, so the fix must keep the house component).
- **Status:** case PREPARED — fix = CSS floor on `.cus-container-ledger__add-select` in
  `ShipmentsPage.css` + red-first fence in `frontend/src/pages/ShipmentsPage.test.tsx`; rung 3 evidence
  (real picker visible, option click, row persisted) captured under `plans/reports/doc1-work/shots/`.

## Why this case exists (regression fence)

`width="content"` maps to `.ds-uui-select--content { width: fit-content; }`. The trigger's intrinsic
width is computed from react-aria's combobox `<input>`, whose intrinsic `size` tracks the *search text*
(empty ⇒ ~1 char ⇒ ~12px) while `hideLabel` removes the label from the intrinsic contribution. Measured
on 2026-09-23 (1280×577, DPR 1): wrapper `width: fit-content` resolves to **2px**, the input to **12px**,
and the open listbox popover — react-aria's MatchWidth — renders **width 0, height 2189** (options
stacked in an invisible column). A human cannot see the field, the selected value, or any option.

The existing suite could not see it: it asserts `textContent`/DOM presence (`places Thêm container
directly below the last container row`, `adds a container from the drawer…`), and jsdom has no layout —
`getBoundingClientRect()` is 0 for everything, so width assertions must fence the CSS contract.

## Steps (fixture: lot `BULK-EXP-0088` — customer LONG MINH, 2 containers, no trip)

1. Log in as CUS (`testplan/testaccounts.txt`), open `/shipments`, search `BULK-EXP-0088`.
2. Press "Chi tiết" → drawer; press "Thêm container".
3. Measure `.cus-container-ledger__add-select` and its `<input>` (`getBoundingClientRect().width`).
4. Press the select to open the option list; measure the `[role=listbox]` rect.
5. Pick `20DC`; type số cont `MSCU7654329`, trọng lượng `12500`, giờ hẹn `25/09/2026 09:30`; press "Thêm",
   then "Lưu"; verify the row persists (page reload + DB `shipment_containers`).
6. Repeat at1440/1920 widths and a 390px viewport (form wraps).

## Expected behavior

| # | Expectation |
|---|---|
| 1 | The "Loại cont" trigger renders at a **human-visible width (≥150px)** with its placeholder/selected label readable — never a sliver. |
| 2 | The open option list is **as wide as the trigger** with every option's label legible — never a 0-width column. |
| 3 | Mouse pick works: click trigger → click an option → value shows in the trigger; keyboard path (ArrowDown/Enter) stays equivalent. |
| 4 | Add-container still persists `container_type_id` (row shows `20DC` in LOẠI CONT) — the migration to `UuiSelectField` is not reverted, native `<select>` stays banned. |
| 5 | The sibling fields (Số container flex `1 1 170px`, Trọng lượng `0 1 130px`, datetime, Thêm/Hủy) keep their layout — the floor must not reflow the row (form wraps when over budget). |

## Out of scope

- The other four `width="content"` call sites (`Pagination`, `DispatchPlanEditorCell`, `PhoiPhieuControlPage`, `QuotationFeesSection`) — different containers; not measured by this case.
- The `UuiSelectField`/react-aria intrinsic-sizing design itself — this case only fences the ledger floor.

## Automated fence (red-first, must stay green)

- `frontend/src/pages/ShipmentsPage.test.tsx` →
  `add-container form: the Loại cont select keeps a human-visible floor (QA-2026-09-23-02)` —
  extracts the `.cus-container-ledger__add-select` rule block from `ShipmentsPage.css` and requires a
  `min-width` ≥150px. RED pre-fix (no `min-width` in the block), GREEN post-fix.
- Rung 3 evidence: `plans/reports/doc1-work/shots/raw/p1c.png` (filled form, trigger ≥150px),
  `p1c_dd.png` (open listbox legible), `p1d.png` (persisted row) + DB row output in the task report.
