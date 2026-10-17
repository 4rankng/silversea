# HANDOFF — card 171026212000 (retry rb1) — DONE, branch pushed

Controller: this session (Paseo agent), worktree
`fix-171026212000-deposit-bill-lookup-rb1` (branch-off 32168ada).
Updated: 2026-10-18 (~01:15 local). Supersedes the 2026-10-17 two-lane
handoff (both lanes were DONE + merged; nothing was lost).

## Goal + status

FB-096 verify-fail: "Thêm cược" modal's Bill lookup (gợi ý bill từ 4 số
cuối) showed NO suggestions for real lots. **DONE — fixed, gated, reviewed,
UI-driven, committed and pushed** on branch
`fix-171026212000-deposit-bill-lookup-rb1`.

## Root cause (evidence: qa/2026-10-18_171026212000_repro-api.log)

`findBillSuggestions` matched `right(col,4)=digits` — last four
**characters** — while the ruling/label is last four **digits** of the
printed number. 193/444 digit-tailable refs in the prod-mirror DB end in
non-digit suffixes (`-IMP/-FCL/…-9bzut2`, `FB020-R21-RB1`) → never matched.
Landing tests + staging QA only sampled pure-digit tails, so gates passed.

## Changes (branch fix-171026212000-deposit-bill-lookup-rb1)

- `backend/src/services/bill-book-search.service.ts` — tail = last 4 digits
  of the digit run: `right(regexp_replace(col,'[^0-9]','','g'),4)=digits`,
  grouped in drizzle `or()` (review finding: the bare `sql\`A or B\`` inside
  `and()` rendered `(deleted_at is null and A) or B`, bypassing the
  soft-delete filter on the booking branch — pre-existing, now fixed +
  pinned).
- Deleted `backend/src/services/deposit-bill-suggestions.service.ts` —
  orphaned duplicate (zero importers since F6) still carrying the old SQL.
- FE `DepositRefundTrackerPage.tsx/.css` — failed lookup renders
  `role="alert"` error line; "Không có lô hàng nào…" now requires
  success (no flash during load, no lie on 401/5xx).
- Tests: backend `deposit-bill-suggestions.test.ts` (suffix fixtures,
  digit-run-extension pin q=4292, tombstone lot); FE page test +3
  (typeahead/autofill, honest no-match, error line).
- `testplan/2026-10-18-card171026212000-deposit-bill-lookup-digits.md` +
  driver `testplan/qa/2026-10-18_card171026212000/`.

## Decisions worth keeping

- Digit-run semantics: "4 số cuối" = last four digit characters of the
  WHOLE printed number (a `…-9bzut2` suffix's 9,2 continue the run —
  `RARBOOK-1792226038601-9bzut2` is looked up by 0192, not 8601).
- `searchBillBook` (phơi phiếu substring probe, Card 20260905) deliberately
  untouched — different ruling. Observed: its `ilike '%2021%'` also misses
  separated digits; out of scope here, raise separately if the owner wants
  the habit honored there too.
- Sibling `q=9091` exact-empty assertion on the shared mirror DB is a known
  latent flake (pre-existing, noted in its own comment).

## Gates (qa/2026-10-18_171026212000_*.log, all EXIT=0)

backend tsc · backend scoped tests 15/15 (deposit family) · frontend tsc ·
frontend vitest 33/33 (page family) · root lint · make build · rung-3 UI
drive (`_ui-driver.log` EXIT=0; screenshots `_ui-02/03/04`; DB identity +
trackers 696→696 unchanged). Independent code-reviewer pass: DONE_WITH_
CONCERNS → both findings (or() precedence, orphan file) fixed and re-gated.

## Non-goals / not covered

- Staging/prod verification (local dev DB mirror only; deployment needs
  owner instruction).
- Other roles/mobile widths for this modal; the phơi phiếu probe semantics.
- The `…2021`-style examples in old FB-096 artifacts are arithmetically
  wrong for digit-run tails; only new artifacts corrected.

## Next step

Owner re-verify on staging after merge/deploy of this branch.
