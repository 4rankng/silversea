# Regression case QA-2026-09-24-06 — Deposit-tracker overdue-CV alert (red line + toast + per-session dismissal)

- **Case ID:** QA-2026-09-24-06
- **Card:** 20260923_14 (work order c12 §_14)
- **Surface:** `/accounting/deposit-tracker` (DepositRefundTrackerPage)
- **Status:** fix landed; verify on staging after the next cut
- **Roles:** ACCOUNTANT / ADMIN (page mount `casbinAuthz('accounting')` + `requireExpenseFinance`)

## Preconditions

- At least one deposit-tracker row with status `CHUA_HOAN_CUOC`, `cvSubmittedDate` empty, whose row
  ("Ngày" column) is ≥ 8 VN calendar days old (Asia/Ho_Chi_Minh) — it feeds alert line 1.
- At least one `CHUA_HOAN_CUOC` row with positive deposit amount — it feeds line 2.
- A fixture recipe: KT adds a manual row ("Thêm dòng") with today's date, then back-dates the row via
  SQL is NOT needed — simply ensure at least one old CV-less unrefunded row exists (prod/staging data
  usually has one; otherwise create a row and wait 8 days, or let QA back-date `created_at` on a QA
  fixture row).

## Repro (first try)

1. Login with an ACCOUNTANT or ADMIN account (roster: `testplan/testaccounts.txt`).
2. Open `/accounting/deposit-tracker`.
3. Observe the banner directly under the filters.

## Expected

1. **Alert line 1 (red, dismissible per session):** verbatim
   `kiểm tra check cược số lượng: NN lô hàng` — NN zero-padded to two digits ("01 lô hàng" matches the
   acceptance doc's own example). N counts rows in the CURRENT FILTER with `CHUA_HOA_CUOC` status, no
   CV date, and VN-calendar-day difference > 7 (flags on the 8th VN day; day-diff 7 stays quiet).
2. **Line 2 (persistent):** verbatim
   `Chưa hoàn cược số tiền: X ₫ — Vui lòng kiểm tra lại!` — visible whenever the filtered
   unrefunded total > 0. NOT dismissible (work order: "chạy liên tục").
3. **Toast on load:** a warning toast with the line-1 text fires once per page load; suppressed after
   the per-session dismissal; never fires at count 0.
4. **Dismissal semantics:** the X control (aria-label "Ẩn cảnh báo quá 7 ngày chưa nộp công văn") hides
   ONLY line 1 + the toast; line 2 survives. The flag lives in sessionStorage — survives reload within
   the same browser session; a fresh session shows the banner again.
5. **Boundary semantics (TZ-pinned Asia/Ho_Chi_Minh):** a lot created VN-day D flags on VN-day D+8.
   Staging runs UTC, so the boundary follows VN calendar days — pinned by `card19-deposit-tracker.test.ts`
   (day-diff 7 quiet / day 8 flags, +07 midnight-shift pins, endpoint filter-relative rung).
6. Design law: red line uses the `--danger-text` token (§2); plain text, no decorative icons (§1);
   dismiss control 24px desktop / 44px coarse-pointer (§5); verbatim Vietnamese copy (§8).

## Pass criteria

- All six expected behaviors hold in one run; console clean; money line survives dismissal.
