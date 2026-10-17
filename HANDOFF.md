# fix-shipments-debit-customer-in-filter-lane — Khách hàng dropdown vào filter lane — DONE (chưa merge)

Controller: this session (Paseo agent), worktree
`fix-shipments-debit-customer-in-filter-lane` (branch-off main @ 9fd0553c).
Updated: 2026-10-17 (tối).

## Mục tiêu + trạng thái

Owner yêu cầu 2026-10-17: dropdown "Tất cả khách hàng" trên `/shipments-debit`
chuyển TỪ bar riêng (`shipment-debit-customer-bar`, trên filter strip) VÀO
filter control lane — control ĐẦU TIÊN của `ShipmentDebitRibbon`'s FilterBar,
trước `DateRangeFields`. **REVERSES card _202** (ghi trong commit message).
DONE: layout/DOM move only, không đổi filter logic.

## Thay đổi (5 file code + 1 testplan, +96/−85)

- `ShipmentDebitRibbon.tsx`: props mới `customerValue` / `customerOptions` /
  `onCustomerChange`; `SearchableSelect` render là bar CHILD đầu tiên (bar
  children never fold → luôn hiện); doc comment nêu reversal.
- `ShipmentDebitPage.tsx`: xóa block customer-bar + hint "Đang xem…";
  `selectedCustomerLabel` + import chết xóa sạch; handler chuyển NGUYÊN VẸN
  (`setSelectedIds(new Set())` + `updateParam('customer', …)`).
- `ShipmentDebitPage.css`: family `.shipment-debit-customer-bar*` xóa hết;
  thay bằng `.shipment-debit-ribbon__customer { min-width:200px;
  max-width:320px }` (sizing-only — band owns layout); phone full-width
  override XÓA (band packing law: `ListFilterBar.css` `.list-filter-bar >
  *:not(.ds-tabs) { min-width: 0 }` @≤640 — floor chỉ hiệu lực ≥641px, đã
  đo confirmed).
- Tests: pins đảo chiều _202 (picker TRONG ribbon, control đầu, precedes
  range, DOM order ribbon→header); hint asserted gone; direct-mount test
  thêm 3 props bắt buộc.

## Quyết định đáng chú ý

- Hint "Đang xem…" BỎ (không vừa gọn trong control lane; trùng lặp giá trị
  trigger). Owner chỉ yêu cầu move dropdown — brief cho phép bỏ.
- `hasFilters`/`Xóa lọc` KHÔNG tính customer (hard rule: không đổi logic).
  → review note cho owner sau này: user lọc chỉ theo customer sẽ thấy
  `Xóa lọc` disabled dù lane đang giữ giá trị — cần owner ruling riêng nếu
  muốn đổi (logic-change task riêng).
- Provenance: house primitives (`FilterBar` + `SearchableSelect`), không
  consult catalog — không component/layout mới.

## Files owned by this task

- 5 file frontend trên + `testplan/2026-10-17-owner-customer-in-filter-lane.md`
- `qa/2026-10-17_customer-in-filter-lane_*` (ignored) + 2 driver
  `qa/drivers/2026-10-17-customer-in-filter-lane-*.mjs`

## QA artifacts + gates

- fe `tsc -b` exit 0; `vitest run src/pages/ShipmentDebitPage*` 48/48 (2
  lần chạy + final sau comment fix — đều exit 0).
- Full fe suite: 5056 pass; 3 fail = 2 numeric-identity (cần dist — pass sau
  `make build`, rerun 54/54 exit 0) + `dev-port-contract` PRE-EXISTING trên
  HEAD (card khác, documented trong handoff trước).
- Root lint exit 0 (5 warning pre-existing ở `backend/src/tests/
  scratch-census-probe.ts`, ngoài diff). `make build` exit 0.
- Rung 3 UI drive (CUS, vite :7275 từ worktree — :7175 thuộc worktree task
  khác, không đụng; đã tắt sau QA): 1440 — picker 200×30 cùng dòng y=154 với
  range 340×30 trong strip, FIRST control, legacy bar gone; CLICK chọn
  "card11 cust…" → URL `?customer=6442`, API `debit-summary?customerId=6442`,
  trigger hiển thị tên; 390 — picker trong strip, precedes range, doc
  overflow 0. DB before/after: shipments 4606 / customers 4774 (read-only).
- Independent review (code-reviewer): DONE, không blocking; 1 comment stale
  đã sửa.

## Unrelated / preserved

- Vite :7175 + backend :3002 của main/checkout khác giữ nguyên.
- Pre-existing fails như trên không thuộc ticket này.

## Next step

- Commit trên branch này (message có "reverses card _202 per owner
  2026-10-17"), KHÔNG merge — report hash cho owner.
