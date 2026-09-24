# Current Development Handoff

**Updated:** 2026-09-24 ~15:25 (+08)
**Controller:** Director (native Claude session, glm-5.3-flash) — wave c12 "chi-phí gap + audit" close
**Status:** COMPLETE — board drained, 3 staging cuts deployed, report delivered. Prod deploy awaits BOSS go.

## Goal

Complete the chi-phí wave ordered by CHIEF 24/09: implement the 3 "KHÔNG TÌM THẤY" gaps from
the nghiệm-thu docx (chot-debit settlement popup, OPS sổ quỹ, deposit-tracker warnings), fix
every audit finding, close the full kanban board, and deliver the user test report.

## Delivered (all staging-verified)

- **Gap cards**: `_12` chot-debit Chọn Debit popup (Lần/Tháng/VAT 0-5-8-10% auto-computed, TỔNG
  HỢP CÔNG NỢ auto-fill, idempotent, registry-complete) `920a2078`+`5c8e668e`; `_13` OPS
  partial read-only Sổ quỹ `7fbc01db`+`8ac6ac2c` (+ADR `docs/adr/2026-09-24-ops-fund-book-scoped-read.md`);
  `_14` deposit-tracker +7-day overdue red banner + chưa-hoàn-cược total `2c0c0c03`.
- **Audit families**: cluster A (ops-orders form), B (phoi-phieu/debit display + seed-name
  migration `19a77628`+`c41022b9`+`26f6f41a`, payer split + cash-voucher 409 gate, ADR
  `docs/adr/` expense-payer-scope), correction family `deb27c03`+`26f6f41a`, sanitiser retirement `2bb1eded`.
- **Quotation**: `_57` full close (D1 preview≡commit `2d07c15a`, D2 norms `f4abfc87`, D3 already-fixed),
  import inherit ruling (ii) landed pre-freeze (`c41c5e74`), `DEDICATED_DEPOT` rename `077355b6`,
  `_64` Phase A/B (`8fb54074`, `ed059c45`), `_2` shadow totals (`855aef81`, `c4ecda9d`),
  `_3` unattached-trips section (`639c9116`, `6918e234`).
- **Tooling/infra**: `_4` keyed-POST hang root-caused to harness (Redis teardown) `f5578db3`;
  `_5` registry sweep `6405513a`; trio coherence checker `f90a5930`; journal restamp heal
  `a43676ce`; post-deploy migration gate now PERMANENT in the cut runbook.
- **QA**: 3 staging cuts (a26035d9 → 639c9116 → c41c5e74), each with buildHash + asset guard +
  migration-gate verification; 16 wave cards QA_PASSED with per-criterion artifacts; negative
  paths (401/403/409) + mobile 390 + UX sweeps all covered.
- **Docs/report**: PRD deltas + BaoGia.md + CHANGELOG staged at wave close; user test report
  `Bao-cao-kiem-thu-khoi-chi-phi-25-09-2026.docx` (23 images) in OneDrive shared + ~/Downloads.

## Rulings/decisions Chief may want on record

- `_13` = OPS **partial read-only** sổ quỹ (Chief 24/09); treasury stays accountant-only.
- Payer scope split: phoi-phieu voucher pays chi-hộ/OPS sources; cash/vouchers is the sole
  DRIVER payer; approved-only guard on BOTH (ADR landed).
- Port-names-are-data: `DEDICATED_LACH_HUYEN` → `DEDICATED_DEPOT` rename (`077355b6`).
- Import fee semantics = inherit prior frame's catalog (option ii); file-as-fee-source deferred (backlog `_8`).
- Flat design law: NO 3D, NO box-shadow (Chief 24/09) — in `docs/design-guidelines.md`.
- F1 shadow-totals: L1 totals exclude fulfillment-less fees with visible red summary line;
  L2 unattached section shipped display-only.

## Fleet governance notes

- LaneB stopped 14:00 after 4 directive-fidelity failures (final: committed while restricted).
  Policy: future probes via fresh ONE-SHOT omp spawns with read-only charter in the prompt;
  one-shot workers cannot go rogue between dispatches.
- mimo died mid-gates 24/09 morning; its card was absorbed by LaneB/BE.
- Worker claims are verified against disk/artifacts before acceptance (two workers claimed
  files that didn't exist).

## Remaining (not feature debt)

1. **PROD DEPLOY** — all staging gates green on `c41c5e74`; awaits BOSS's explicit go (hierarchy law).
2. Backlog cards in TODO: `_8` (import file-as-fee-source enhancement), `_9` (390px shadow-line
   wrap), `_10` (date-segment padding polish).
3. Stash `pre-polish-patch` (stash@{0}): old advance-services refactor (14 files, −630/+172),
   owner unknown, does not map to landed work — KEPT, not dropped; recommend owner confirmation
   or cherry-pick review next session.
4. Polish wave next: shadow-line wrap + date-segment + any Chief-reported visual issues → mimo-style worker per model law.

## Task-owned files

- `HANDOFF.md` (this file)
- `plans/reports/c12-*.md` (16 lane/worker reports), `plans/reports/c12-agy-card6-mobile-ui.md`
- `testplan/case-QA-2026-09-24-0{1..9}*.md` (wave regression cases)
- `docs/adr/2026-09-24-*.md` (fund-book scoped read, expense payer split)
- `docs/design-guidelines.md` (flat law), `docs/prd/QuyTrinhO2C.md` + `docs/prd/BaoGia.md`
