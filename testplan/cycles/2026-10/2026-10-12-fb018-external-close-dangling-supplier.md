# Regression spec — FB-018 external staff close vs dangling supplier link

**Ticket:** FB-018 (round 16) — card 121026141010
**Owner (implement):** backend + frontend
**Owner (verify):** qa
**Status (this doc):** covered by backend suite + FE vitest + local UI drive
**Cycle:** 2026-10 round 16

## Goal

On `/dispatch-detail`, 'Hoàn thành' on an issued external-carrier trip
('Đã phát lệnh cho tài xế') confirmed but never completed: after reload the
status was unchanged and the button still there; retrying twice gave the same
result with no visible cause. Root cause: the carrier's
`customers.linked_supplier_id` can point at a supplier row that no longer
exists (no FK by repo convention; 14 such carriers in the staging-synced dev
DB). `LedgerService.postTripCompletion` → `buildCarrierDueDateFields` →
`resolveSupplierPaymentDueDate` threw `Không tìm thấy nhà cung cấp #…` →
HTTP 500 → the whole completion rolled back, and the FE banner collapsed
every non-409/403 error to 'Không thể hoàn thành chuyến. Vui lòng thử lại.'.

## Fix

- `backend/src/services/business-calendar.service.ts` —
  `resolveSupplierPaymentDueDate` returns `null` for a missing supplier row
  (same as an unset term): due-date stamping is opt-in enrichment; aging
  falls back to the global default; the financial posting never fails on it.
  Covers the sibling callers: fuel supplier (CHI_HO), expense fee supplier,
  source-change expense re-posting, carrier CUOC.
- `frontend/src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts` —
  the close's error banner surfaces the server's message for every status,
  falling back to the generic line only when no message exists.

## Acceptance criteria

### TC-FB018-001 — close succeeds through a dangling supplier link

- **Given** an issued EXTERNAL trip whose carrier customer carries
  `linked_supplier_id` with no matching `suppliers` row
- **When** Điều vận confirms 'Hoàn thành chuyến' from /dispatch-detail
- **Then** the trip flips to COMPLETED (ledger posts), no 500.

Covered by `dispatch-fulfillment.test.ts` — 'staff close after a plateless
issue and plate-attachment reassign (FB-018 repro)' (also pins the plateless
409 refusal and the reassign plate-attach route).

### TC-FB018-002 — refusal reason reaches the banner

- **Given** the close API rejects with any status carrying a Vietnamese
  server message (409 plate gate, 500 server fault…)
- **Then** the assignment banner shows that message, not the generic retry
  line.

Covered by `useDispatchDetailPlan.test.tsx` — 'completeExternalTrip surfaces
"$reason" rather than a generic reload banner' (409 ×2 + 500 with message).

### TC-FB018-003 — confirm dialog names the container when present

- **Given** a row with a container number
- **Then** the 'Xác nhận thao tác' dialog shows that container number
  ('Hoàn thành chuyến với xe ngoài MSKU…?').

Covered by `DispatchDetailPlanPage.test.tsx` identity table (UI52-B chain:
container → bill/booking; shipmentCode stays excluded as a display key).
Verified UI DRIVEN locally 2026-10-12 (qa/2026-10-12_fb018_ui-*.png).

## Notes

- The old throw contract was pinned by `o2c-rev1.ncc-dual-terms.test.ts`
  ('throws for a non-existent supplier'); repointed to pin the null-degrade
  with the FB-018 rationale in the test body.
- The card's secondary display ('Chưa có số Bill/Booking') requires the row
  to lack both container number and bill/booking — a data-completeness
  state; with data present HEAD shows the container (screenshot evidence).
