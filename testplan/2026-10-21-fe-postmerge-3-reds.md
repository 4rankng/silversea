# Card 211026_blank — 3 FE đỏ post-merge trên main d263149b (full-suite catch)

Nguồn: brief 21/10. Full FE 5401 tests → 3 đỏ mà scoped suites xanh. Branch
`fix-fe-postmerge-3` off main `d263149b`. Repo rule: regression case trước khi
sửa — bài này ghi 3 case dưới đây kèm reproduce + expected; evidence run
thật nằm ở `qa/2026-10-21_fe-postmerge-3_*.log`.

## Case 1 — dev-port-contract: QA script hardcode port 7185

- **Reproduce:** `cd frontend && pnpm exec vitest run src/tests/dev-port-contract.test.ts`
  → test `leaves no live QA script hardcoding a frontend port` FAIL với offender
  `2026-10-21-cus10-drawer-delete-ui-drive.mjs:7185`. Contract test quét TOÀN BỘ
  text (kể cả comment) của mọi `testplan/qa/scripts/*.mjs`, cấm port ≠ 7175/3002;
  script cus10 (commit gần 21/10) ghi port `7185` trong dòng usage — code thì
  đúng luật (đọc `QA_BASE` từ env, không hardcode) nhưng comment vi phạm.
- **Expected:** không script QA nào kể comment chứa `localhost:<port>` ngoài
  7175 (FE) / 3002 (API). Contract KHÔNG bị weaken.
- **Fix:** sửa comment usage `7185 → 7175` (một dòng). Script giữ nguyên cơ chế
  bắt buộc `QA_BASE` từ env.

## Case 2 — FB-066 lần 3 (card 201026101600): quick-add "Nhà xe" race trong full-suite

- **Reproduce:** fail chỉ trong full-suite (repro thật: run 3,
  `qa/2026-10-21_fe-postmerge-3_full-vitest-red-run3-fb066-repro.log`) — test
  `lô CHƯA có nhà xe: dialog hỏi "Nhà xe"…` FAIL tại dòng sau khi click option
  `HÀ AN`: `Unable to find button "Áp dụng"`. Dump roles cho thấy popover
  `role=dialog name "Nhà xe"` VẪN MỞ — react-aria aria-hide-outside khi popover
  mở làm mọi node ngoài (nút "Áp dụng") vô hình với `getByRole`. Standalone
  xanh vì act-flush kịp; full-suite CPU contention làm settle popover trễ quá
  bước query kế tiếp. Hai full-run trước không repro → đúng dạng race.
- **Expected (contract giữ nguyên, card 201026101600):** popover đóng sau pick/
  Escape; test chờ popover đóng trước khi query tiếp (cùng pattern anh em
  `DispatchPlanEditorCell.test.tsx::selectExternalCarrier` — waitFor selection
  land). Production behavior không có lỗi gì để sửa.
- **Fix (test-only):** 2 settle-wait `queryByRole('dialog', { name: 'Nhà xe' })`
  → null sau Escape (vòng 1) và sau pick HÀ AN (vòng 2) + `configure({
  asyncUtilTimeout: 4000 })` scoped từng file (isolation vitest, không leak).
  Assertions giữ nguyên byte.

## Case 3 — KT4 cost-dot × FB-093 lan 3: picker mất rollup essential

- **Reproduce:** `AccountingDebitClosePage.cost-dot.test.tsx` test
  `the dot column is pinned — the picker never offers it, and the essential
  default opens ≤6 columns` FAIL cả scoped: `Unable to find checkbox "Tổng thu"`
  trong picker. Root-cause: FB-093 lan 3 (`0c263b00`) đổi `hideableColumns`
  (loại essential + essentialWhenHasData) và `ColumnPickerPanel` render
  `hideableColumns()` → rollup `Tổng thu`/`Tổng 1` biến mất khỏi picker, xung
  đột trực tiếp với pin KT4 (card 191026181942) "hai rollup hiển checked,
  breakdown ẩn unchecked-one-toggle-away".
- **Expected (cả hai luật cùng thỏa):** dot column (và mọi cột pinned) không
  bao giờ được offer; rollup essential HIỆN trong picker ở trạng thái checked;
  breakdown thường toggle được; KHÔNG có hành động picker nào dấu một cột mà
  lựa chọn không được phép ẩn (FB-093 lan 3: sanitize + toggle-refuse giữ
  nguyên).
- **Fix:** `ColumnPickerPanel` render mọi cột non-pinned theo thứ tự bảng;
  cột required (essential/essentialWhenHasData) render LOCKED — checkbox
  disabled, checked-state phản chiếu đúng trạng thái board (không offer hành
  động mà `toggleHiddenColumn` vốn từ chối). Logic `column-visibility.ts`
  KHÔNG đổi (unit pin lan-3 giữ nguyên); docstring cập nhật theo UI thật.
  Pin mới ở component level: `ColumnPicker.test.tsx` "lists a required column
  LOCKED…".

## Gates (branch này)

| Gate | Kết quả | Artifact |
|---|---|---|
| Full vitest | 701 files / 5402 tests / 0 fail, exit 0 | `qa/2026-10-21_fe-postmerge-3_full-vitest-green.log` |
| `npx tsgo -b` (frontend) | exit 0 | `qa/2026-10-21_fe-postmerge-3_tsgo.log` |
| `pnpm lint` (root) | 0 errors | run tại máy, exit 0 |
| `make build` | succeeds | `qa/2026-10-21_fe-postmerge-3_make-build.log` |
| Independent review | DONE, no concerns (code-reviewer subagent) | ses_ea35f1842ffey23OTF1QcOdBHl |

Ghi chú trung thực: run 2 đỏ 2 test `numeric-identity.styles.test.ts` do
worktree mới chưa có `dist/assets` (test tự yêu cầu build trước) — environmental,
không phải regression; sau `make build` xanh. FB-066 repro được đúng 1/3 full-run
(run 3) trước fix; sau fix run full-suite xanh.
