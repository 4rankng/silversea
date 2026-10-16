# FB-009 (card 131026233500) — copy giờ hẹn in the appointment dialog and the "Lịch & ghi chú" section

**Card:** `[Verify-fail] FB-009: nút copy thời gian vẫn không tồn tại ở bất kỳ đâu`
(staging build 5ef12393, role CUS). This supersedes
`case-2026-10-16-fb009-skipped-out-of-wave-scope.md`, which skipped the card
because the `.docx` was empty; the card body was later recovered from the
Google Drive kanban export and this run fixed the two surfaces it names.

## Steps to reproduce (from the card)

1. Open **Tạo lô hàng** (`/shipments/new`), scroll to **Lịch & ghi chú**.
2. The section shows the group *Ngày giờ đóng trả cho tất cả cont*
   (HH:mm + DD/MM/YYYY + *Áp dụng cho 1 container*) plus two note fields.
3. Open the *Chọn ngày giờ* dialog from a container row's appointment cell.

## Actual before this fix

- The section carried no clipboard affordance at all. Its only copy-looking
  control, *Copy giờ hẹn xuống cont trống*, is a copy-DOWN (it fills sibling
  rows) and never touches the clipboard — a naming collision that made the
  feature look present while being absent.
- The *Chọn ngày giờ* dialog carried only calendar + time grid + *Xong* /
  *Đóng lịch*. No copy button anywhere in it.

## Expected

A copy button at both named positions: the picked giờ hẹn lands in the OS
clipboard and a *Đã copy giờ hẹn …* toast confirms what was copied.

## Fix

| Surface | Change |
|---|---|
| `Chọn ngày giờ` dialog (`SplitDateTimeField.combined.test.tsx`) | `SplitDateTimeField` → `CombinedDateTimeSurface` renders `CopyCodeButton` in the dialog header beside *Đóng lịch*, present only once the draft's date AND time parse; new `onCopied` prop raises the host toast |
| `Lịch & ghi chú` group (`ShipmentCreateWorkspace.copy-appointment.test.tsx`) | `CopyCodeButton` beside the group field copying the value typed there, gated on a complete datetime; always visible, no hover-reveal |

Both write the same `HH:mm DD/MM/YYYY` shape the per-row button already wrote
(`formatContainerAppointment`), so a pasted time matches what the field shows.

## Verification

- `frontend`: `npx vitest run src/features/shipments/create
  src/design-system/forms` → 43 files / 341 tests pass.
- `npx tsc --noEmit` → 0 errors.
- Not driven in a live UI (rung 2): the behaviours are covered by the two
  regression cases above; no staging write was performed in this wave.

## Still open (documented, not in this card)

The wider census of appointment surfaces outside this card — CUS dashboard
list, container ledger, shipment detail, dispatch drawer/grid, customer
portal — is unchanged; see the notes in the superseded skip record.