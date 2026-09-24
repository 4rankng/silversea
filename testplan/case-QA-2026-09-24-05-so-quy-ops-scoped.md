# Case QA-2026-09-24-05 — Sổ quỹ OPS: scoped read-only fund book on /ops/wallet (card `20260923_13`)

- **Case ID:** QA-2026-09-24-05
- **Reported:** 2026-09-24, card `20260923_13` (docx nghiệm thu chi phí PHẦN 6 MỤC 02; CHIEF chốt
  phương án PARTIAL READ-ONLY; ADR `docs/adr/2026-09-24-ops-fund-book-scoped-read.md`).
- **Verbatim requirement (PDF):** *"Sau khi duyệt xong chi phí, trên 'Sổ Quỹ' tại TÀI KHOẢN OPS, sẽ
  hiện số tiền còn lại cuối cùng khớp với số 'Còn phải hoàn ứng' ở bảng 'báo cáo tổng hợp hoàn ứng'
  để Kế toán phơi phiếu tiện thanh toán hoặc yêu cầu nhân viên hoàn lại tiền tạm ứng làm hàng trong ngày."*
- **Surface:** `/ops/wallet` (Quỹ tạm ứng) — new "Sổ quỹ" section between the balance cards and
  "Yêu cầu tạm ứng". Endpoint: `GET /api/ops/wallet/fund-book` (Role.OPS only, self-scoped).
- **Mutation surface: NONE.** The section and endpoint are read-only by contract (ADR); this case
  contains no mutation taps.
- **Status:** case PREPARED — code + unit tests landed (see `plans/reports/c12-fe-card13.md`);
  UI DRIVEN rung owed to the QA lane at wave cut.

## Why this case exists (regression fence)

The RBAC contract change (OPS reads fund data) is scoped by construction, not by policy rows: the
service takes its identity from the session and has no client-supplied id parameter. A regression
here would be (a) another user's cash events surfacing, (b) any write path appearing, or (c) the
book's closing drifting silently from the accountant figure instead of showing an honest
"chưa khớp" state.

## Steps

1. Login as an OPS account (`giaonhan` / `hoangnh` / `hungld` / `duongtt`, `testplan/testaccounts.txt`).
2. Open `/ops/wallet`. Inspect the "Sổ quỹ" section below the balance cards.
3. Cross-check one Thu row against "Yêu cầu tạm ứng" ("Đã nhận" rows) and one Chi row against the
   expense history — same date, same amount, text-only cells (no pills/icons).
4. Read the summary block: "Số dư cuối sổ" vs "Còn phải hoàn ứng (theo kế toán)".
5. Compare with the same user's numbers on the accountant side
   (Tạm ứng & hoàn ứng summary, ACCOUNTANT account) — "Còn phải hoàn ứng" must match.
6. Login as a second OPS account; repeat steps 2–4. Confirm no entry from the first account appears.
7. As OPS, attempt `GET /api/ops/wallet/fund-book` from the browser session (network panel) —
   expect 200 with own entries only; attempt a treasury surface (`/finance/treasury`) — expect redirect.
8. Repeat steps 2–4 at a 390px viewport.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | The section renders read-only: columns Ngày / Diễn giải / Chứng từ / Thu (nhận) / Chi (trả) / Số dư; empty state text when no events; **no edit/delete/create controls anywhere in the section**. |
| 2 | Entries derive from the caller's own cash events only (tạm ứng đã nhận, chi phí ghi nhận, hoàn tiền, chi bù). Another OPS user's rows never appear (pinned by `backend/src/tests/ops-fund-book.test.ts`). |
| 3 | Summary block shows book closing and the accountant figure side by side with an honest state: "Đã khớp với báo cáo tổng hợp hoàn ứng" or "Chưa khớp — cần đối chiếu với kế toán". A mismatch is **never auto-resolved or hidden**. |
| 4 | Full treasury (`/finance/treasury`) stays ACCOUNTANT/ADMIN (Casbin `treasury` policy rows unchanged in the landing diff). |
| 5 | Vietnamese-first copy, text-only data cells, mobile layout keeps the table readable at 390px (44px touch targets per house rules). |

## Unit rungs already banked

- `backend/src/tests/ops-fund-book.test.ts` — self-scoping (second-user invisibility both ways),
  closing == wallet formula, closing vs outstanding khớp on converged data, voided/rejected
  exclusion, unfunded-advance silence.
- `frontend/src/pages/OpsWalletPage.fund-book.test.tsx` — rows render, empty state, honest
  chưa-khớp state; `OpsWalletPage.test.tsx` — existing wallet surface unchanged apart from the
  added section.
