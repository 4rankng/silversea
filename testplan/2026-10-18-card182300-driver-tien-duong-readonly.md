# Card 182300 — Lái xe KHÔNG được sửa "Tiền đường" (chiphispec §1)

- **Case ID:** `182300-driver-tien-duong-readonly`
- **Nguồn:** chiphispec §1 (`Fix lại các chi phí của từng phân hệ.docx`):
  "tiền đường hệ thống tự ghi; kế toán được chỉnh; LÁI XE chỉ xem (readonly)".
  Law already partially shipped: card 20261005 blocks driver-created
  `costType=ROAD_ALLOWANCE` rows (`insertDriverIncidentalCostTx` 400 "Khoản
  này do hệ thống tự ghi nhận.") and hides "Sửa khoản chi" on saved
  ROAD_ALLOWANCE/LIFT_DROP_ZONE rows; card 141026230700 removed the
  ROAD_ALLOWANCE option from the add-form list.
- **Gap this card fixes (2 lanes, one defect class — driver-written Tiền đường
  money):**
  1. **Create lane — fee-norm rows (định mức).** Norm options (Trả đêm,
     Chạy quá tải, Lưu ca … ) ARE Tiền đường rows (server forces their
     `costType = ROAD_ALLOWANCE` from the norm), but the "Thực chi (VND)"
     input stayed editable ("Gợi ý X; sửa theo khoản thực tế", card
     20260921_7 AC3) and `insertDriverIncidentalCostTx` stored the
     driver-supplied amount. Per spec the norm amount IS the system value:
     lái xe only views it.
  2. **Edit lane — accounting-update endpoint.** Driver "Sửa khoản chi"
     (`DriverExpenseCorrection` → `updateAccountingExpense`, DRIVER branch)
     had NO costType guard: the UI hides the button on system rows, but a
     direct API call could change a ROAD_ALLOWANCE/LIFT_DROP_ZONE row's
     amount (or name/date/note/evidence). Defense-in-depth: 403 server-side.

## Cases

### TD-RO-01 — FE: norm-row "Thực chi" locked to the system value

1. Driver → /my-trips/<id> → "Thêm chi phí" → tab "Tiền đường" → chọn "Trả đêm".
2. Expected: "Thực chi (VND)" is disabled, shows the norm amount (100.000),
   help text says the system records it ("Hệ thống tự ghi nhận theo định
   mức … kế toán điều chỉnh tại màn hình phơi phiếu"), typing is refused.
   Ordinary road options (Vé cầu đường, Tiền đường khác …) stay editable.

### TD-RO-02 — BE: norm create ignores a divergent driver amount (ignore-field)

1. `recordIncidentalCost(..., { feeNormCode: 'NIGHT_RETURN', amount: 150000 })`
   (norm amount 100000; also via /batch — same write function).
2. Before fix: row stored `amount = 150000` (driver-set Tiền đường).
3. Expected: stored `amount = driverEnteredAmount = '100000'` (the system norm
   value), `costType = ROAD_ALLOWANCE`, no error (replay-safe ignore, not a
   400 — stale offline queues save the system figure, never the typed one).

### TD-RO-03 — BE: driver/ops update of a system row → 403

1. Driver (or OPS) calls `updateAccountingExpense` on a DRIVER-source row whose
   NATIVE `costType` is ROAD_ALLOWANCE or LIFT_DROP_ZONE (amount/name/date/
   note/evidence — any non-empty change).
2. Before fix: accepted (amount mutated by lái xe — spec violation).
3. Expected: `ApiError 403 "Khoản này do hệ thống tự ghi nhận — kế toán điều
   chỉnh tại màn hình phơi phiếu."`; row unchanged.

### TD-RO-04 — no-regress: ordinary driver correction + accounting edits still work

1. Driver updates their OWN non-system row (OTHER/TOLL/… DRIVER_ROAD or lot
   row) via the same endpoint → succeeds (amount persists).
2. ACCOUNTANT updates a ROAD_ALLOWANCE DRIVER row via the same endpoint →
   succeeds (kế toán được chỉnh). Phơi phiếu
   (`correctAccountingExpense`, finance-only) untouched.

## Gates

- BE: `npx tsc --noEmit` = 0; `tsx --test src/tests/m84-incidental-cost.test.ts`
  (TD-RO-02/03/04 pins) + sibling suites the write path touches
  (`expense-source-remediation`, `phoi-phieu-control`).
- FE: `npx tsc -b` = 0; vitest scoped
  `ShipmentCostEntryForm.test.tsx`, `ShipmentCostEntryDraft.test.tsx`,
  `DriverTripDetailPage.shipmentCostEntry.test.tsx`.
- Lint: `pnpm lint` = 0.
- UI evidence: browser drive of the readonly norm field (qa artifacts).

## Spec-vs-code decisions

- Card 20260921_7 AC3 ("norm amount overridable per AC3") is SUPERSEDED by
  chiphispec §1 as ruled in this card's brief: system writes the norm amount,
  kế toán adjusts at phơi phiếu, lái xe views only. Ordinary (non-norm) road
  rows (Vé cầu đường, Sửa chữa dọc đường, Tiền đường khác, Soi/kiểm hóa)
  keep the driver-reported-actual contract — they are real driver spends, not
  system road money (CP-GAP-01/CP700-03 stay green).
- Both `amount` and `driverEnteredAmount` carry the system figure for norm
  rows: the driver's legitimate surface never enters a different one, and the
  accountant's "Lái xe nhập ban đầu (đ)" column must not show a number no
  driver legitimately entered.
- Edit guard keys on the NATIVE `driver_incidental_costs.costType` (the
  accounting source's `expenseTypeCode` metadata can lag for norm rows) and
  covers OPS too — the branch is the non-finance branch; "kế toán được chỉnh"
  is finance-only. CUS branch untouched (never reaches these rows' money).
