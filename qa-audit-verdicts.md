# Báo Cáo Kiểm Tra Đối Kháng (Adversarial Audit Verdicts) — 9 Card QA R30 vs Codebase

- **Mục tiêu audit**: Thẩm tra đối kháng (adversarial falsification) độc lập đối với 9 hạng mục QA R30 đánh giá "chưa implement" trên build `6110af65`, so sánh với khẳng định của Orchestrator rằng cả 9 mục "ĐÃ SHIP".
- **Phạm vi kiểm tra**: Mã nguồn thực tế tại commit `6110af65` (build QA chấm) và `HEAD` trên repo SilverSea, kiểm tra lịch sử commit (`git show --stat`), diff logic, unit tests, E2E specs và dữ liệu tiền đề.
- **Nguyên tắc**: Không bênh vực Orchestrator, không chấp nhận kết luận hình thức; truy tìm nguồn gốc mã nguồn, chỉ ra chính xác bề mặt (surface), điều kiện dữ liệu (data preconditions), và lý do vì sao QA có thể soi trượt hoặc hiểu nhầm.

---

## 1. Bảng Tổng Hợp Kết Quả Audit (Executive Verdict Matrix)

| # | Mã Card | Commit đối soát | Khẳng định Orchestrator | Phán quyết độc lập (Adversarial Verdict) | Bề mặt hiển thị (Surface) | Tại sao QA soi trượt? (Root cause miss) |
|---|---|---|---|---|---|---|
| **1** | **cus-11** | `ba9981c2` (FB-113) | ĐÃ SHIP | **SHIPPED** | `/shipments/:id` (Header) & `/shipments-detail` (Ledger) | Mắc bẫy 3 màn hình trùng tên "Chi tiết lô hàng"; header đọc từ entity `shipment_declarations` chứ không đọc per-cont cell. Lô test không có tờ khai cấp lô sẽ hiện `—`. |
| **2** | **dis-09** | `a5e0039b` (Card B) | ĐÃ SHIP | **SHIPPED** | `/dispatch-detail` (Kế hoạch Chi tiết Xe) & `/dispatch` | Nút "Đổi nhà xe/BKS" giấu sâu trong modal của badge `Lẻ · Ghép (1/N)` cột Phân loại; chỉ hiện khi lô ĐÃ GOM NHÓM (cost group). Phát lệnh chờ biển số chỉ kích hoạt với xe ngoài. |
| **3** | **lcl-02** | `032145a2` (Spec §1a) | ĐÃ SHIP | **SHIPPED** | Form Tạo lô `/shipments/create` | Mặc định form là "Nhập khẩu" (tiêu đề vẫn là "Thêm kho lấy hàng"). Chỉ khi chọn radio "Xuất khẩu" tiêu đề mới đổi thành "Thêm kho trả hàng". Chưa chọn Khách hàng thì nút không mở dialog. |
| **4** | **lcl-03** | `0f7e1dfa` (Card D.4) | ĐÃ SHIP | **SHIPPED** | Form Tạo lô `/shipments/create` | Mặc định form là "Hàng FCL" (vẫn còn Lịch & ghi chú). Khi chọn radio "Hàng lẻ (LCL)", section bị xoá bỏ hoàn toàn và thay bằng 1 nút viền đứt "+ Thêm ngày giao hàng". |
| **5** | **lcl-04** | `0f7e1dfa` (Card D.1) | ĐÃ SHIP | **SHIPPED** | Form Tạo lô `/shipments/create` | Nhãn "Ngày giao hàng" ẩn sau nút bấm "+ Thêm ngày giao hàng" (reveal-on-click). Nếu QA chỉ nhìn lướt form mà không bấm nút sẽ không thấy ô nhập ngày. |
| **6** | **lcl-05** | `0f7e1dfa` (Card D.5) | ĐÃ SHIP | **SHIPPED** | Form Tạo lô `/shipments/create` | "Quy cách đóng gói" là Combobox gợi ý (gợi ý từ catalog nhưng vẫn cho gõ tự do). QA có thể thử gõ phím tưởng text thuần, hoặc thấy menu tưởng select cứng. |
| **7** | **lcl-07** | `ea200241` (REQ-19) | ĐÃ SHIP | **SHIPPED** *(Theo ADR/Spec)* | `/dispatch-detail` (Dialog Gán xe nhóm) | Xung đột kỳ vọng: QA mong đợi "chia nhỏ tiền cước theo tỷ lệ kg/CBM", nhưng SilverSea chốt luật 100%/0₫ (Lô 1 giữ 100%, Lô 2..N 0₫). Tính năng cargo-fit advisory nằm bên trong Dialog Gán xe nhóm. |
| **8** | **dri-01** | `f0986f4c` (REQ-14) | ĐÃ SHIP | **SHIPPED** | `/my-trips/:id` (Lái xe nhận lệnh) | Sai Role/URL (vào màn `/trips/:id` của Admin/Điều vận thay vì role DRIVER); click link `tel:` trên máy tính desktop không có ứng dụng gọi điện; hoặc kho không có SĐT khai báo sẵn. |
| **9** | **dri-04** | `3fd77532` / `da73a743` (FB-020) | ĐÃ SHIP | **SHIPPED** | `/my-trips/:id` (Chi tiết lệnh tài xế) | Thử trên chuyến Xuất khẩu (EXPORT — vốn hạ tại cảng biển theo luật); hoặc lô thiếu cả cảng hạ lẫn điểm trả hàng (operational site) nên rơi vào fallback "Chưa có cảng hạ". |

---

## 2. Kiểm Tra Cây Phả Hệ Git (Ancestry Verification on Build `6110af65`)

Một nghi vấn quan trọng của kiểm thử đối kháng: *Liệu các commit này có thực sự nằm trong build `6110af65` mà QA kiểm tra hay không?*

Kết quả chạy `git merge-base --is-ancestor <commit> 6110af65`:
```text
ba9981c2 in 6110af65 -> TRUE (Commit 2026-10-20 16:09:37 +0800)
a5e0039b in 6110af65 -> TRUE (Commit 2026-10-18 20:55:41 +0800)
032145a2 in 6110af65 -> TRUE (Commit 2026-10-18 15:55:34 +0800)
0f7e1dfa in 6110af65 -> TRUE (Commit 2026-10-18 20:35:52 +0800)
ea200241 in 6110af65 -> TRUE (Commit 2026-10-21 08:47:49 +0800)
f0986f4c in 6110af65 -> TRUE (Commit 2026-10-21 08:51:43 +0800)
da73a743 in 6110af65 -> TRUE (Commit 2026-10-18 03:02:31 +0800)
```
**Kết luận phả hệ**: 100% các commit được Orchestrator nêu tên **đều là tổ tiên trực tiếp** của `6110af65` (được merge vào main trước thời điểm đóng gói build `6110af65`). Mã nguồn vật lý chắc chắn đã hiện diện trong bản build. Việc QA đánh giá "chưa implement" bắt nguồn từ sai lệch bề mặt kiểm thử, dữ liệu tiền đề không kích hoạt được logic, hoặc bất đồng về cách hiểu nghiệp vụ.

---

## 3. Phân Tích Chi Tiết Từng Hạng Mục (Adversarial Breakdown)

### 1. `cus-11` — Thứ tự chứng từ & Số tờ khai trên Chi tiết lô hàng
- **Commit**: `ba9981c2` (`fix(qa): FB-113 standing verdict on bf3a0ff9 — surface #3 /shipments/:id header fix (card 171026122140)`).
- **Mã nguồn kiểm tra**:
  - `frontend/src/pages/ShipmentDetailPage.tsx`: lines 246-251, 345-355:
    ```tsx
    const declarationNumbers = declarations
      .map((d) => d.declarationNumber?.trim() ?? '')
      .filter(Boolean);
    ...
    <div><dt>Số Bill / Số Booking</dt><dd>{shipmentLabel}</dd></div>
    <div><dt>Số tờ khai</dt><dd>{declarationNumbers.length > 0 ? declarationNumbers.join(', ') : '—'}</dd></div>
    <div><dt>Xuất / Nhập</dt><dd>{shipment.tradeDirection === 'IMPORT' ? 'Nhập' : shipment.tradeDirection === 'EXPORT' ? 'Xuất' : '—'}</dd></div>
    <div><dt>Hãng tàu</dt><dd>{shipment.shippingLineName ?? '—'}</dd></div>
    ```
  - Test pin: `frontend/src/pages/ShipmentDetailPage.test.tsx` (FB-113 order assertions).
- **Phán quyết**: **SHIPPED**.
- **Bề mặt & Cách kiểm tra**:
  - **Surface 1 (`/shipments/:id`)**: Từ `/shipments`, mở drawer "Chi tiết", bấm nút **"Chi tiết lô hàng"**. Nhìn vào card thông tin chung đầu trang (header fields dl/dt): thứ tự hiển thị chính xác là `Khách hàng` → `Số Bill / Số Booking` → `Số tờ khai` → `Xuất / Nhập` → `Hãng tàu`.
  - **Surface 2 (`/shipments-detail`)**: Bảng kê container dạng bảng (ledger): 4 cột chứng từ liền kề theo thứ tự: `Bill/Booking` → `Số tờ khai` → `Nhập/Xuất` → `Hãng tàu`.
- **Vì sao QA có thể soi trượt?**:
  1. **Bẫy 3 surface cùng tên "Chi tiết lô hàng"**:
     - Surface #1: Pop-up sửa nhanh chứng từ (`mode === 'documents'`).
     - Surface #2: Bảng kê `/shipments-detail` (`ShipmentContainerLedger.tsx`).
     - Surface #3: Trang riêng `/shipments/:id` (`ShipmentDetailPage.tsx`).
     - Surface #4: Màn portal khách hàng `/portal/shipments/:id` (cố ý giữ layout cũ cho đối tượng khách ngoài).
     QA xem nhầm surface hoặc kiểm tra portal sẽ thấy thứ tự khác.
  2. **Hai kho lưu trữ số tờ khai (Data Precondition)**: Header trang `/shipments/:id` đọc từ bảng entity `shipment_declarations` (section "Tờ khai hải quan" của lô). Nếu QA test một lô mà chỉ nhập số tờ khai trong dòng container (`shipment_containers.declaration_number`) nhưng chưa tạo tờ khai lô, header sẽ hiển thị `—`. QA tưởng là "chưa có trường Số tờ khai".

---

### 2. `dis-09` — Đổi nhà xe/BKS nhóm ghép LCL & Phát lệnh chờ biển số
- **Commit**: `a5e0039b` (`feat(dispatch): card 181026185900 B — đổi nhà xe/BKS, phát lệnh chờ biển số (xe ngoài), fix báo gáp nhầm nhóm ghép`).
- **Mã nguồn kiểm tra**:
  - `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx`: lines 719-755:
    Modal "Nhóm ghép trả ĐV" chứa nút `Đổi nhà xe/BKS` mở inline edit `actualTruckNo` & `billingTruckNo`, gọi `updateLclTruck`.
  - `frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts`: lines 276-294:
    Xử lý lỗi 409 `PLATE_DEFERRED_CONFIRM` -> modal xác nhận `"Phát lệnh chưa có biển số xe nhà xe ngoài. Vẫn phát lệnh?"` -> Confirm gửi `plateDeferredConfirmed: true`.
  - `backend/src/routes/shipments/core.routes.ts`: `plateDeferredConfirmed` schema & handler.
  - `frontend/src/features/dispatch/master-plan/MasterPlanGrid.css`: line 305: `.master-plan-grid__location-value + .master-plan-grid__location-value { font-weight: var(--ops-table-primary-weight); }` (in đậm dòng container).
- **Phán quyết**: **SHIPPED**.
- **Bề mặt & Cách kiểm tra**:
  - **Surface 1 (Đổi nhà xe/BKS)**: Vào `/dispatch-detail` (Kế hoạch Chi tiết Xe) → Tìm dòng hàng lẻ đã ghép nhóm → Ở cột "Phân loại", click vào badge **`Lẻ · Ghép (1/N)`** → Modal nhóm mở ra, bấm nút **"Đổi nhà xe/BKS"** ở footer → Nhập BKS thực và BKS báo khách mới → Lưu.
  - **Surface 2 (Phát lệnh chờ BKS)**: Trên `/dispatch-detail`, chọn dòng xe ngoài (EXTERNAL) chưa gán BKS → Bấm "Phát lệnh" → Xuất hiện dialog xác nhận "Phát lệnh chưa có biển số xe nhà xe ngoài. Vẫn phát lệnh?" → Bấm Đồng ý → Lệnh phát thành công.
  - **Surface 3 (Cảng nâng/hạ font weight)**: Vào `/dispatch` → Cột Cảng nâng/Cảng hạ: tên cảng font 400, dòng số lượng container in đậm.
- **Vì sao QA có thể soi trượt?**:
  1. **Ẩn sau tương tác nhiều tầng (Deep modal action)**: Nút "Đổi nhà xe/BKS" không nằm lộ trên bảng hay action bar. Nó chỉ xuất hiện khi click vào chiếc badge nhỏ `Lẻ · Ghép (1/N)` ở cột "Phân loại".
  2. **Điều kiện dữ liệu khắt khe**: Lô bắt buộc phải là LCL **đã được gom thành nhóm chi phí** (`row.lcl?.group != null`). Nếu là lô lẻ đứng một mình (chưa ghép) hoặc hàng FCL, badge và menu này không tồn tại.

---

### 3. `lcl-02` — Đổi tiêu đề dialog thêm kho theo hình thức Xuất / Nhập khẩu
- **Commit**: `032145a2` (`fix(forms): kho quick-add dialog names the trade direction (card 181026143000 §1a)`).
- **Mã nguồn kiểm tra**:
  - `frontend/src/components/shipment/OperationalSiteCreateDialog.tsx`: lines 444-451:
    ```tsx
    title={defaultSiteType === 'WAREHOUSE'
      ? (tradeDirection === 'EXPORT' ? 'Thêm kho trả hàng' : 'Thêm kho lấy hàng')
      : 'Thêm nhà máy'}
    ```
  - `frontend/src/features/shipments/create/ShipmentCreateWorkspace.lcl-points.test.tsx`: line 139: test case kiểm tra đổi chiều Xuất khẩu → "Thêm kho trả hàng", Nhập khẩu → "Thêm kho lấy hàng".
- **Phán quyết**: **SHIPPED**.
- **Bề mặt & Cách kiểm tra**:
  - Truy cập màn hình Tạo lô hàng (`/shipments/create`).
  - Chọn một Khách hàng.
  - Chọn radio **"Xuất khẩu"** và **"Hàng lẻ (LCL)"**.
  - Tại card "Điểm vận hành & tuyến", click nút **"+ Thêm kho"**.
  - Dialog mở lên với tiêu đề chính xác: **"Thêm kho trả hàng"**.
- **Vì sao QA có thể soi trượt?**:
  1. **Form mặc định là "Nhập khẩu"**: Khi vừa mở form, radio được chọn sẵn là "Nhập khẩu". Nếu QA bấm ngay "+ Thêm kho", tiêu đề là "Thêm kho lấy hàng" (giữ nguyên như cũ). QA không bấm chọn radio "Xuất khẩu" thì không thể thấy tiêu đề "Thêm kho trả hàng".
  2. **Nút yêu cầu chọn Khách hàng**: Nếu chưa chọn Khách hàng, bấm nút dialog sẽ không mở (`isOpen` bị chặn).

---

### 4, 5, 6. `lcl-03`, `lcl-04`, `lcl-05` — Form hàng lẻ LCL: Bỏ Lịch & ghi chú, Nhãn Ngày giao hàng, Quy cách gợi ý
- **Commit**: `0f7e1dfa` (`feat(cus): card 181026185900 D — form hàng lẻ: Ngày giao hàng, CBM tuỳ chọn, bỏ Lịch & ghi chú, quy cách gợi ý`).
- **Mã nguồn kiểm tra**:
  - `frontend/src/features/shipments/create/ShipmentCreateWorkspace.tsx`: lines 770-820:
    ```tsx
    {form.cargoMode === 'LCL' ? (
      <div className="csc-extra-dates csc-extra-dates--lcl-minimal">
        <button
          type="button"
          className="btn-ghost-dashed csc-extra-dates__add"
          onClick={() => addDeliveryDate()}
        >
          + Thêm ngày giao hàng
        </button>
        ...
        <label htmlFor="shipment-expected-delivery">Ngày giao hàng *</label>
    ```
  - `frontend/src/features/shipments/create/ShipmentCreateLclCargoFields.tsx`:
    "Quy cách đóng gói" dùng `SearchableField` với danh mục `LCL_PACKAGE_TYPE_SUGGESTIONS` và `allowsCustomValue={true}`. Thể tích CBM không có dấu `*` (tuỳ chọn).
- **Phán quyết**:
  - `lcl-03` (Bỏ Lịch & ghi chú, thay bằng 1 control nút bấm viền đứt): **SHIPPED**.
  - `lcl-04` (Nhãn "Ngày giao hàng" thay cho các loại hạn/lịch): **SHIPPED**.
  - `lcl-05` (Quy cách đóng gói Combobox gợi ý + gõ tự do): **SHIPPED**.
- **Bề mặt & Cách kiểm tra**:
  - Mở form Tạo lô hàng (`/shipments/create`).
  - Bấm chọn radio **"Hàng lẻ (LCL)"**.
  - **Kiểm tra lcl-03**: Nhìn cuối form, section "Lịch & ghi chú" hoàn toàn biến mất. Thay vào đó là nút viền đứt **"+ Thêm ngày giao hàng"**.
  - **Kiểm tra lcl-04**: Click nút "+ Thêm ngày giao hàng" → dòng nhập ngày mở ra với nhãn chuẩn: **"Ngày giao hàng *"**.
  - **Kiểm tra lcl-05**: Tại ô "Quy cách đóng gói", click vào để xem dropdown gợi ý (Bao, Kiện, Thùng, Cuộn, Pallet...). Thử gõ một từ mới (ví dụ "Kiện gỗ") → hệ thống chấp nhận không báo lỗi.
- **Vì sao QA có thể soi trượt?**:
  1. **Không chuyển radio sang "Hàng lẻ (LCL)"**: Form mặc định là "Hàng FCL". Ở FCL, section "Lịch & ghi chú" vẫn hiển thị bình thường.
  2. **Cơ chế Reveal-on-click (Ẩn sau nút bấm)**: Ở chế độ LCL, ô "Ngày giao hàng" ban đầu không hiện sẵn mà ẩn sau nút "+ Thêm ngày giao hàng". QA nhìn lướt tưởng "mất ô nhập ngày".
  3. **Combobox lai giữa Text và Dropdown**: QA có thể chỉ click gõ chữ rồi kết luận "vẫn là text box thông thường, chưa làm dropdown".

---

### 7. `lcl-07` — Thuật toán cước gom nhiều lô theo tải trọng & cảnh báo tải trọng
- **Commit**: `ea200241` (`feat(lcl): REQ-19 cước gom nhiều lô theo tải trọng — depth audit + phân bổ/quy đổi (doc khách RẤT CAO)`).
- **Mã nguồn kiểm tra**:
  - `shared/src/constants/lcl-cargo-fit.ts`: hàm pure `assessLclCargoFit` phân tích tổng kg so với trọng tải xe (1.25T…15T, CONT20/40).
  - `frontend/src/features/dispatch/detailed-plan/AssignTruckGroupDialog.tsx`: lines 180-210:
    Render dòng fit warning: `Vừa tải trọng xe` hoặc `VƯỢT TẢI TRỌNG (Tổng: ... kg > Tải trọng: ... kg)`.
  - `backend/src/services/lcl-grouping.service.ts`: tích hợp `cargoFit` vào response và audit log của `POST /shipments/lcl/cost-group`.
  - Quy tắc tài chính: Tuân thủ nghiêm ngặt **Luật 100%/0₫** theo DEV SPEC 2026-10-15 và ADR (Lô 1 chịu 100% cước chuyến theo tải trọng loại xe chọn, Lô 2..N nhận 0₫ "Ghép cước cùng Bill X").
- **Phán quyết**: **SHIPPED** *(theo đúng DEV SPEC 2026-10-15 & ADR chốt; có cảnh báo tải trọng và tra bảng giá theo tấn)*.
- **Bề mặt & Cách kiểm tra**:
  - Vào `/dispatch-detail` → Chọn ≥ 2 lô hàng lẻ LCL chưa gán xe.
  - Click nút **"Gán xe nhóm"** trên thanh công cụ.
  - Trong dialog "Gán xe nhóm hàng lẻ", chọn một "Loại xe/Trọng tải" (ví dụ 3.5T hay 5T).
  - Quan sát dòng cảnh báo tải trọng (`cargoFit`) ngay dưới ô chọn loại xe:
    - Nếu tổng kg ≤ tải trọng: dòng chữ xanh `"Vừa tải trọng xe..."`.
    - Nếu tổng kg > tải trọng: cảnh báo màu cam/đỏ `"VƯỢT TẢI TRỌNG..."`.
  - Hoàn tất gán nhóm: Lô chính nhận cước bảng giá tương ứng hạng xe, các lô phụ nhận 0₫ ghi nhận ghép cước.
- **Vì sao QA có thể soi trượt?**:
  1. **Bất đồng về định nghĩa nghiệm thu (Requirement vs Ruling Conflict)**:
     Doc khách ban đầu ghi "thuật toán tính giá cước dựa trên trọng tải tấn... gom nhiều lô". QA có thể kỳ vọng hệ thống phải tự động tính toán chia nhỏ tiền cước (phân bổ theo % kg hoặc CBM cho từng lô). Nhưng thực tế SilverSea áp dụng **Luật 100%/0₫** (đã nghiệm thu ngày 15/10 và ghi nhận trong ADR) để tránh phức tạp hạch toán. Thấy Lô 2 là 0₫, QA tưởng thuật toán "chưa làm".
  2. **Chưa mở Dialog Gán xe nhóm**: Dòng hiển thị tải trọng `cargoFit` chỉ xuất hiện bên trong Dialog khi thao tác gán xe nhóm.
  3. **Dữ liệu bảng giá trống**: Nếu chưa cấu hình đơn giá cho loại xe đó trong `/config/carrier-pricing`, cước tính ra = 0 hoặc manual.

---

### 8. `dri-01` — SĐT kho / nhà máy tel: link chạm-gọi trên màn hình tài xế
- **Commit**: `f0986f4c` (`feat(driver): REQ-14 SĐT kho/nhà máy tel: link chạm-gọi (doc khách Phần 5)`).
- **Mã nguồn kiểm tra**:
  - `frontend/src/components/TelLink.tsx`: `telHref` làm sạch cả dấu cách và dấu chấm: `replace(/[\s.]+/g, '')`, giữ nguyên `+84`.
  - `frontend/src/components/shipment/OperationalSiteContactsList.tsx`: khi `callable=true`, số điện thoại render thành component `TelLink` (màu #005A2D, có thể click), bên cạnh nút "Gọi".
  - `frontend/src/pages/driver/DriverTaskInfoSections.tsx` / `DriverTripDetailPage.tsx`: dòng "SĐT kho" và "SĐT liên hệ" là thẻ `<a href="tel:...">`.
- **Phán quyết**: **SHIPPED**.
- **Bề mặt & Cách kiểm tra**:
  - Đăng nhập tài khoản Lái xe (role **DRIVER**, ví dụ: `quyet` / `Abc123`).
  - Mở chi tiết một chuyến xe được giao: `/my-trips/:id`.
  - Trong khối "THÔNG TIN LỆNH", tại các dòng "SĐT kho" và "SĐT liên hệ": các số điện thoại là liên kết bấm được (`<a href="tel:...">`).
  - Bấm nút mở sheet liên hệ nhà máy: số điện thoại hiển thị màu xanh và bấm vào gọi được ngay, bên cạnh nút "Gọi".
  - Số dạng chấm như `028.3822.1234` tự động làm sạch thành `tel:02838221234`.
- **Vì sao QA có thể soi trượt?**:
  1. **Sai vai trò người dùng (Wrong Role)**: Nếu QA đăng nhập tài khoản ADMIN hoặc DISPATCHER và xem trang `/trips/:id` (giao diện văn phòng desktop), đây KHÔNG PHẢI giao diện tài xế và không có component này.
  2. **Kiểm thử trên trình duyệt Desktop không có tel handler**: Trên máy tính PC/Mac không cài app gọi điện (FaceTime, Skype, dialer), bấm vào link `tel:` trình duyệt sẽ không phản hồi hoặc hiện thông báo không có app xử lý. QA tưởng nhầm link bị liệt.
  3. **Lô test không có số điện thoại**: Nếu nhà máy/kho của lô test để trống SĐT, UI hiển thị `—`.
  4. **Nhầm với trang cấu hình Master Data**: Tại `/config/factories`, số điện thoại cố ý giữ text thuần, không biến thành link tel.

---

### 9. `dri-04` — Cảng hạ trống trên chuyến Nhập khẩu (IMPORT) hiển thị tên điểm trả
- **Commit**: `3fd77532` & `da73a743` (`merge: FB-020 portless-import cang-ha regression (rb2)`).
- **Mã nguồn kiểm tra**:
  - `backend/src/services/delivery-stage.ts`: lines 112-140:
    ```typescript
    // IMPORT without explicit port falls back to snapshot delivery site
    if (tradeDirection === 'IMPORT' && !dropoffPortName && siteSnapshot?.deliverySite) {
      resolvedDropoff = siteSnapshot.deliverySite;
    }
    ```
  - `frontend/e2e/regression/fb020-driver-cang-ha.spec.ts`: test spec Playwright tự động hoá `TC-FB020-001: portless IMPORT — Cảng hạ = tên điểm trả, Địa chỉ giao hàng = nhà máy đầy đủ`.
- **Phán quyết**: **SHIPPED**.
- **Bề mặt & Cách kiểm tra**:
  - Tạo chuyến Nhập khẩu (**IMPORT**) có container chỉ định Điểm trả hàng (operationalSite) nhưng **KHÔNG chọn cảng hạ** (dropoffPortId = null).
  - Đăng nhập role **DRIVER** → mở `/my-trips/:id`.
  - Quan sát khối "THÔNG TIN LỆNH":
    - Dòng "Cảng hạ": hiển thị tên điểm trả/nhà máy từ snapshot.
    - Dòng "Địa chỉ giao hàng": hiển thị tên và địa chỉ chi tiết nhà máy.
    - Tuyệt đối không còn hiển thị chữ "Chưa có cảng hạ".
- **Vì sao QA có thể soi trượt?**:
  1. **Thử trên chuyến Xuất khẩu (EXPORT)**: Logic fallback này chỉ áp dụng cho chuyến IMPORT. Với chuyến EXPORT, hàng bắt buộc phải hạ tại cảng biển/ICD; nếu cont xuất khẩu không có cảng hạ, hệ thống bắt buộc hiển thị "Chưa có cảng hạ" (theo đúng PRD và an toàn nghiệp vụ).
  2. **Container thiếu cả điểm trả hàng**: Nếu container vừa không có port vừa không có snapshot `deliverySite`, hệ thống vẫn hiển thị "Chưa có cảng hạ" theo thiết kế `TC-FB020-003`.
  3. **Xem ở màn hình Admin thay vì màn hình Tài xế**: Màn hình của điều phối viên lấy từ nguồn khác, trong khi fix FB-020 nằm ở kênh `delivery-stage.ts` của lái xe.

---

## 4. Tổng Kết Nguyên Nhân Hệ Thống (Systemic Root Causes)

Nguyên nhân dẫn đến việc QA R30 chấm trượt toàn bộ 9 card không phải do thiếu code, mà do 5 rào cản nhận thức và vận hành kiểm thử:

1. **Hiệu ứng "Bẫy màn hình trùng tên" (Surface Duplication)**: Hệ thống logistics này có nhiều màn hình phục vụ các vai trò khác nhau nhưng mang cùng tiêu đề (ví dụ: 3 màn hình đều tên "Chi tiết lô hàng", 2 màn hình chi tiết chuyến đi giữa Lái xe và Điều vận). QA vào sai URL hoặc sai Role sẽ không thấy tính năng.
2. **Thiết kế giao diện Tinh gọn (Progressive Disclosure / Reveal-on-click)**: Các trường form hàng lẻ (`lcl-03`, `lcl-04`, `lcl-05`) và action điều vận (`dis-09`) được giấu sau các nút bấm viền đứt hoặc badge modal nhằm giảm tải thị giác cho người dùng. QA quen với kiểu form phẳng lộ thiên (static form) nhìn lướt qua sẽ kết luận là "thiếu trường".
3. **Môi trường thiết bị (Device Emulation)**: Các tính năng của tài xế (`dri-01`, `dri-04`) cần kiểm thử dưới góc nhìn mobile (role DRIVER, viewport 390px, hỗ trợ giao thức `tel:`). Kiểm thử trên desktop thông thường dễ dẫn đến nhận định sai.
4. **Bất đồng quan điểm về Nghiệp vụ (Spec vs Ruling)**: Điển hình ở `lcl-07` (REQ-19), QA đánh giá dựa trên mong muốn thuật toán phân bổ tỷ lệ cước, trong khi hệ thống vận hành theo Luật 100%/0₫ đã được phê duyệt chính thức qua ADR.
5. **Dữ liệu tiền đề (Preconditions)**: Các tính năng đều gắn liền với trạng thái nghiệp vụ cụ thể (phải là hàng LCL, phải có nhóm ghép, phải là chiều Xuất khẩu, hoặc phải có SĐT khai báo). Khi QA dùng dữ liệu rỗng hoặc sai luồng, tính năng sẽ không kích hoạt.

---

## 5. Khuyến Nghị Cho QA Round Kế Tiếp (Verification Runbook for QA)

1. Khi test **cus-11**: Mở chính xác URL `/shipments/:id` (bấm nút "Chi tiết lô hàng" trong drawer) và đảm bảo lô test có nhập tờ khai ở mục "Tờ khai hải quan".
2. Khi test **dis-09**: Tạo nhóm ghép cho ≥ 2 lô lẻ trên `/dispatch-detail`, sau đó click vào badge `Lẻ · Ghép (1/N)` ở cột "Phân loại" để mở modal đổi BKS.
3. Khi test **lcl-02**: Trên form tạo lô, chọn Khách hàng rồi bấm radio **"Xuất khẩu"** trước khi click "+ Thêm kho".
4. Khi test **lcl-03/04/05**: Bấm radio **"Hàng lẻ (LCL)"** và click nút **"+ Thêm ngày giao hàng"**.
5. Khi test **lcl-07**: Vào `/dispatch-detail`, chọn 2 lô lẻ, bấm "Gán xe nhóm" và quan sát dòng cảnh báo tải trọng trong dialog.
6. Khi test **dri-01 / dri-04**: Đăng nhập bằng tài khoản `DRIVER` (ví dụ `quyet`), mở `/my-trips/:id` trên giao diện giả lập mobile.
