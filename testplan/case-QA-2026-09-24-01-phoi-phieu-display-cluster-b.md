# Case QA-2026-09-24-01 — Phoi-phieu display cluster (audit c12 cluster B): seed-id labels on board rows, phiếu-chi counter disconnected from approvals, and clipped money headers in the tiền đường modal

- **Case ID:** QA-2026-09-24-01
- **Reported:** 2026-09-24, director work order c12 addendum (cluster B, bugs B1 + B2), reference
  screenshots `/tmp/opencode/c12/annotated/image11.png` (board rows) and `image13.png` (tiền đường modal).
- **Surface:** Kiểm soát phơi phiếu page (`/accounting/phoi-phieu` route family) — board table
  (`PhoiPhieuControlPage.tsx`) and the "Chi tiết tiền đường" modal (`PhoiPhieuTienDuongDialog.tsx`).
- **Status:** FIXED — all three sub-bugs landed: `de852096` (modal header clip) and the second-pass
  commit (board seed-id labels + toolbar zero state; sha in the lane report). The mid-run collision on
  `PhoiPhieuControlPage.tsx` lifted when the parallel lane's in-flight edits left the worktree
  (verified twice before landing).

## Sub-bugs and verdicts

| # | Symptom | Root cause (verified in source) | Verdict |
|---|---------|-------------------------------|---------|
| B1 | Board rows read `ADC P 1790089547534-zcain7` / `ADC route P 1790089547534-zcain7` under KHÁCH HÀNG / route (image11). Operator annotation: "không rõ ý nghĩa". | The strings are the seed fixtures' literal `customers.name` / `routes.name` values (dev DB rows 436/437: `ADC P 1790089547534-zcain7`), rendered verbatim by `PhoiPhieuControlPage.tsx:220` from `phoi-phieu-control.service.ts:97,100`. Naming pattern `<label> <epoch-ms>-<rand>` comes from backend test fixtures (cf. `accounting-debit-close.test.ts:153-154`). NOT a raw DB id column rendering — it is id-like seed *names* flowing into the row. | FIXED — display-level sanitiser `businessName()` (`frontend/src/lib/business-label.ts`) strips trailing ` <13-digit-epoch>-<alnum>` seed suffixes at render; customer/route/driver cells on the board show business names only. |
| B2-counter | Toolbar button "Lập phiếu chi (0 dòng)" while approved entries exist in the modal (image13, annotation 4). | The button is the PAGE toolbar (`PhoiPhieuControlPage.tsx:194`), not the modal: it counts checked trips (`selected.size`); the modal (`PhoiPhieuTienDuongDialog`) has no voucher button. Approving entries in the modal cannot move that counter. Counter is truthful for what the button does, but disconnected from approval state. | FIXED (UI copy) — zero state now instructs "— chọn dòng đã duyệt" instead of showing a false "(0 dòng)"; the count renders only when >0 trips are checked. The deeper voucher-semantics flag below stands for Director review. |
| B2-headers | "LÁI XE NHẬP BAN ĐẦU (Đ)" and "THỰC CHI HI..." clip mid-token in the modal table (image13). | `.tt-table` is `table-layout: fixed` (`Table.css:489`) + `thead th { white-space: nowrap }` (`Table.css:503`): 7 equal-share ~91px columns inside the 640px modal shell clip the two longest headers. | FIXED — modal widened 640→760px; headers wrap at spaces (`white-space: normal; word-break: keep-all; overflow-wrap: normal`) mirroring the board's pinned thead contract (card 20260922_54, design law §4). |

## Business-semantics flag (Director ruling needed before B2-counter fix)

`createPhoiPhieuVoucher` (`phoi-phieu-control.service.ts:256-307`) consumes ALL `RECORDED` chi-hộ
(OPS) sources with remaining>0 for the checked trips and never filters on `confirmedAt`, while the
modal's note claims "Khoản đã duyệt mới được lập phiếu chi thanh toán cho lái xe". Additionally the
voucher engine consumes only OPS sources — approved DRIVER (tiền đường) entries are never paid by
this button at all. So "what should the counter count" is a business question (checked trips? trips
with confirmable=true? approved entry count?), not a UI string change. Per the ask-first rule this
was escalated, not unilaterally redefined.

## Collision note (mid-run event, resolved)

The parallel lane (mimo) was actively editing `PhoiPhieuControlPage.tsx` (Báo-cáo-tháng header) and
`PhoiPhieuChiHoDialog.tsx` when this case opened; per the work-order pre-check LaneB stopped and
reported. The collision lifted when the parallel lane's in-flight edits left the worktree — the page
file verified clean vs HEAD twice, immediately before the second-pass edits and landing. Fix specs
that became the second pass:

- **B1:** in `PhoiPhieuControlPage.tsx` rows (lines 216-240), pass `customerName`/`routeName`
  (and on parity surfaces, driver name) through a display-level sanitiser that strips trailing
  ` <13-digit-epoch-ms>-<alnum>` seed suffixes before render (pure helper in `frontend/src/lib/`,
  red-first component test: fixture row with id-like name renders without the raw pattern).
- **B2-counter:** after a Director ruling on the semantics above, re-source the counter at
  `PhoiPhieuControlPage.tsx:194`.

## Automated fence (must stay green)

- `frontend/src/features/accounting/PhoiPhieuTienDuongDialog.test.tsx` →
  `modal table headers never clip (case QA-2026-09-24-01; design law §4)` — RED pre-fix (no inline
  wrap style; 640px shell), GREEN post-fix.
- `frontend/src/features/accounting/PhoiPhieuDialogs.test.tsx` →
  `board rows show business names only — seed id suffixes never render` and
  `phiếu toolbar zero state instructs instead of showing a false "(0 dòng)"` — both RED at HEAD,
  GREEN post-fix.
- `frontend/src/lib/business-label.test.ts` — pure-helper unit fence for the seed-suffix strip.
- Gates at landing: 4 suites 25/25 green; repo-wide `tsc -b` red ONLY on a foreign untracked file
  (`src/api/opsClient.ts`, another lane's in-flight token); zero errors in this cluster's files.

## Browser rung needs (QA lane, serialized)

Verifying the modal headers on the live stack (vite :7175): open Kiểm soát phôi phiếu → "Xem chi
tiết" on a trip with cost entries → headers read whole at 1280×800; screenshot to this case's
evidence. The board-row label check (B1) can ride the same session.
