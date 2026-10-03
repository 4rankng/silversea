# Case QA-2026-10-03-9 — The schedule date fallback is labelled; dialog/list mismatch explained (card 20261003_318)

- **Case ID:** QA-2026-10-03-9
- **Reported:** 2026-10-03, QA per user (P1): the Chỉnh sửa điều phối dialog's Giờ trả hàng was EMPTY while the list
  showed "01/10/2026"; a 13h edit appeared not to propagate.
- **Diagnosis (live on staging 9ec4c19a, the reported row MSKU1234565):** TWO layers — (1) the list's shown value was the
  DELIVERY-DATE fallback (the row has no stored dispatch hour; the dialog correctly showed an empty Giờ trả hàng), a bare
  date that reads as a stored hour; (2) DISPROVEN — a complete edit (13:00 05/10/2026) propagated immediately and
  persisted; an incomplete hour-only input is refused by the completeness guard, which is why the reported attempt
  appeared to do nothing.
- **Surface:** /dispatch-detail schedule cell + the Chỉnh sửa điều phối editor.
- **Mutation surface:** mutates 1 fixture row via Lưu thay đổi (set → verify → restore); declare per-run.
- **Status:** case PREPARED — fix landed (see card for sha); local rung + staging repro on the card; staging re-rung owed
  at the next cut for the labelled fallback.

## Steps

1. Login dungnv → /dispatch-detail; find a row with only a delivery date (no dispatch hour stored).
2. The schedule cell renders `Ngày giao dd/mm/yyyy` — LABELLED as the delivery date, never as a bare time value.
3. Open Chỉnh sửa điều phối: the Giờ trả hàng field is empty (correct — no dispatch hour stored).
4. A row WITH a stored dispatch hour: the column renders `HH:MM dd/mm/yyyy` and the editor opens with the same value.
5. An hour-only input (no date) is refused by the completeness guard with the visible error.

## Expected

- The list never shows an unlabelled bare date that reads as a stored return hour; dialog and list agree on what is
  stored.

## Local rung (2026-10-03)

- Pin: the labelled fallback renders `Ngày giao 11/09/2026`; bare `11/09/2026` and the dash form are absent.
