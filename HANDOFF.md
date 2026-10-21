# ENV-01 — make stgqa: clone prod→staging + auto-purge + QA fixture riêng — 2026-10-21

Controller: this agent, worktree feat-env01-stgqa (off main 1b56eeea).
Supersedes the REQ-19 handoff (status DONE, merged in f0877875 — verified).

**Status**: DONE — pipeline + unit/integration evidence + docs + commit/push.
Issue card: 4rankng/silversea#10. Regression case:
testplan/cases/case-2026-10-21-env01-stgqa-pipeline.md.

## Scope

- `make stgqa` (Makefile, NEW): stgdb sync (đã gồm QA-class purge) → reset
  mật khẩu Abc123 → seed fixture QA. Preflight chặn nếu image staging thiếu
  script ENV-01 (không bỏ staging với mật khẩu prod-set giữa chừng).
- `make stgqa-seed` (NEW): re-seed fixture sau `make demo`/`make qapurge`.
- backend/src/seed/stgqa-fixtures.ts (pure catalog: BU QA-DEMO, KH QAKH-DEMO,
  nhà xe QAKHO-DEMO, 4 lô QAENV01-* FCL-IMP/FCL-EXP/LCL/FCL-KEP 2×20DC).
- backend/src/seed/seed-qa-fixtures.ts + reset-staging-passwords.ts
  (executors; gate STGQA_ENV=local|staging + refuse prod host, cùng luật
  purge-qa-fixtures.ts). Idempotent upserts theo natural key, revive
  soft-deleted; BU hard-delete ⇒ seed ghi lại responsible_unit_id khi revive.
- Định hướng tham chiếu theo CHECK constraint + census prod: EXPORT→booking_ref,
  IMPORT→bl_number (ngược quy ước thế giới — đây là luật repo).

## Non-goals / decisions

- KHÔNG đổi hành vi `make stgdb` (mirror thuần). KHÔNG purge theo isAdHoc —
  lệnh chạy ngoài là dữ liệu kinh doanh thật. KHÔNG chạy trên staging trong PR.
- Fixture nằm trong QA marker class (qa-fixture-markers) ⇒ FB-061 giữ nguyên:
  view gương-prod ẩn, qapurge dọn.

## Evidence (qa/)

- 2026-10-21_env01-stgqa_lint.log / _be-tsc.log / _be-test.log (338+330) /
  _build.log — exit 0 hết.
- 2026-10-21_env01-stgqa_probe.log + 2026-10-21-env01-stgqa/probe-result.json
  — 13/13 PASS trên local dev DB (seed 2× idempotent, users không đụng,
  reset gộp hash, purge dọn class, re-seed phục hồi cùng lot ids).

## Remaining (next owner)

- Chạy thật `make stgqa` trên staging SAU khi `make demo` deploy image chứa
  ENV-01 (owner instruction) — chưa có lần chạy staging nào.
- Staging drive UI (rung 3) chưa làm — PR chỉ cài đặt + hướng dẫn per brief.
