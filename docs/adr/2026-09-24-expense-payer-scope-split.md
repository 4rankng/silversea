# ADR: Expense payer scope split — approval precedes payment on both chains

- **Status:** Accepted — 2026-09-24 (Director re-rule on case QA-2026-09-24-01, relayed by Lead)
- **Deciders:** Director (ruling), Lead (relay), LaneB (implementation)
- **Supersedes:** the interim widening that briefly let the phoi-phieu voucher pay approved DRIVER
  (tiền đường) sources (`88b5d2d0`, removed in `dc9f44ee`).

## Context

Two chains can turn an approved accounting source into cash movement:

- The **phoi-phieu consolidated voucher** (`createPhoiPhieuVoucher`,
  `backend/src/services/phoi-phieu-control.service.ts`) — the accountant's "Lập phiếu thu/chi"
  toolbar over checked board trips.
- The **cash/vouchers chain** (`POST /expense-accounting/cash/vouchers` →
  `createExpenseVoucher`, `backend/src/services/expense-accounting-voucher.service.ts`) —
  the ops expense workspace's phiếu thu/chi, which resolves DRIVER sources to a
  DRIVER_PAYOUT ledger posting capped by the driver's ledger payable.

The phoi-phieu voucher historically consumed OPS (chi hộ) sources only; the audit's P4 flow
("duyệt tiền đường để lập phiếu chi thanh toán lái xe") and a director round briefly widened it to
also pay approved DRIVER sources. Payer-scope ambiguity is a double-pay hazard: two chains paying
the same source kind with independent remaining ledgers, and `createPhoiPhieuVoucher`'s source
query structurally cannot even see DRIVER sources (it inner-joins `ops_expense_entries`).

## Decision

1. **Single payer per source kind.** The phoi-phieu voucher pays **chi-hộ/OPS** sources only. The
   cash/vouchers chain pays **DRIVER (tiền đường)** sources (and its existing VENDOR/FORWARDER
   kinds). No chain consumes the other's kind.
2. **Approval precedes payment on both chains.** Every consumed source must be accountant-approved
   (`confirmedAt` set):
   - phoi-phieu: the source query filters `isNotNull(confirmedAt)` (landed `88b5d2d0`).
   - cash/vouchers: the engine's approval gate (predating this ADR) now refuses with a **fee-name
     row list** — never a bare `KIND-id` — collecting every unapproved entry (landed `dc9f44ee`).
3. **Preview equals contents.** The phoi-phieu toolbar counter shows the eligible set
   (approved ∧ cash-adjusted remaining > 0, per direction, OPS-only) so the button says exactly
   what pressing it will issue.

## Consequences

- Refusals are business-keyed: "Các khoản chưa được duyệt: Phí giữ xe kiểm thử" — an operator can
  act on it; a bare "DRIVER-4242" they cannot.
- Regression coverage: t1 (unapproved chi hộ excluded from the phiếu, phoi-phieu-control.test.ts),
  t2 (counter previews the eligible set, PhoiPhieuDialogs.test.tsx), t5/t6 (cash chain pays
  approved-only with named-fee refusals and remaining decrementing, expense-cash-authority.test.ts).
- The two chains' remaining ledgers stay independent by construction; cross-chain double-pay is
  impossible because each source kind has exactly one payer.
