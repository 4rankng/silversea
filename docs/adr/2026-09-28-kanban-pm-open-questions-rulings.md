---
date: 2026-09-28
status: accepted
deciders: Frank Ng (delegated: derive from PM source doc + PRD)
source: /Users/dev/Downloads/các chi phí.pdf  ·  docs/prd/OpsVanHanh.docx
scope: kanban cards 161,162,165,166,167,169,171,172,173,181,197
---

# Rulings on the kanban cards parked as "CẦN THÔNG TIN"

Eight cards on the Kanban-PROD board were blocked on a "Câu hỏi cần PM chốt"
section. The PM (Frank) did not answer them individually and instead directed that
the ruling be derived from the PM's own source document (`các chi phí.pdf`) and
`docs/prd/`. This ADR records the ruling for each, with the evidence it rests on.

**Precedence rule used:** an explicit requirement in the PM's source document
beats a PM parenthetical question; a dated ruling already written into
`docs/prd/` is binding and is not re-opened; where the two agree, the PRD
wording is used because it is testable.

---

## Card 197 — negative cost entry (this is NOT open, the PM already answered it)

**Ruling: implement as specified.** The PM's document ends with an
all-caps, unqualified requirement:

> "TẤT CẢ DANH MỤC CHI PHÍ CẦN ĐIỀN, MỌI PHÂN HỆ KHI NHẬP ĐỀU CÓ THỂ (+)
> CHI PHÍ HOẶC (-) CHI PHÍ (TƯƠNG ĐƯƠNG XÓA DÒNG)"

= every cost category, every entry screen, may take (+) or (−), where (−) is
*equivalent to deleting the row*.

This is the exact contract `sumExcludingNegative` implements, and it is the
reason card 181 deliberately withheld negatives from `ops_expense_entries` and
`driver_incidental_costs`: a negative row must move no total. The card's 27
enumerated sum sites are the backlog for that invariant. No further approval
needed — build it.

## Card 167 — two fund sources (TK công ty ACB + TK TM)

**Ruling: two sources, kept separate, integrated into the phơi phiếu screen.
Per-account running balance. No limit / credit management.**

Evidence — this is not actually open. `docs/prd/OpsVanHanh.docx` §5.2 carries a
**dated ruling that already shipped**:

> "**Sổ quỹ tách hai nguồn** (chốt 21/09, ship 22/09): mỗi phiếu thu/chi gắn
> đúng một nguồn quỹ — TK công ty (ACB) hoặc Tiền mặt; sổ của từng nguồn đọc
> được riêng (số dư đầu, thu, chi, tồn), tài khoản chưa gắn nguồn được đếm
> riêng và không lẫn vào sổ nguồn nào."

The PM's own "Lồng ghép Quỹ vào luôn không?" was a drafting question, answered
by the firm requirement that follows it — "Ở mục phơi phiếu, yêu cầu có 2 nguồn
Quỹ" and "Tại mục phơi phiếu, mong muốn có 2 bảng". "Lồng ghép" = integrate into
the phơi phiếu screen; it never meant merge the two books.

This is **already built**, in two parts:

1. The books — `FUND_SOURCES = ['COMPANY','TM']`
   (`backend/src/services/treasury-fund-book.service.ts:7`), per-source account
   filtering, unassigned accounts counted in their own bucket, per-account
   `bookBalance`. Pinned by `card9-fund-book.test.ts`.
2. The legality gate — `VOUCHER_REQUIRED_FUND` (`treasury.service.ts:538-547`)
   maps every cost group to the source the PM's document assigns it
   (`INVOICED_LIFT`/`INVOICED_DROP`/`INVOICED_OTHER`/`INVOICE_SERVICE` → TM;
   `OPS_REGULAR`/`OPS_INCIDENTAL`/`DRIVER_SHIPMENT`/`DRIVER_ROAD` → COMPANY),
   and `assertVoucherFundMatches` (`treasury.service.ts:562`) refuses a voucher
   whose account belongs to the other fund — and refuses a voucher whose own
   lines straddle both. Landed in `26d19d1f`, covered by
   `backend/src/tests/voucher-fund-direction.test.ts` (6 tests, including an
   anti-drift test that reads the mapping from the source rather than restating
   it).

**Correction (2026-09-28, after reading the source).** An earlier draft of this
ADR said the legality gate was the one thing still missing on card 167. That was
wrong — the gate is present and committed. Card 167's PM question is therefore
fully answered by what already ships, and the card can close on the ruling below
once its remaining acceptance criteria are checked. No limit / credit
management is wanted: the PM never asks for one, and adding one would be scope
invention.

## Card 169 — "đợt làm đề nghị" in the reimbursement report

**Ruling: a "đợt" is an `expenseReconciliations` lot (the reconciliation that
bundles ops costs and allocates the received advance to them).**

Evidence — `docs/prd/OpsVanHanh.docx` §9.2 defines the semantics of "đợt"
independently of any table:

> "Báo cáo hoàn ứng theo nhân viên/đợt cho biết **chi phí thuộc đợt**, **tiền
> ứng thực nhận được phân bổ** … Một khoản ứng hay chi không được tính toàn bộ
> vào nhiều đợt."

A "đợt" therefore (a) *owns* a set of costs, (b) *allocates* received advances,
and (c) is non-overlapping — an item never lands in two of them.
`expense_reconciliations` is the only existing structure with all three: it
carries `opsUserId`, a `from`/`to` window, `amount`, `advanceAmount`, and
`expense_reconciliation_advances` allocates specific advance requests to a
specific reconciliation. `debitSettlementRounds` (the monthly debt close) has
none of those properties and is about carrier AP, not staff advances.

The report is already half-wired this way — `ops-reconciliation-report.service.ts`
reads `expenseReconciliationAdvances` joined to `expenseReconciliations` to
compute what each staff member still holds. Add the "đợt" filter on that same
axis.

**Ruling on criterion 5 (does "Còn phải hoàn ứng" equal the Ops fund-book
closing balance?): match in magnitude with inverted sign, and converge after
posting.** The PRD is explicit:

> "Số dư quỹ dùng chiều ngược lại, vì vậy đối chiếu cùng giao dịch và ý nghĩa
> thu/chi, **không ép hai số có cùng dấu**." … "sau khi phiếu post, sổ quỹ và
> báo cáo hội tụ về một số."

So the test is `|report.remaining| === fundBook.bookBalance` for that Ops account
once the phiếu posts — **not** numeric equality. Restate criterion 5 that way.

## Card 162 — where CUS reads the "không thu khách" reason

**Ruling: the reason must be readable on TWO surfaces — the transport-plan grid
(for the accountant) and the phơi phiếu list (for CUS/accountant). Do not widen
`/accounting/debit-board`, and do not widen `/dispatch` for CUS.**

Evidence — `docs/prd/OpsVanHanh.docx` §9.1 already names both surfaces:

> "Ghi chú … **và lý do của khoản không thu khách**, phải đọc được tại **kế hoạch
> điều vận (kế toán)** và nơi **CUS/kế toán xử lý khoản thu (danh sách phơi
> phiếu)** — chỉ nội dung lý do, không kèm số tiền hay thông tin quỹ."

The PM's source document says the same thing and is even more specific: the note
goes on "bảng kế hoạch điều vận", "để kế toán/cus tích vào và thu khách hàng
trên debit".

**Correction (2026-09-29, after reading the source).** The backend half of
card 162 already shipped: `createOpsExpense` refuses a line that is not charged
to the customer unless it carries a reason — *"Dòng chi không thu khách hàng thì
bắt buộc nhập ghi chú — ghi rõ lý do để kế toán / CUS đọc được"*
(`backend/src/services/ops-expenses.service.ts:227`). So the validation and
persistence exist; what is genuinely missing is the **surface**: no frontend
calls `GET /api/expense-accounting/ops-review` at all, so neither CUS nor the
accountant can read the reason on a list today. Card 162 is a UI/consumer gap,
not a validation gap.

That guard also had a side effect worth recording: its fixtures create
`customerChargeAmount: 0` lines without a note, so
`card11-reconciliation-report.test.ts` was left **red on trunk** (1/3) by the
guard landing. Fixed in `b0354126` — a third instance of the same pattern in
this codebase, where a backend rule lands and takes an existing suite with it.

Both candidate answers on the card are therefore wrong as stated:
- option (b), widening the accounting debit-close board, is **not** a surface the
  PRD names, and that board's "Ghi chú" is the accountant's own working column;
- option (a), loosening `dispatchOnly` so CUS opens `/dispatch`, contradicts the
  `NP-07` rule written in `App.tsx:187-191` **and** the PRD, which scopes that
  surface to the accountant via the "(kế toán)" parenthetical.

CUS's route to the reason is the **phơi phiếu list**. Implement that. The PRD
also constrains the payload: reason text only — no amounts, no fund information.

## Card 166 — truck → accountant assignment, and the blocking question

**Ruling: assign the 39 trucks split 13 / 26 now, and make an unassigned truck a
blocking warning rather than a hard block on driver cost entry.**

Evidence — the PM's source document names the split and states the purpose:

> "hiện silver có 2 kế toán làm phơi phiếu, tổng số lượng xe 39, được chia:
> người 13 xe, người 26 xe **nên cần chia ngay từ đầu để tiện check tiền đường
> cho xe dễ dàng hơn**"

The stated purpose is *convenience when checking road fees*. Nothing in the
document says unassigned trucks must be unable to record costs. A hard block
would, on the measured local data (40 trucks, 8 assigned), stop 32 of 40
trucks — i.e. it would defeat the convenience the PM asked for.

The PM gave counts, not a list. So: run the existing batch endpoint
(`POST /api/expense-accounting/assignments/batch`, `de56b6be`) to seed 13/26
deterministically, keep per-truck reassignment on the UI for corrections, and
show the driver a clear warning naming the missing accountant instead of a
silent disabled button. Record the seeded assignment in the QA artifacts so it
is auditable and correctable.

## Card 171 — criteria 4 and 6

**Ruling: both are specified; no PM question is needed. And on inspection, both
are already built — this card was parked on a question the code had already
answered.**

- Criterion 6, the payer column — `docs/prd/OpsVanHanh.docx` §9.1:
  "'Người thanh toán' là người thực hiện khoản chi; **nhập thay không đổi người
  này thành người đang đăng nhập**." The implementation already honours this:
  `phoi-phieu-control.service.ts:472-473` reads `opsExpenseEntries.paidById`
  joined to `users.fullName` and exposes it as `payerName` / `payerUserId`
  (`:447-448`, `:491-492`) — i.e. the user who actually paid, not the logged-in
  user — and `PhoiPhieuChiHoDialog.tsx:145,156` renders the
  `Người thanh toán` column. The "nhập thay" half of the rule (an entry made on
  someone else's behalf must not overwrite the payer) is the part still worth an
  explicit test if one does not exist.
- Criterion 4, the driver row in the chi-hộ detail — the PM's source lists chi-hộ
  detail as containing both Ops and lái xe costs ("Lái xe nhập chi phí lô hàng"),
  and the card's own criteria 1/2/3/5 already build that screen. A driver line
  belongs in it.

## Card 172 — "TRỌNG TẢI CONTAINER"

**Ruling: specified, not open — and already implemented.** The PM's source, in
capitals:

> "+ Ở CỘT THÔNG SỐ CONTAINER THÊM GIÚP EM TRỌNG TẢI CONTAINER NỮA NHA"

`PhoiPhieuControlPage.tsx:260` already renders it, reading the real container
data rather than free text, and with the explicit empty case the card's criteria
demand:

```
Trọng tải: {row.cargoWeightKg != null ? row.cargoWeightKg.toLocaleString('vi-VN') + ' kg' : 'Chưa có trọng tải'}
```

The field originates in `cargoWeightKg` on the shipment container
(`card 20260921_15`, per the comment at `phoi-phieu-control.service.ts:36`).
Together with criteria 2/3/4, which already passed at HEAD, **card 172 is
complete** and can close on this ruling. The only item left to confirm is the
last acceptance line — that the field survives at every table width, not just the
full one — which needs a rendered check at the reduced breakpoints, not a code
change.

## Card 173 — criteria 2 and 3 (ordering, and single-row aggregation)

**Ruling: both specified, in the PM's source document.**

> "Hiển thị: Ưu tiên thứ tự, với những khách xhd nhiều lần 1 tháng, được ưu tiên
> xếp nối tiếp"
> "Với khách hàng có phát sinh cả thu / trả 1 tháng (chỉ xhd 1 lần duy nhất /
> hoặc tại kỳ đối soát chưa xhd): Ưu tiên hiển thị tổng hợp trên cùng 1 dòng:
> cả cước phải thu / phải trả, số lượng"

- Criterion 2: order by transaction frequency descending so repeat customers in
  a month are adjacent.
- Criterion 3: a subject with **both** receivable and payable in the period shows
  as one aggregated row carrying both figures and the count.

## Card 165 — road-fee rates not yet supplied

**Ruling: leave free-entry in place; do not invent rates.** The PM's source says
"định mức từng tuyến đường sẽ bổ sung sau" — per-route rates come later. Until
then the driver enters the amount and the accountant approves, which is exactly
the behaviour already built for the bridge-ticket case. The rates that *are*
given (50.000đ Lạch Huyện/TIL/Hateco, trả đêm 100.000đ, quay đầu 100.000đ, quá
tải 200.000đ, đảo chuyển ICD/Đăng Khoa 200.000đ, chủ nhật 200.000đ, lưu ca
200.000đ) stay as seeded. "Soi" and "Kiểm hóa" have no rate in the source — leave
them free-entry rather than guessing. The 50.000đ figure is stated once for the
group of lifting/drop points, so it applies to both directions; do not split it.

## Card 161 — is the "Phí khác" sub-list fixed or editable?

**Ruling: editable catalogue, seeded from the PM's list.** The PM's source
enumerates the items as examples ("…", "…."), not as a closed registry, and the
generic line "TẤT CẢ DANH MỀC CHI PHÍ CẦN ĐIỀN" (all cost categories need to be
entered) points the other way. Seed the documented items as active defaults —
which is what `OPS_EXPENSE_TYPE_DEFAULTS` already does — and let the catalogue
admin add or retire items. Do not hard-lock it, and do not require a fresh PM
list.

---

## What this changes for the board

| Card | Was | Now |
|---|---|---|
| 197 | open, spec'd | **unblocked** — PM text is the spec |
| 167 | CẦN THÔNG TIN | **already built** — books + legality gate both ship; can close |
| 169 | CẦN THÔNG TIN | **unblocked** — đợt = reconciliation lot; criterion 5 restated |
| 162 | CẦN THÔNG TIN | **unblocked** — phơi phiếu list surface, not debit board, not /dispatch |
| 166 | AC2 hoãn | **unblocked** — seed 13/26, warn not block |
| 171 | CẦN THÔNG TIN | **largely already built** — payer column ships; needs the "nhập thay" test |
| 172 | criteria 1 chờ PM | **already built** — payload column ships; can close |
| 173 | CẦN THÔNG TIN | **unblocked** — PM source answers both |
| 165 | rates missing | **closed as specified** — free-entry, no invented rates |
| 161 | PM question | **closed** — editable catalogue, seeded |

### Pattern worth naming

Four of these cards (167, 171, 172, and partly 161/165) were parked as "waiting
on a PM decision" while the code had **already implemented** what the PM was
being asked to decide. The blocker was the card's own bookkeeping, not the
product. The lesson for the board: before routing a question to the PM, read the
shipped source — a dated PRD ruling or a rendered column already answers it.
This ADR is the record of having done that read, so the next session does not
re-ask.

## Defects found while clearing the board (2026-09-28)

The browser QA lane drove cards 161/163/164/165/168/170/177 against local dev and
found two real problems, diagnosed in
[`plans/reports/2026-09-28-card170-phoi-phieu-voucher-reference-defect.md`](../../plans/reports/2026-09-28-card170-phoi-phieu-voucher-reference-defect.md):

- **Card 170 — voucher creation is broken.** `phoi-phieu-control.service.ts:407`
  builds the `physicalReference` by joining every selected trip id; the treasury
  authority caps it at 160 chars, so the screen's own "tích chọn All"
  requirement cannot be satisfied on a lot with enough trips. Fix spec written,
  not yet applied.
- **Card 161 — data gap, not code.** No loginable OPS account holds a
  `user_shipment_links` row, so Ops cannot declare a cost on any lot they own in
  the dev DB (403). QA worked around it with a scoped fixture link.
