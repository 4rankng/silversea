# SIL-554 — Văn bản nội bộ (mã ticket / ghi chú rà soát) lộ ra giao diện

- Ticket: SIL-554 (board SIL, internal id 628) — owner complaint: app hiện
  "Số Bill và Số Booking không thể cùng thuộc một lô hàng. Số tờ khai nhập/sửa
  theo từng container trên Tổng quan (SIL-521)." và "Số tờ khai lưu theo từng
  container của lô; … (FB-109) … (SIL-521: …)" cho người dùng.
- Audit (AST, comments excluded) quét `frontend/src` + `shared/src` +
  `backend/src`: 2 file frontend production dính mã ticket, 1 file dính ghi chú
  rà soát (không mã ticket) → 3 chỗ dưới đây. Portal khách hàng
  (`frontend/src/pages/portal/`) sạch.

## Repro (trước fix)

1. `/shipments` → bảng lô hàng → click ô CHỨNG TỪ (icon sửa) của một lô →
   modal "Chỉnh sửa Chứng từ" mở → đọc dòng help ở cuối phần Bill/Booking.
2. `/shipments-detail` (Tổng quan) → click ô Số tờ khai của dòng container FCL
   → editor inline mở → đọc dòng `<small>` dưới ô nhập.
3. `/customers` → Sửa một khách hàng có chế độ ghi chú nợ "Theo lô" → đọc
   nhãn lựa chọn + dòng mô tả dưới select.

## Case pin (expected sau fix)

- **COPY-01 / AC-01 (modal Chứng từ)**: modal "Chỉnh sửa Chứng từ" KHÔNG còn
  dòng "Số Bill và Số Booking không thể cùng thuộc một lô hàng." và không còn
  chuỗi chứa `SIL-521`. Dòng hướng dẫn "Chọn Nhập hoặc Xuất trong mục Phân
  loại trước khi cập nhật Bill/Booking." VẪN hiện khi lô chưa có hình thức
  (QA case `testplan/qa/cases/shipments-qa/TC-SHIP-QUICKEDIT-001.mjs` đang
  assert dòng này — không được đụng).
- **COPY-02 / AC-02 (Tổng quan, FCL)**: editor inline Chứng từ của dòng
  container FCL hiện gợi ý đúng câu "từng container của lô — mỗi container
  giữ số tờ khai riêng; nhập số ở một container sẽ tự điền sang các container
  còn trống."; không có `FB-109` / `SIL-521`.
- **COPY-03 / AC-03 (Tổng quan, LCL)**: gợi ý lô hàng lẻ vẫn bắt đầu bằng
  "Số tờ khai lưu theo LÔ hàng lẻ" (pin hiện có:
  `frontend/src/features/shipments/detail/ShipmentContainerLedger.sil503-lcl-cell-edit.test.tsx:213`).
- **COPY-04 / AC-04 (form khách hàng)**: nhãn lựa chọn + mô tả chế độ ghi chú
  nợ không chứa "legacy" và không chứa "cần rà soát"; nghĩa vụ chưa đổi (chế
  độ Theo lô vẫn hiện, vẫn disabled, vẫn không tự đổi sang Theo tuần).
- **COPY-05 / AC-05 (chặn tái phát)**: `frontend/src/internal-product-copy.test.ts`
  (guard AST sẵn có, chỉ quét file production) fail nếu chuỗi runtime nào
  chứa mã ticket nội bộ `SIL-###` / `FB-###` / `QA1-###` hoặc cụm
  "cần rà soát". Mã nghiệp vụ (biển số, số cont, Số Bill/Booking, số tờ khai)
  KHÔNG bị chặn.

## Regression evidence

Gates (all green, logs under `qa/2026-10-28_sil554-internal-copy/`):

- `gates-lint.log` — `pnpm lint` → 0 errors (4 pre-existing warnings ở
  `ShipmentContainersPage.tsx` / `CustomersConfigPage.tsx`, không thuộc change này).
- `gates-tsc-frontend.log` — `cd frontend && npx tsc -b` → 0 errors.
- `gates-tests-frontend.log` — `cd frontend && pnpm test` → 741 file / 5716 test
  PASS (EXIT=0). Scoped trước đó: `internal-product-copy.test.ts` +
  `customerDebitNoteMode.test.ts` + `ShipmentContainerLedger.sil503-lcl-cell-edit.test.tsx`
  → 14/14 PASS.
- `gates-build.log` — `make build` → shared + backend + frontend build OK (EXIT=0).

UI drive (rung 3) — `qa/scripts/2026-10-28-sil554-internal-copy-ui-drive.mjs`,
EXIT=0, 18/18 check PASS, artifacts `qa/2026-10-28_sil554-internal-copy/run1/`:

| Rung | Check | Bằng chứng |
|---|---|---|
| A | Modal "Chỉnh sửa Chứng từ" không còn dòng nội bộ (5 modal mở thật trên `/shipments`, gồm modal lô CHƯA có hình thức) | `run1/ui-a-quickedit-documents-modal.png`, `run1/ui-a-quickedit-no-direction-guidance.png`, `run1/assertions.json` |
| A | Dòng hướng dẫn "Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhật Bill/Booking." CÒN nguyên | `run1/ui-a-quickedit-no-direction-guidance.png` + assertion "A/no-direction lot keeps the user guidance line" |
| B | Editor inline Chứng từ của container FCL (MSKU5210010) hiện câu plain "từng container của lô — mỗi container giữ số tờ khai riêng; nhập số ở một container sẽ tự điền sang các container còn trống", không có FB-109/SIL-521 | `run1/ui-b-tong-quan-fcl-declaration-editor.png` |
| B | Lô hàng lẻ (Lô R34-LCL1) vẫn hiện "Số tờ khai lưu theo LÔ hàng lẻ — nhập hoặc sửa số một lần cho cả lô" | `run1/ui-b-tong-quan-lcl-declaration-editor.png` |
| C | Form khách hàng (/config/customers) hiện nhãn "Theo lô (chế độ cũ — không tự động chuyển)" + mô tả nghiệp vụ; options đọc được: `["Theo tháng","Theo tuần theo hợp đồng","Theo lô (chế độ cũ — không tự động chuyển)"]` | `run1/ui-c-customer-debit-note-mode.png` |
| DB | Change read-only: hash shipment identity trước/sau drive giống nhau (`db-shipments-before.txt` / `db-shipments-after.txt`); chỉ khách hàng id=1 được flip tạm PER_BATCH để quan sát rồi RESTORE (count PER_BATCH = 0 sau drive, `db-customers-after-restore.txt`) | `run1/db-*.txt` |
| Driver | `run1/ui-driver.log` (command + từng assertion + EXIT=0) | `run1/ui-driver.log` |

Chưa phủ (nêu rõ): role khác (Điều vận/ lái xe/Kế toán), viewport mobile 390/768,
staging/prod, và dữ liệu runtime ghi vào từ DB (ghi chú, lý do read-only) — guard
chỉ quét chuỗi viết trong mã nguồn.

