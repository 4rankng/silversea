# Cost-permission & settlement P0 batch — accountant docx "Fix lại các chi phí của từng phân hệ"

Branch `fix/cost-permissions-bugs`. Four P0 fixes, one commit each. Scope guard:
driver cost form fields, Ops entry UX and the accounting compact form belong to
other waves and stay untouched here.

## Case CPB-01 — OPS role cannot declare costs on lots (permission/policy)

Repro (local dev, 2026-10-14, backend :3112):

1. Login `giaonhan` (OPS).
2. `GET /api/ops/expenses/write-scope?shipmentId=47638` → `{"writable":false,"reason":"Lô này không thuộc xe bạn phụ trách. Liên hệ Quản trị viên để được gán xe."}` — same for every live lot (47638, 12440, 42970, 77048).
3. Root cause: `assertOpsExpenseAssignment` grants the OPS role lot-cost writes only via a per-person grant (manual user↔lot link, active truck assignment hauling the lot, or own prior expense). A newly entered lot has none, so no OPS user can declare costs at all.

Expected after fix: the ROLE policy allows OPS to declare costs on any live
(non-deleted) lot; a missing/deleted lot still refuses with 404
`Không tìm thấy lô hàng.`; the save path (POST /api/ops/expenses) succeeds for a
live lot without any personal grant. Wave C owns per-person/container
restrictions and the Ops entry UX — not touched here.

## Case CPB-02 — accounting cost form acts before lot context loads

Repro (local dev, 2026-10-14, ketoan):

1. "Thêm chi phí lô hàng" (invoice tracking): pick a lot, hit Lưu while the lot's
   trip list is still loading → recurring `Chọn lô hàng và chuyến trước khi lưu.`
   even though the lot was picked; the form conflates "not loaded yet" with
   "missing lot".
2. "Hồ sơ chi phí" (ShipmentFinanceForm): the lot id is captured once via
   `useState(String(editor.record?.shipmentId ?? shipmentId ?? ''))` — a mount
   before the lot context resolves locks the form on the empty lot forever and
   the save refuses with `Chọn lô hàng trước khi lưu.`

Expected after fix: the invoice-tracking create submit stays disabled (and says
why) while the picked lot's trips are still loading; the finance form derives
the lot reactively from `editor.record?.shipmentId ?? shipmentId` until the user
explicitly picks one, so a late-arriving lot context populates the form.

## Case CPB-03 — tạm ứng has no accounting approval action

Repro: OPS submits tạm ứng (`POST /api/ops/wallet/advance-requests`) → row is
born RECORDED with `approvedBy = requester` (KP-148 direct-apply). Accounting's
"Tạm ứng & hoàn ứng" list has no PHÊ DUYỆT TẠM ỨNG action and no audit entry.

Expected after fix: OPS submission is born `PENDING` (Chờ phê duyệt);
ADMIN/MANAGER/ACCOUNTANT can approve via `POST /api/financial/advance-requests/:id/approve`
which stamps approvedBy/approvedAt, bumps version and writes an audit-log row;
approval is idempotent and version-guarded; funding/settlement eligibility
(still RECORDED-gated) excludes PENDING; accountant-side implicit funding keeps
creating RECORDED rows; OPS may withdraw their own PENDING request (same
unfunded licence as RECORDED).

## Case CPB-04 — hoàn ứng: confirm checkbox + signed remainder

Repro (local dev, 2026-10-14):

1. Phiếu hoàn ứng record form (SettlementPrintPage "Ghi nhận phiếu") has no
   confirm checkbox.
2. Báo cáo hoàn ứng (`/accounting/hoan-ung`): "Còn phải hoàn ứng" is the sổ quỹ
   outstanding (floored ≥ 0) — it can never go negative and is not
   `ĐNTT − đã ứng`.
3. `refundAmount` zod gate is `nonNegNumeric` (create+update settlement
   schemas) and the UI input is `min="0"`, so a phiếu whose expenses exceed the
   advance (refund = advance − expense < 0) cannot be recorded at all.

Expected after fix: the record form requires a "chốt xác nhận hoàn ứng"
checkbox; the report computes `remaining = dntt − advanced` signed, shows a
warning banner `đề nghị thu tiền ứng` when negative; the settlement schemas
accept signed refund amounts so negative remainders are recorded and displayed.
