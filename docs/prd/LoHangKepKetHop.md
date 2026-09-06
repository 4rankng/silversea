# Lô Hàng Kẹp & Lô Hàng Kết Hợp

**Dự án:** TTransport — Silver Sea
**Nguồn:** `2026.9.6_Logic_nghiep_vu.docx` — Phần 2
**Liên quan:** [`QuyTrinhO2C.md`](QuyTrinhO2C.md) §2b (phân loại chuyến), [`ManHinhLaiXe.md`](ManHinhLaiXe.md)

---

> ## ⚠️ Thay đổi định nghĩa — 2026-09-06
>
> Tài liệu `2026.9.6_Logic_nghiep_vu.docx` **định nghĩa lại** hai khái niệm Kẹp
> và Kết hợp so với bản PRD trước đó. Định nghĩa mới là **bản có hiệu lực**.
>
> | Khái niệm | Định nghĩa CŨ (đã thay thế) | Định nghĩa MỚI (hiệu lực) |
> |-----------|------------------------------|---------------------------|
> | **Kẹp** | 2 chuyến khép kín, cùng xe + cùng tài xế, **nối tiếp** nhau | **2 container 20ft trên cùng 1 mooc, chạy đồng thời** |
> | **Kết hợp** | Nhiều cont gộp 1 xe, chạy **đồng thời** | **Tái sử dụng vỏ cont: trả hàng xong giữ vỏ đi đóng lô kế tiếp — nối tiếp** |
>
> Hai định nghĩa đã **hoán đổi bản chất thời gian** (đồng thời ↔ nối tiếp).
> Mọi acceptance criteria viết theo bản cũ phải được rà lại — xem danh sách AC
> bị ảnh hưởng ở cuối tài liệu này.

---

## 1. Định Nghĩa Nghiệp Vụ

### 1.1 Hàng Kẹp (Cont kẹp) — đồng thời

Ghép **2 container 20ft** lên **cùng 1 xe mooc** để chạy **cùng một lúc**.
Thường là 1 cont có hàng + 1 cont rỗng kéo đi/về.

```mermaid
flowchart LR
  A[Cảng nâng] -- "1 xe · 1 mooc<br/>20ft có hàng + 20ft rỗng<br/>chạy CÙNG LÚC" --> B[Nhà máy / Cảng hạ]
```

- Hai container **cùng lên đường tại cùng một thời điểm**.
- Ràng buộc vật lý: 2 × 20ft trên một mooc (không áp dụng cho 40ft).

### 1.2 Hàng Kết Hợp — nối tiếp

**Tái sử dụng vỏ container.** Xe chở cont đến trả hàng xong, **không** kéo vỏ rỗng
về bãi mà giữ lại vỏ đó để tiếp tục đi đóng hàng cho một lô khác — tiết kiệm được
1 cuốc xe chở rỗng.

```mermaid
flowchart LR
  A[Cảng nâng] -- "Lệnh 1 · cont có hàng" --> B[Nhà máy KH 1]
  B -- "GIỮ VỎ · không về bãi" --> C[Nhà máy KH 2]
  C -- "Lệnh 2 · đóng hàng bằng vỏ cũ" --> D[Cảng hạ]
```

- Hai lệnh **nối tiếp nhau về thời gian**: hoàn thành trả hàng Lệnh 1 rồi mới bắt đầu đóng hàng Lệnh 2.
- Điểm tiết kiệm: bỏ được cuốc chạy rỗng về bãi.

---

## 2. Nguyên Tắc Cốt Lõi: "1 Cont = 1 Lệnh (Shipment)"

Dù Kẹp hay Kết hợp, cả hai đều chung một bản chất quản lý:

| Chiều dữ liệu | Quy tắc |
|---------------|---------|
| **Chứng từ / Doanh thu / Công nợ** | Mỗi container vẫn là **một lệnh riêng biệt** với khách hàng |
| **Chuyến đi vật lý** | Cả hai lệnh **dùng chung 1 xe vật lý** — cùng 1 tài xế, cùng 1 đầu kéo |

**Yêu cầu Database:** giữ bảng `Shipment` (lệnh cont) **độc lập**, bổ sung **mã ghép
chuyến** (`Group_Tag`) để móc nối các cont này lại với nhau.

**Mô hình triển khai (khớp hệ thống hiện tại):** 2 trips được liên kết thành **1 cặp
ghép** mang `pair_kind = KEP | KET_HOP` — xem [`QuyTrinhO2C.md`](QuyTrinhO2C.md) §2b.
Cặp ghép chính là hiện thực của `Group_Tag`: nó đóng đúng vai trò "móc nối" mà đặc tả
yêu cầu, đồng thời giữ được mốc tiến độ riêng cho từng lệnh (bắt buộc với hàng Kết hợp,
nơi Lệnh 2 phải khoá đến khi Lệnh 1 xong).

Không gộp 2 cont thành 1 shipment. Không để 2 trip chạy chung xe mà **không** liên kết cặp.

---

## 3. Tác Động Luồng Điều Vận & Giao Diện

### 3.1 Tính năng Ghép chuyến (màn Điều vận)

- Cho phép Điều vận chọn **2 lệnh cont riêng biệt** và gán chung cho **1 biển số xe / 1 tài xế** trong **cùng 1 ngày**.
- Kết quả: 2 shipment cùng `Trip_ID` / `Group_Tag`.

### 3.2 Gắn Tag trên UI

- Khi hệ thống phát hiện 2 lệnh cont có chung `Trip_ID`, Frontend **tự động render** Tag `[KẸP]` hoặc `[KẾT HỢP]` nổi bật cạnh số container.
- Tag là dữ liệu **suy ra từ nhóm chuyến**, không phải trường nhập tay.

### 3.3 App Lái xe

- Hiển thị **song song 2 lệnh** nhưng **dính liền kề nhau**, để tài xế hiểu đây là một "combo" phải chạy cùng nhau.
- Riêng **hàng Kết hợp**: luồng trạng thái phải **nối tiếp** — *hoàn thành trả hàng Lệnh 1* ⇒ mới mở được *bắt đầu đóng hàng Lệnh 2*.
- Chi tiết UI: xem [`ManHinhLaiXe.md`](ManHinhLaiXe.md) §2.

---

## 4. Thuật Toán Chi Phí & Kế Toán (Backend)

Khi xử lý chuyến có mã ghép Kẹp/Kết hợp, backend **bắt buộc** chạy thuật toán
**chống nhân đôi chi phí ảo**.

### 4.1 Chi phí đường bộ (Tolls / VETC)

Xe chạy khép kín trên **cùng 1 hành trình** ⇒ tiền trạm thu phí chỉ được ghi nhận
**1 lần duy nhất cho toàn bộ Trip**.

> ❌ Sai: `định mức VETC × 2 cont`
> ✅ Đúng: `định mức VETC × 1 Trip`

### 4.2 Lương tài xế (Payroll)

Hệ thống **không** trả lương bằng tổng của 2 cuốc chạy đơn. Phải gọi công thức lương riêng:

```
Lương chuyến ghép = Lương cuốc cơ bản + Phụ phí kẹp / kết hợp
```

Biến `Phụ phí kẹp / kết hợp` lấy từ **module cài đặt cấu hình lương**, không hard-code.

### 4.3 Các khoản giữ nguyên độc lập

Doanh thu, công nợ khách hàng, và các chi phí gắn với từng lô (nâng/hạ, vệ sinh cont,
lưu bãi) vẫn tính **riêng cho từng shipment**.

---

## 5. Bảng So Sánh

| Tiêu chí | Đơn | **Kẹp** | **Kết hợp** |
|----------|-----|---------|-------------|
| Quan hệ thời gian | — | **Đồng thời** | **Nối tiếp** |
| Loại cont điển hình | bất kỳ | 2 × 20ft trên 1 mooc | bất kỳ (tái dùng vỏ) |
| Số shipment | 1 | 2 | 2 |
| Số trip | 1 | 2 (cặp `pair_kind = KEP`) | 2 (cặp `pair_kind = KET_HOP`) |
| Xe vật lý | 1 | **1 chung** | **1 chung** |
| Vỏ container | 1 | 2 vỏ | **1 vỏ dùng lại** |
| Cùng biển số + tài xế | — | Bắt buộc | Bắt buộc |
| Cùng ngày | — | Bắt buộc | Bắt buộc |
| Phí VETC / cầu đường | 1 lần | **1 lần cho cả Trip** | **1 lần cho cả Trip** |
| Lương tài xế | lương cuốc đơn | cơ bản + phụ phí ghép | cơ bản + phụ phí ghép |
| Doanh thu | riêng | **riêng từng shipment** | **riêng từng shipment** |
| Ràng buộc trạng thái app | — | 2 thẻ chạy song song | **Lệnh 1 xong ⇒ mới mở Lệnh 2** |

---

## 6. Acceptance Criteria bị ảnh hưởng bởi thay đổi định nghĩa

Các AC sau viết theo định nghĩa cũ và **phải được rà lại / viết lại**:

| Vị trí | AC / Test case | Trạng thái |
|--------|----------------|-----------|
| `docs/prd/QuyTrinhO2C.md` §2b | mục (b), (c) và bảng so sánh | ✅ **Đã cập nhật** theo định nghĩa mới |
| `testplan/roles/02-dieuvan.md` | `DISP-DP-12` | ✅ **Đã viết lại** — xem AC hiện hành |
| `testplan/flows/02-dieuvan-dispatch.md` §2.6 | `TC-DV-DISPATCH-007`, `-008` | ⚠️ Điều kiện kẹp "thời gian không chồng lấn" — **ngược** với "đồng thời"; các case này nay mô tả **Kết hợp** |
| `testplan/flows/02-dieuvan-dispatch.md` §2.10 | `TC-DV-DISPATCH-029`, `-030` | ⚠️ Mô tả "ghép kết hợp = đồng thời" — nay thuộc về **Kẹp** |
| `testplan/flows/02-dieuvan-dispatch.md` §2.10 | `TC-DV-DISPATCH-031` | ⚠️ Điều kiện (khác tài xế → chặn) vẫn đúng; chỉ tên gọi bản chất phải sửa |

Bộ test case viết theo **định nghĩa mới** nằm ở
[`testplan/flows/09-kep-kethop-ghep-chuyen.md`](../../testplan/flows/09-kep-kethop-ghep-chuyen.md).
Các case cũ trong `02-dieuvan-dispatch.md` §2.6 / §2.10 giữ nguyên làm hồ sơ lịch sử
và được đánh dấu ⚠️ tại chỗ; khi chạy regression, dùng bộ 09 làm chuẩn.

Bộ test case mới cho định nghĩa mới: [`testplan/flows/09-kep-kethop-ghep-chuyen.md`](../../testplan/flows/09-kep-kethop-ghep-chuyen.md).
