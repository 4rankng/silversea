# Ops display key and modal density regressions — 2026-10-01

## QA-AUDIT-OPS-01 — business keys throughout the Ops surface

1. As OPS, open Kế hoạch làm hàng on a day containing an IMPORT and EXPORT with
   a generated SHP code and a distinct Số Bill / Số Booking.
2. Read each order row, click Ghim/Bỏ ghim and Khai chi phí; inspect accessible labels.
3. Save a legitimate local expense for an owned order, reopen its history/edit form,
   and open its settlement detail. Inspect exported settlement worksheet text.
4. As ACCOUNTANT, inspect the corresponding Ops expense rows; as OPS inspect the
   assigned truck's live order under Theo dõi phương tiện.
5. Repeat a missing-business-key case.
Expected: display keys are Bill for IMPORT / Booking for EXPORT, never SHP/TRP or
numeric internal IDs. A missing business key is explicitly named. IDs in route and
payloads still identify the correct records; no per-row extra API reads occur.

## QA-AUDIT-OPS-02 — one density at phone and coarse tablet

1. As OPS, open Xin Tạm Ứng, Khai chi phí, Sửa khoản chi and settlement detail at
   390×844, 768×1024 coarse-pointer and 1440×900 fine-pointer widths.
2. Click selects, type numbers, scroll the body and close the dialogs. Inspect each
   single-line field, close control, footer action and attachment action.
Expected: controls follow --control-touch-h (40px) at coarse widths, with the compact
primitive at fine-pointer desktop. Textarea/content may grow naturally. Title/footer
remain visible while the body scrolls; all choices and values fit their controls.

## Design provenance

Use the existing house Ops modal adapter and the shared NumberField/UuiSelectField
primitives. The controller consulted official Untitled UI Tabs/Table/Modal references
and the Tailkit catalog website fallback because catalog MCP tools are not connected.
No new primitive or catalog styling is introduced.

## Evidence

Before and after artifacts are qa/2026-10-01_comprehensive-audit_*.
Mutation claims require screenshot, quoted post-click DOM, post-write DB/API row and
the command/exit driver log. A dialog-only check does not imply a mutation pass.
