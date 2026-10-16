# FB-048 (card 141026003600) — every invalid required field on /shipments/new paints red

**Card:** `FB-048 verify-fail: create-lot invalid fields still lack red borders`
— CUS, staging build `5ef12393`, `/shipments/new`, 2026-10-14. Submitting an
all-empty form shows no red border on Khách hàng / Hình thức XNK / Số
Bill-Booking / Loại container; only a partially-typed date/time cell is red
with *Nhập đủ giờ và ngày hợp lệ.*

## Two findings

1. **The all-empty submit already painted** at HEAD — the at-rest danger
   border for select/combobox landed in `73617a2f` (2026-10-14), after the card
   measured build `5ef12393` (2026-10-13 22:10). Confirmed by driving the real
   form: Khách hàng (`csc-searchable-field--error`, `border-error`), Hình thức
   XNK (`data-invalid="true"`, `border-error`) and Loại container
   (`aria-invalid`, `border-error`) are all red at rest.
2. **The card's second step was still broken, and it was ordering, not paint.**
   `save()` ran a native-constraint pre-gate *first* and returned:
   `querySelector('[data-date-input]:invalid, [data-split-datetime] input:invalid')`.
   A partially-typed appointment sets `setCustomValidity` on its segments, so
   that gate fired, `runSave` never ran, `setValidationIssues` never ran,
   `issueByField` stayed empty — and every other required field had nothing to
   paint. That is exactly the reported shape: *only the date cell is red*.

The component-level pins in `form-control-boundaries.test.ts` cannot see this
class: they render one field in isolation, never a submit.

## Fix

| Change | Why |
|---|---|
| `ShipmentCreateWorkspace.save()` runs the app-owned validation pass **first**; the native gate only reports validity on top of it, and still blocks when the model found nothing | a partial draft no longer starves the other required fields of their issue; a constraint the model does not express (empty but `:invalid`) still blocks the save |
| `SplitDateTimeField`: the touched draft's own message wins over the host's field-level message | a half-typed cell keeps its precise *Nhập đủ giờ và ngày hợp lệ.* instead of the generic *Container 1: chọn ngày giờ đóng/trả* |

## Verification

- New: `ShipmentCreateWorkspace.invalid-required-paint.test.tsx` — 2 cases
  driving the real submit: the all-empty submit marks Khách hàng / Hình thức
  XNK / Loại container invalid at rest; a partial date/time draft still paints
  the other fields **and** keeps the draft's own message.
- Failing-before / passing-after confirmed: with the old pre-gate restored, the
  partial-draft case fails (`expected false to be true`).
- `npx vitest run src/features/shipments src/design-system/forms` → 65 files /
  608 tests pass. `npx tsc --noEmit` → 0 errors.
- Not driven in a browser (rung 2): the assertions read the real rendered DOM
  after a real submit; no staging session was used in this wave.