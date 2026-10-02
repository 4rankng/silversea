# Card _19 implementation spec — lot lock persistence + adjust-cước

Prepared by BE1, 2026-09-18. Sources: PRD `CuocPhiThietKeDB.md` §5 (Khóa cước
và bảo toàn lịch sử), `QuyTrinhO2C.md` §7 (Hồ sơ/bảng kê/công nợ), the
existing `shipment_accounting_locks` machinery, and the card's 5 acceptance
criteria. **LEAD-APPROVED 2026-09-18** with rulings folded in below:

- **Lock roles = CUS + ACCOUNTANT + ADMIN** — the actor in the user's spec is
  the CUS on the Chi phí - Quyết toán screen (CUS performs 🔒 KHÓA LÔ HÀNG);
  OPS not indicated (Ops data entry is upstream).
- **Unlock ships LATER as its own card** — _19 locks only; the release
  columns exist in the table but no unlock endpoint ships now (unlock
  semantics need a user decision not yet available).
- **Debit Note aggregates source from `shipment_cost_locks` snapshots**,
  never live rows.

## 1. Lock persistence — new TABLE `shipment_cost_locks` (not a column)

Mirrors the proven `shipment_accounting_locks` lifecycle shape:

```
shipment_cost_locks:
  id                     serial PK
  shipment_id            int NOT NULL
  shipment_version_at_lock int NOT NULL
  cost_snapshot          jsonb NOT NULL   -- frozen Lớp-1 totals + Lớp-2 lines
                                          -- (amounts + inputs + freight
                                          -- snapshot id when present)
  locked_by              int NOT NULL
  locked_at              timestamptz NOT NULL DEFAULT now()
  lock_note              text NULL
  unlocked_by            int NULL
  unlocked_at            timestamptz NULL
  unlock_reason          text NULL
```

- **Partial unique index**: one ACTIVE lock per shipment —
  `UNIQUE (shipment_id) WHERE unlocked_at IS NULL` (same pattern as the
  accounting lock). Retry-after-drop cannot double-lock (criterion 5) — the
  index is the backstop behind the Idempotency-Key.
- **Why a table, not a column**: O2C §7 requires actor + time on external
  facts, and criteria 2–3 require lock history with reasons; a column cannot
  carry who/when/why/lifecycle. The codebase already trusts this shape.
- **Why a SEPARATE table from `shipment_accounting_locks`**: the lead's
  ruling — lot lock ≠ kỳ lock. The accounting lock is billing-document-tied
  (`billing_document_id NOT NULL`) with a period snapshot; the cost lock has
  no period or document. They co-exist independently; guards chain (see §4).
- **Criterion 1 ("mở kỳ dầu mới không đổi số đã khóa")**: satisfied by
  STORED numbers — the snapshot is written at lock time and never recomputed.
  This is the same non-retroactive decision as PRD §5's "cước đã khóa hoặc đã
  phát hành không tự đổi".

## 2. Who sets it

**Ruled: `Role.CUS` + `Role.ACCOUNTANT` + `Role.ADMIN`** (casbin
`requireRoles` on the lock and adjust endpoints). The CUS is the primary
actor per the user's spec; no OPS.

## 3. `POST /shipments/:id/lock`

- Role gate: ACCOUNTANT/ADMIN (casbin `requireRoles`).
- Idempotency-Key mandatory (the global write rule) — retries after a lost
  connection return the original lock (criterion 5).
- Validations: shipment exists → 404; `expectedShipmentVersion` (optional
  but recommended) stale → 409 concurrent-update; already actively locked →
  409 with a dedicated `SHIPMENT_COST_LOCKED_MESSAGE` (pre-checked for the
  friendly message; the partial unique index backstops the race).
- Server assembles `cost_snapshot` from ITS OWN engine values (freight
  snapshot + expense lines) — never trusts client-sent amounts; the screen's
  numbers must equal the stored ones or the lock 409s with a mismatch notice.
- Effect: insert the active lock row. No shipment `version` bump (it is a
  finance-side fact, like the accounting lock).

## 4. Freeze enforcement

Add `assertShipmentCostUnlocked(shipmentId)` (mirroring
`assertShipmentAccountingUnlocked`) and wire it into EVERY Lớp-2 write
endpoint on the shipment (expense lines, container edits that move money,
appointment changes that re-anchor freight). Violations → 409 with the
dedicated message. Chain with the accounting lock: a shipment accounting-
locked rejects cost edits already today; the cost lock adds the second,
independent freeze.

## 5. Adjust-cước — `POST /shipments/:id/cost-adjustments`

- Permission: ACCOUNTANT/ADMIN only.
- Body: `reason` **required non-blank** (server-validated; PRD §5: "lý do
  phải có nội dung"), `changes` payload, Idempotency-Key mandatory.
- Preconditions: active cost lock exists (404 "chưa khóa" otherwise);
  `assertShipmentAccountingUnlocked` still applies (accounting lock wins).
- Behavior: NEVER mutates the locked snapshot. Applies the adjustment as a
  new row and keeps the contract freight alongside for comparison (PRD §5
  "giữ cước hợp đồng để so sánh").
- History table `shipment_cost_adjustments`:

```
  id            serial PK
  shipment_id   int NOT NULL
  cost_lock_id  int NOT NULL
  before_json   jsonb NOT NULL
  after_json    jsonb NOT NULL
  reason        text NOT NULL
  adjusted_by   int NOT NULL
  adjusted_at   timestamptz NOT NULL DEFAULT now()
  idempotency_key varchar(120) NOT NULL UNIQUE
```

- `GET /shipments/:id/cost-adjustments` → before/after list (criterion 3).
- **Deliberately NOT the governance proposal queue**: O2C §7.1 forbids
  internal approve/reject flows and "yêu cầu thay đổi chờ duyệt" — the
  adjust applies directly under permission + reason + history, matching the
  PRD's direct-write rule.

## 6. Migration

Two additive tables only — fresh-replay safe, no backfill (existing
shipments start unlocked). No statement on the PRD-open questions (over/at
threshold, lag reference period) — out of scope by the card's own note.

## Open items for the lead

All three resolved 2026-09-18 (see the rulings block at the top). Nothing
open — this document is the _19 implementation spec.
