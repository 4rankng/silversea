# Case QA-2026-10-08-511 — Company VAT rate not configurable anywhere (card 081026104400-511)

## Claim
Round 7 staging QA (kế toán): "VAT gap root cause: no tax rate is configured anywhere". No admin surface
defines the company VAT rate, and VAT lines whose data row has no rate of its own (fee rows whose expense
type matches no forwarder-expense-type → `vatRate` null) silently compute VAT as 0.

## Reproduce (pre-fix defect)
1. Log in as admin, open the admin settings page: there is no VAT rate control at all.
2. Generate a customer debit note covering a completed trip whose approved ancillary fee's
   `expenseType` matches no `forwarder_expense_types` row: the fee line's VAT snapshot computes
   rate 0 / tax 0 (`calculateVatSnapshot` maps null → 0).

## Expected behavior
1. ADMIN can configure the company VAT rate on the admin settings page; only 0/5/8/10% are selectable
   (LEAD RULING 2026-10-08: VN VAT standard 10%, 2% reduction → 8% for eligible services
   01/07/2025–31/12/2026; transport/logistics qualifies; default configured rate = 8%).
2. The configured rate persists (singleton, governance + idempotency per existing config standard)
   and survives reload.
3. VAT computation with a null rate falls back to the configured rate; an explicit trip/fee
   `vatRate` (including explicit 0) still wins.
4. Off-whitelist rates are rejected.

## Verification
- Red-first backend test: fee line with null rate uses the configured rate; explicit fee rate wins.
- Route test: GET returns null before first save (UI default 8%), PUT applies only whitelisted rates,
  reload keeps the row, governed singletons apply directly in-request.
