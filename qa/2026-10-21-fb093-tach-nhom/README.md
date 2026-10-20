# qa/2026-10-21-fb093-tach-nhom — UI evidence (card 211026024348)

FB-093 follow-up: thiếu nút "Tách nhóm" cho Ghép cước thu khách. Driver:
`testplan/qa/scripts/2026-10-21-fb093-tach-nhom-ui-drive.mjs` (env-only ports,
dev-port-contract). Regression cases: `testplan/2026-10-21-fb093-tach-nhom.md`.

## Staging BEFORE (read-only, build f056944f, CUS tiepvv)

- `staging-repro-ui-driver.log` — 2/2 PASS: board có dòng merge ("Ghép cước cùng
  Bill …", 0₫) nhưng **0** nút "Tách nhóm"/"Hủy ghép" → defect tái hiện.
- `staging-ui-00-repro.png` · `staging-dom-00-repro.txt`.
- KHÔNG ghi data staging (read-only).

## Local AFTER (worktree build, CUS thanhdc, customer UI KHÁCH HÀNG B77AP2)

Fixture: lô `UI-LCL-B77AP2-3` (104252) + `UI-LCL-B77AP2-5` (104254), cùng KH,
cùng tuyến, trip live CREATED + snapshot cước riêng. Stack: backend :3021 +
frontend :7188 (worktree, DB dev :5441 chung).

- **(a) ghép** — `local-merge-ui-driver.log` 10/10 · `local-ui-01-pre-merge.png`
  (3.050.000 / 1.800.000) · `local-ui-02-merge-dialog.png` ·
  `local-ui-03-merged.png` (Lô 1 = 4.500.000 + nút Tách nhóm; Lô 2 = 0₫ +
  "Ghép cước cùng Bill UI-LCL-B77AP2-3" + nút Tách nhóm) ·
  `local-dom-03-merged.txt` · `db-2-after-merge.txt`.
- **(b) tách nhóm** — `local-tach-ui-driver.log` 5/5 ·
  `local-ui-04-tach-confirm.png` · `local-dom-04-tach-confirm.txt`.
- **(c) tiền về** — `local-ui-05-after-tach.png` (3.050.000 / 1.800.000, note
  ghép dọn, hết nút) · `local-dom-05-after-tach.txt` · `db-3-after-tach.txt`
  (revenue về 3.000.000/1.800.000 = revenue_original, `revenue_override_reason`
  NULL, rev_group_id NULL) + audit `SHIPMENT_LCL_GROUP_UNMERGED` cause
  `UNMERGE_GROUP` members=2 (rows 143955, 143961).
- `db-1-before-merge.txt` — DB state trước khi ghép.

Coverage table (rung/not covered): xem HANDOFF.md lane
"FB-093 follow-up — nút Tách nhóm" (section §9).
