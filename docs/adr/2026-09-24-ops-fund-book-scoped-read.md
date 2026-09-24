# ADR: Scoped read-only Sổ quỹ for Role.OPS

- **Status:** Accepted — 2026-09-24 (CHIEF ruling on card 20260923_13, Director work order c12 §_13)
- **Deciders:** CHIEF (partial read-only), Director (work order), Lead (plan approval)

## Context

The acceptance document (PHẦN 6 MỤC 02, "Quản lý dòng tiền hiện trường") expects the OPS account to
see a Sổ Quỹ (fund book) of field-cash advances after expense approval, with the closing amount
matching "Còn phải hoàn ứng" on the accountant's settlement summary. Today the financial surfaces
(`/finance/treasury` and the fund data behind it) are gated by Casbin to
`treasury read|write` for ADMIN/ACCOUNTANT/MANAGER only; OPS has `/ops/wallet` (Quỹ tạm ứng) with no
fund-book view.

**Role mapping (pinned by Lead, 2026-09-24):** the work order's "CUSTOMER_SERVICE" denotes
`Role.OPS`. Evidence: the card is titled "role OPS"; the source PDF says "TÀI KHOẢN OPS"; the
underlying ownership columns (`advance_requests.requester_id`, `advance_settlements.forwarder_id`)
belong to Role.OPS users; the existing `/ops/wallet` surface is Role.OPS-only. `Role.CUS` (nhân viên
CSKH) has no advances surface at all. This mapping is part of the auditable contract.

## Decision

Add ONE read-only endpoint, `GET /api/ops/wallet/fund-book`, on the existing Role.OPS router
(`requireRoles(Role.OPS)` in `backend/src/routes/ops.ts`). The service
(`getOpsFundBook` in `backend/src/services/ops-wallet.service.ts`) self-scopes server-side to the
authenticated user id only — no client-supplied identity parameter exists. Entries derive solely from
the user's own rows in the same authorities the wallet summary already reads (funded advance
requests, own expenses, settlement refund movements, expense cash vouchers). The FE view is a
read-only section on the existing `/ops/wallet` page — no new route, no nav change, no
`/finance/treasury` access.

The full treasury Casbin policy and every accountant surface stay unchanged.

## Alternatives considered

1. **Grant OPS `treasury, read` in `policy.csv`** — rejected: exposes company-wide accounts and all
   movements, far beyond the acceptance doc's ask, and is not row-scoped.
2. **Scoped branch inside `/finance/treasury` consumed by an OPS page** — rejected: widens the
   financial surface's own contract and couples the OPS UI to the treasury page; the least-invasive
   ruling (work order) calls for a scoped section under OPS instead.
3. **Duplicate fund data into an OPS-owned table** — rejected: guarantees drift from the accounting
   authorities; the book must reconcile by construction.

## Consequences

- OPS sees only their own tạm ứng/hoàn ứng cash events plus the reconciliation numbers
  (book closing vs "Còn phải hoàn ứng"); no write path is added anywhere.
- Future changes to the wallet/treasury formula must keep `getOpsFundBook` self-scoping; the backend
  test pins second-user invisibility and the closing-vs-outstanding reconciliation.
- If the book closing and the accountant figure diverge on live data, the UI shows an honest
  "chưa khớp" state that routes the discrepancy to kế toán — the discrepancy is never auto-resolved.
