# Case QA-2026-09-24-09 — delete affordances announce DB ids / blank voided actor (audit trio O4/F2/F5)

- **Case ID:** QA-2026-09-24-09
- **Reported:** 2026-09-24, Director addendum via LEAD (QA-routed pre-existing bugs; evidence blocks in the _78 card docx).
- **Surfaces:**
  - O4 — ops expense surfaces: edit-modal photo delete (`Xóa ảnh biên lai ${photo.id}`),
    history row actions (`Sửa/Xóa khoản chi ${row.shipmentCode ?? row.id}`).
  - F2 — forwarder trip detail: expense delete affordance icon-only with `title` only.
  - F5 — forwarder trip detail voided card: `Lý do hủy … — <actor>` renders blank when the
    voiding user's fullName is empty (BE projected raw `full_name`).
- **Status:** FIXED (red-first watched on every arm).

## Verdicts and fixes

| Bug | Root cause | Fix |
| --- | --- | --- |
| O4 (HARD-RULE) | `aria-label={`Xóa ảnh biên lai ${photo.id}`}` leaked the photo row's DB id to assistive tech — internal ids are never user-facing. | Label = business key + position: `Xóa ảnh biên lai <mã lô> · ảnh <n>` (position pattern matches the house precedent in OpsExpensePhotosModal `Xóa ảnh ${index+1}`). |
| O4 sibling sweep | OpsExpenseHistory action labels fell back to `row.id` when mã lô was null — the id leaked on legacy rows. | Fallback chain `row.shipmentCode ?? row.expenseTypeName ?? 'khoản chi'` — business keys only (same shape as ExpenseRegisterRows' `businessKey(shipmentCode) ?? customerName`). |
| F2 | Forwarder expense delete button carried `title="Xóa chi phí"` with no aria-label (screen readers announced nothing). | `aria-label="Xóa chi phí <tên loại phí>"` — mirrors the sibling edit button's pattern. |
| F5 | BE projected `(SELECT u.full_name …)` raw — empty fullName ⇒ blank actor in the voided card. | `COALESCE(NULLIF(u.full_name, ''), u.username)` — the house fallback (ops-reconciliation-report.service `fullName || username`). |

## Sibling sweep results (Director addendum)

Grep across ops / expense-accounting / debit render paths:
- `ShipmentDebitTables.tsx` lines 228/239/241 carry `row.containerNumber ?? row.tripId` — a
  CONDITIONAL trip-id leak. **NOT FIXED here: the file is the debit lane's in-flight WIP**
  (modified in-tree, actively edited during this cluster). Reported to the LEAD for that
  lane (or this lane) to fix after their landing — same business-key discipline
  (`?? <business key>` instead of `?? row.tripId`).
- No `title={`-interpolated id leaks found anywhere in the sweep.

## Regression fences

- `frontend/src/features/ops/ops-delete-affordance-labels.test.tsx` — 4 cases: the edit-modal
  photo delete announces `Xóa ảnh biên lai <mã lô> · ảnh 1` (component-level, red at HEAD),
  the photo.id interpolation is source-banned, history action labels never fall back to
  `row.id`, and the forwarder delete carries an aria-label.
- `backend/src/tests/forwarder-trip-scope.test.ts` — new case "voided rows fall back to the
  username when the actor full name is empty" (red at HEAD: `actual ''` vs expected username;
  green after the COALESCE fix).

## Gates

- FE: cluster suite 4/4 EXIT=0; adjacent ops+forwarder suites 33/33 + 26/26 EXIT=0; `tsc -b` EXIT=0.
- BE: forwarder-trip-scope 12/12 green in the isolation runner; `tsc --noEmit` red at landing
  time EXCLUSIVELY from the debit lane's in-flight `shipment-debit-summary.test.ts`
  (mid-write churn; none of it is this cluster's code).
