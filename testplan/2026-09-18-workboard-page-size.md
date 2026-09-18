# Chọn số dòng mỗi trang (tới 200) trên bảng lô hàng (2026-09-18)

## Nguyên nhân và phạm vi

User báo (ảnh `/shipments`, 2026-09-18):

> i can't search the lo hang could we have feature to select number of rows in
> the table up to 200) currently cannot choose

Hiện trạng: bảng Tổng quan lô hàng luôn cố định **20 dòng/trang** (`Hiện thị
1–20 trên 144`), không có chỗ chọn; muốn xem 144 lô phải bấm qua 8 trang.
Một điểm cần nói rõ để không mất thời gian tìm:

- Tìm lô bằng số container: ô tìm kiếm **header** ("Tìm trang, cấu hình, thao
   tác…") chỉ tìm trang/cấu hình, không tìm dữ liệu lô; muốn tìm theo số
   container phải dùng ô **"Bill/Book hoặc tờ khai"** của trang (backend khớp cả
   `exists(container)` của lô).

Phạm vi sửa: thêm lựa chọn số dòng/trang cho **hai bảng công việc CUS** (Tổng
quan lô hàng và Chi tiết lô hàng), giá trị 20/50/100/200, lưu ở URL; nâng trần
API `limit` 100 → 200. Không đổi cách sắp xếp/lọc, không đổi dữ liệu trả về.

## Bộ case

### TC-PAGESIZE-01 — Chọn số dòng mỗi trang trên Tổng quan lô hàng

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:** mở `/shipments` (144 lô) → ở thanh phân trang chọn `200`.
- **Kết quả mong đợi (Pass):** bảng hiện tối đa 200 dòng trên một trang; dòng
  tổng kết đọc `Hiện thị 1–144 trên 144`; URL thêm `limit=200`; số trang còn 1.
- **Kỳ vọng sai (Fail nếu):** bảng vẫn 20 dòng, hoặc tổng kết không khớp.

### TC-PAGESIZE-02 — Lựa chọn nằm ở URL (chia sẻ được) và mặc định an toàn

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:** mở trực tiếp `/shipments?limit=200`; sau đó
  `/shipments?limit=37` (giá trị không có trong danh sách).
- **Kết quả mong đợi (Pass):** `limit=200` tải 200 dòng và selector hiển thị
  `200`; `limit=37` bị bỏ qua, dùng mặc định 20 và selector hiển thị `20`.
- **Kỳ vọng sai (Fail nếu):** giá trị lạ gửi thẳng xuống API, hoặc selector lệch
  với dữ liệu đang tải.

### TC-PAGESIZE-03 — Đổi số dòng đưa về trang 1

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P1
- **Các bước:** đang ở trang 3 → chọn `50`/`100`/`200`.
- **Kết quả mong đợi (Pass):** URL mất `page`, bảng tải trang 1 với kích thước mới.
- **Kỳ vọng sai (Fail nếu):** giữ `page=3` và hiện khoảng dòng vượt quá tổng.

### TC-PAGESIZE-04 — Áp dụng cho cả bảng Chi tiết lô hàng

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P1
- **Các bước:** mở `/shipments-detail`, chọn `200` ở thanh phân trang.
- **Kết quả mong đợi (Pass):** bảng container tải 200 dòng/lần; tổng kết
  `Trang này có N / M container phù hợp` khớp; URL có `limit=200`.
- **Kỳ vọng sai (Fail nếu):** chỉ bảng Tổng quan có lựa chọn.

### TC-PAGESIZE-05 — Trần API và bàn phím/cảm ứng

- **Vai trò:** `cus` (chứng từ) / API
- **Mức độ:** P1
- **Các bước:** gọi `GET /api/shipments/cus-workspace?limit=200` (nhận) và
  `limit=201` (từ chối 400); Tab tới selector bằng bàn phím; xem ở 390px.
- **Kết quả mong đợi (Pass):** 200 nhận, 201 trả 400; selector Tab tới được,
  nhãn đọc `Số dòng mỗi trang`, ở màn cảm ứng cao ≥ 44px.
- **Kỳ vọng sai (Fail nếu):** API nhận 201, hoặc selector không có nhãn/không Tab tới.

## Ghi chú thực thi

- Nhãn dùng chung `SHIPMENT_CUS_PAGE_SIZES = [20, 50, 100, 200]` (shared) — URL,
  selector và trần API cùng một nguồn.
- `Pagination` (design-system) chỉ hiện selector khi có `pageSizeOptions` **và**
  `onPageSizeChange`, nên bảng khác không đổi hành vi.
- Test: `Pagination.test.tsx` (selector + không có handler thì không hiện),
  `ShipmentsPage.test.tsx` (URL `limit=200`, fallback 20), `use-cus-detail*`,
  `use-cus-workspace-state.test.tsx` (limit truyền xuống API).

## Kết quả chạy (local dev, 2026-09-18)

Driver (tracked, chạy lại được): `testplan/qa/scripts/ui-page-size-20260918.mjs`
→ ảnh + `qa/2026-09-18-page-size/ui-driver.log`. Tài khoản `thanhdc`, dữ liệu dev
380 lô.

| Case | Rung | Bằng chứng |
| --- | --- | --- |
| TC-PAGESIZE-01 | UI DRIVEN | `qa/2026-09-18-page-size/2026-09-18T07-30-22-169Z_01-default-20.png` (mặc định `Hiển thị 1–20 trên 380`), `…_02-rows-200.png` + log: chọn `200` → **200 dòng**, `Hiển thị 1–200 trên 380`, URL `/shipments?limit=200`, request `/shipments/cus-workspace?page=1&limit=200` |
| TC-PAGESIZE-02 | UI DRIVEN | log: `/shipments?limit=37` → selector `20`, 20 dòng (giá trị lạ bị bỏ qua, API vẫn `limit=20`) |
| TC-PAGESIZE-03 | Unit | `ShipmentsPage.test.tsx`: đổi `select` → `apiGet` gọi `limit=50` (URL đổi, `page` bị xóa theo `updateParam`) |
| TC-PAGESIZE-04 | UI DRIVEN | `…_03-container-rows-200.png` + log: `/shipments-detail` có selector `20/50/100/200`, chọn 200 → 200 dòng, URL `…&limit=200` |
| TC-PAGESIZE-05 | API + Unit | `curl` local: `limit=200` → `items=200`; `limit=201` → 400 `Number must be less than or equal to 200`. Selector có nhãn `Số dòng mỗi trang` (test `Pagination.test.tsx`), luật cảm ứng `min-height: var(--control-touch-h)` trong `Pagination.css` |

Gates cho thay đổi này: `pnpm lint`, `cd frontend && npx tsc -b`, bộ test frontend
liên quan (180 test / 8 file, xem `qa/2026-09-18-page-size/frontend-tests.log`),
`cd backend && pnpm test`, `cd e2e && ./run_all.sh`, `make build`.

**Chưa phủ (Not covered):** 390px thật cho selector (chỉ có luật CSS + test đơn
vị); hàng đợi nhiều vai trò; hành vi khi tổng số dòng < số dòng mỗi trang.
