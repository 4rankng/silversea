# Fixture — QA292CH chi-hộ trip (card 20261002_292)

**Purpose:** one local trip that carries RECORDED chi-hộ rows AND projects in
the phoi-phieu control list, so the Chi tiết chi hộ dialog (card 292) can be
driven from the list UI.

**Seeded (local :5441, 2026-10-03):**

| Row | Identity |
|---|---|
| shipment | `QA292CH-S1` (id 44976, BL `BLQA292CH`) |
| trip | `QA292CH-T1` (id **29432**, COMPLETED, today) |
| container | `QA292CH-1` on type `292CH`, appointment today 09:00 |
| entries | 2 RECORDED OPS chi-hộ rows (Cầu đường 350.000 + Cân 180.000, INV-QA292CH-1/2) linked via expense_accounting_sources (source_kind OPS, status RECORDED, trip_id 29432) |
| truck | `QA292CH` (ACTIVE) |

**Reach:** login ketoan (ACCOUNTANT) → Phoi phieu control board
(`/expense-accounting` PhoiPhieuControlPage) → search `QA292CH` → the row's
"Chi tiết chi hộ" button opens the dialog (tripId 29432).

**Predicate:** every row is self-authored under the `QA292CH` prefix with
note-purpose card 20261002_292 — safe to purge as a set.
