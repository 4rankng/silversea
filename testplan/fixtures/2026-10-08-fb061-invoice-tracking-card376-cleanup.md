# Fixture cleanup — FB-061 card-376 invoice-tracking seed (2026-10-08)

**Purpose:** record the staged-data cleanup of the card 376 invoice-tracking
QA fixture that was still visible on staging `/accounting/invoice-tracking`
(FB-061, retest round 8). Data-only cleanup; no code change.

**Found on staging (census 2026-10-08, actor admin):**

| Row | Identity | Predicate (self-authored QA seed) | Action |
|---|---|---|---|
| invoice_tracking id 3 | shipment SHP-2610-00019 / trip 134, invoice `LEAD-QA-376-01`, supplier `NCC QA Lead 0510`, note `LEAD QA 2026-10-05 card 376 fixture — co the don khi census`, expenseId 80 | exact match on all three card-376 marks | **DELETED** via `DELETE /api/accounting/invoice-tracking/3` (soft-delete; mirrored trip_expense 80 VOIDED by the service). Re-list `rows:[]` confirmed. |

**NOT deleted — escalated (CẦN THÔNG TIN) — treasury_accounts id 6/7:**

| Row | Identity | Why not deleted |
|---|---|---|
| treasury_accounts id 6 | code `ACB`, name `ACB - Tai khoan cong ty`, bank ACB · 1900 545 249, fund COMPANY, 0 ₫ | Seed status unprovable: no `createdBy`/`createdAt` exposed by any treasury API; present since at least 2026-09-30 with `openingBalanceDate` 2026-09-01 (predates the 2026-10-05 card-376 seed wave); no QA/LEAD marks; load-bearing reference fixture of QA cards 167 (stk picker), 221839 (treasury table), 381 (fund labels). No delete/deactivate treasury-account endpoint exists — if the lead rules these are seed, the lead runs the DB purge. |

**Reach:** login admin → `/accounting/invoice-tracking` (now empty for the
seeded period) → `/finance/treasury` (ACB rows still listed pending lead
ruling).

**Predicate going forward:** the card-376 invoice-tracking fixture family is
gone; any future re-seed should re-register here first.
