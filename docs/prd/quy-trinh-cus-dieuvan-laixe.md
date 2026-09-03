# Quy Trình O2C: Chứng Từ → Điều Vận → Lái Xe

**Dự án:** TTransport — Silver Sea

---

## Tổng Quan Luồng Xử Lý

```mermaid
sequenceDiagram
    participant CT as 📋 Chứng Từ (CUS)
    participant DV as 🚛 Điều Vận
    participant LX as 🚗 Lái Xe
    participant KT as 💰 Kế Toán

    CT->>CT: Tiếp nhận booking, tạo lô hàng
    CT->>CT: Nhập container (ISO 6346) / LCL
    CT->>CT: Hệ thống tự động tính cước
    CT->>DV: Submit lô hàng + Handoff

    DV->>DV: Master Plan: Phân bổ nhà vận tải
    DV->>DV: Detail Plan: Gán xe + tài xế
    DV->>LX: Phát lệnh điều xe (Push notification)

    LX->>LX: Nhận lệnh (ORDER_RECEIVED)
    LX->>LX: Lấy hàng (PICKED_UP)
    LX->>LX: Đóng/trả hàng (LOADING_OR_RETURNING)
    LX->>LX: Giao hàng (DELIVERED)
    LX->>LX: Chụp ảnh Cont/Seal + Đổ dầu (OCR)
    LX->>CT: Nộp e-POD (SUBMITTED)

    CT->>CT: Duyệt e-POD + Xác nhận thu hồi POD gốc
    CT->>KT: Khóa sổ (Accounting Lock)

    KT->>KT: Rà soát chi phí (FinanceSnapshot)
    KT->>KT: Xác nhận chi phí (SHIPMENT_COST_CONFIRMATION)
    KT->>KT: Đóng lô hàng → COMPLETED
    KT->>KT: Snapshot → Debit Note
```

---

## Vòng Đời Lô Hàng

Lô hàng có 8 trạng thái, chuyển đổi tự động hoặc do thao tác người dùng:

```mermaid
stateDiagram-v2
    [*] --> PENDING_DATE : CUS tạo (thiếu ngày)
    [*] --> READY_FOR_DISPATCH : CUS tạo (đủ ngày)

    PENDING_DATE --> READY_FOR_DISPATCH : Bổ sung ngày giao
    READY_FOR_DISPATCH --> DISPATCHED : Điều vận phát lệnh
    DISPATCHED --> IN_TRANSIT : Lái xe nhận lệnh
    IN_TRANSIT --> PENDING_EXPENSE_APPROVAL : Lái xe hoàn thành chuyến
    PENDING_EXPENSE_APPROVAL --> COMPLETED : Kế toán đóng lô

    IN_TRANSIT --> DISPATCHED : Điều chỉnh
    PENDING_EXPENSE_APPROVAL --> IN_TRANSIT : Mở lại
    PENDING_EXPENSE_APPROVAL --> DISPATCHED : Điều chỉnh

    READY_FOR_DISPATCH --> CANCELED
    DISPATCHED --> CANCELED
    IN_TRANSIT --> CANCELED
    PENDING_EXPENSE_APPROVAL --> CANCELED

    COMPLETED --> [*]
    CANCELED --> [*]
```

| Trạng thái | Nhãn | Chịu trách nhiệm |
|------------|------|-------------------|
| `PENDING_DATE` | Chờ chốt lịch | CUS |
| `READY_FOR_DISPATCH` | Sẵn sàng điều xe | CUS |
| `DISPATCHED` | Đã phân xe | Điều vận |
| `IN_TRANSIT` | Đang chạy | Lái xe |
| `PENDING_EXPENSE_APPROVAL` | Chờ duyệt phí | Kế toán |
| `COMPLETED` | Hoàn thành | Kế toán |
| `CANCELED` | Đã hủy | Admin/GĐ |

> `TripStatus.LOCKED` đã bị xóa — chi phí vẫn chỉnh sửa sau `COMPLETED`, hệ thống dùng `arSnapshotDirty` flag theo dõi thay đổi.

---

## Bước 1 — Chứng Từ (CUS): Khởi Tạo Lô Hàng

CUS tiếp nhận booking từ khách hàng, tạo lô hàng trên hệ thống, nhập container, và submit cho Điều vận.

```mermaid
sequenceDiagram
    participant KH as Khách hàng
    participant CUS as Chứng Từ
    participant SYS as Hệ thống

    KH->>CUS: Gửi booking
    CUS->>SYS: POST /shipments/quick
    SYS-->>CUS: Mã lô (SHP-YYMM-XXXXX) + Giá cước dự kiến

    alt Hàng FCL
        CUS->>SYS: PUT /shipments/:id/containers
        SYS->>SYS: Validate ISO 6346 (format + check digit)
    else Hàng LCL
        CUS->>SYS: Nhập quy cách, SL, khối lượng, CBM
    end

    CUS->>SYS: POST /submit-for-dispatch
    SYS->>SYS: Tạo dispatch_handoff (UNSEEN)
    SYS-->>CUS: Trạng thái → READY_FOR_DISPATCH
```

**Kiểm soát hệ thống:**
- **Auto-pricing** — 3 tier: TIER (bulk/KG) → TABLE (fixed/cont) → MANUAL (fallback). Không gõ tay giá.
- **ISO 6346** — Format `XXXXNNNNNNN` + check digit. Có OCR auto-correction cho nhập liệu gần đúng.
- **Handoff** — CUS submit tạo `dispatch_handoff` (UNSEEN → SEEN → ACCEPTED/REJECTED), Điều vận phải chấp nhận trước khi phân bổ.
- **Idempotent** — Dùng `Idempotency-Key` header, trả 201 lần đầu, 200 khi replay.

---

## Bước 2 — Điều Vận: Phân Bổ & Phát Lệnh

Điều vận xử lý qua 2 bước: Master Plan (phân bổ nhà vận tải) → Detail Plan (gán xe cụ thể) → Phát lệnh.

### 2a. Master Plan — Phân Bổ Nhà Vận Tải

Điều vận xem các lô `READY_FOR_DISPATCH`, phân bổ nhà vận tải (OWN / EXTERNAL) theo từng loại container. Hệ thống tự động split mỗi container thành 1 fulfillment row.

Zone-based suggestions: gợi ý xe nhà có dropoff D-1 hoặc pickup D+1 cùng zone.

### 2b. Detail Plan — Gán Xe Cụ Thể

Mỗi fulfillment row được gán biển số xe + tài xế cụ thể. Có thể chọn phân loại chuyến:

| Phân loại | Nhãn | Ghi chú |
|-----------|------|---------|
| `SINGLE` | Đơn | 1 chiều |
| `DOUBLE` | Kẹp | 2 chiều |
| `COMBINED` | Kết hợp | Ghép chuyến |
| `LCL` | Lẻ | Hàng lẻ |

> `classification` là label thao tác (fulfillment-level). `isCombined` là flag shipment-level. Hai field độc lập.

### 2c. Phát Lệnh

```mermaid
sequenceDiagram
    participant DV as Điều Vận
    participant SYS as Hệ thống
    participant LX as Lái Xe

    DV->>SYS: Nhấn "Phát lệnh"
    SYS->>SYS: Validate truck ACTIVE, driver có login account
    SYS->>SYS: Check trailer khớp container, trọng lượng ≤ capacity
    SYS->>SYS: Check không trùng lịch (resource availability)
    SYS->>SYS: Tạo trip + READY_FOR_DISPATCH → DISPATCHED
    SYS->>LX: Push: "Chuyến được điều phối"
```

**Dispatch Issue Status** (fulfillment-level):

```mermaid
stateDiagram-v2
    [*] --> UNASSIGNED : Chưa xếp xe
    UNASSIGNED --> PLATED_NOT_ISSUED : Gán biển số
    PLATED_NOT_ISSUED --> ISSUED : Phát lệnh
```

---

## Bước 3 — Lái Xe: Thực Thi Chuyến Đi

Lái xe nhận lệnh trên App, thực hiện chuyến theo chuỗi milestone, ghi nhận chi phí, và nộp e-POD.

### Journey Board

App lái xe có 3 tab: **Lệnh mới** → **Đã nhận** → **Lịch sử**. Cards nhóm theo phân loại (Đơn/Kẹp/Kết hợp/Lẻ).

### Chuỗi Milestone

```mermaid
flowchart LR
    A["ORDER_RECEIVED\nNhận lệnh"] --> B["PICKED_UP\nLấy vỏ/hàng"]
    B --> C["LOADING_OR_RETURNING\nĐóng/trả hàng"]
    C --> D["DELIVERED\nHạ bãi/giao hàng"]
    D --> E["Nộp e-POD"]
    E --> F["Hoàn thành trip"]
```

Sự kiện bổ sung (không bắt buộc): `DEPARTED`, `ARRIVED`, `FUELED`, `INCIDENT`, `NOTE`.

### Chi Phí Phát Sinh

Lái xe nhập chi phí trực tiếp trên App:

- **Nhập tay:** Phí nâng/hạ, cầu đường, đỗ xe, rửa/hàn cont, cân lọp
- **Tự động (read-only):** Tiền đường (từ trip), Phí nâng/ha Lạch Huyên (50k)
- **Đổ dầu (riêng):** Chụp ảnh cột bơm → OCR (lít, đơn giá, tổng) + GPS → đối chiếu lộ trình phát hiện bất thường

Mọi chi phí gom cụm theo lô hàng, chuyển trạng thái chờ duyệt.

### e-POD (Chứng Từ Điện Tử)

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Tạo e-POD
    DRAFT --> DRAFT : Upload ảnh
    DRAFT --> SUBMITTED : Gửi duyệt
    SUBMITTED --> ACCEPTED : CUS duyệt
    SUBMITTED --> REJECTED : CUS từ chối
    REJECTED --> DRAFT : Sửa lại
    ACCEPTED --> [*]
```

**2 file bắt buộc:** Phiếu hạ bãi/trả hàng (`YARD_OR_DROP_RECEIPT`) + Biên bản giao nhận đã ký (`SIGNED_DELIVERY_NOTE`).

**Tùy chọn:** Vé cầu đường (`TOLL_TICKET`).

### Hoàn Thành Trip

Khi lái xe nhấn "Hoàn thành", hệ thống kiểm tra:

1. Tất cả 4 milestone đã ghi nhận (ORDER_RECEIVED → DELIVERED)
2. Cả 2 file e-POD đã upload
3. e-POD status = SUBMITTED hoặc ACCEPTED

Đủ điều kiện → trip chuyển `COMPLETED`. Nếu tất cả trip trong lô đều COMPLETED + e-POD SUBMITTED → shipment chuyển `PENDING_EXPENSE_APPROVAL`.

> Driver-close path bỏ qua gate Kế toán — lái xe có thể tự đóng trip mà không cần Kế toán duyệt trước.

---

## Bước 4 — Đối Soát & Quyết Toán

### CUS: Duyệt e-POD

```mermaid
sequenceDiagram
    participant LX as Lái Xe
    participant CUS as Chứng Từ
    participant SYS as Hệ thống

    LX->>SYS: Submit e-POD (SUBMITTED)
    SYS->>CUS: Thông báo chờ duyệt
    CUS->>SYS: Xem e-POD + Xác nhận thu hồi POD gốc
    SYS->>SYS: Set podRecoveredAt
    SYS->>SYS: Recompute shipment completion
```

Chỉ CUS mới duyệt e-POD. Bắt buộc xác nhận đã thu hồi chứng từ gốc (POD) trước khi duyệt.

### Kế Toán: Xác Nhận & Đóng Lô

```mermaid
flowchart TD
    A["Shipment: PENDING_EXPENSE_APPROVAL"] --> B["Kế toán rà soát chi phí"]
    B --> C["confirmShipmentFinance\nFinanceSnapshot + checksum"]
    C --> D["Governance: SHIPMENT_COST_CONFIRMATION"]
    D --> E["CUS khóa sổ (Accounting Lock)"]
    E --> F["Kế toán completeShipmentDirect"]
    F --> G["Shipment → COMPLETED"]
    G --> H["Snapshot → Debit Note + AR dirty-flag"]
```

**Điều kiện đóng lô:** Shipment ở `PENDING_EXPENSE_APPROVAL` + Snapshot checksum khớp + VAT 0/5/8/10% + Maker-checker (CUS duyệt POD ≠ Kế toán đóng lô).

### Accounting Lock

CUS khóa sổ sau khi Kế toán xác nhận → mọi mutation trực tiếp bị chặn (status change, soft delete, POD review, change request). Muốn mở lại: CUS đề nghị → Admin phê duyệt → Debit Note chuyển `ADJUSTMENT_REQUIRED`.

### Tạm Ứng & Cấn Trừ

Phiếu tạm ứng qua lifecycle: `PENDING` → `CHECKED_BY_ACCOUNTANT` → `APPROVED`. Khi approve: chi phí tự động APPROVED, post SERVICE_FEE vào sổ CUSTOMER, post OPS_SETTLEMENT vào sổ FORWARDER (cấn trừ tạm ứng).

---

## Toàn Cảnh Flow

```mermaid
flowchart TB
    subgraph CUS["👤 Chứng Từ (CUS)"]
        C1["Tạo lô hàng"] --> C2["Nhập Cont / LCL"]
        C2 --> C3["Submit + Handoff"]
        C4["Duyệt e-POD"] --> C5["Khóa sổ"]
    end

    subgraph DV["🚛 Điều Vận"]
        D1["Master Plan\nPhân bổ NVTC"] --> D2["Detail Plan\nGán xe + tài xế"]
        D2 --> D3["Phát lệnh"]
    end

    subgraph LX["🚗 Lái Xe"]
        L1["Nhận lệnh"] --> L2["Lấy hàng"]
        L2 --> L3["Đóng/trả hàng"]
        L3 --> L4["Giao hàng"]
        L4 --> L5["Nộp e-POD"]
    end

    subgraph KT["💰 Kế Toán"]
        K1["Rà soát chi phí"] --> K2["Xác nhận"]
        K2 --> K3["Đóng lô"]
    end

    C3 -->|"Handoff"| D1
    D3 -->|"Push"| L1
    L5 -->|"e-POD"| C4
    C5 --> K1
```

---

## Quy Tắc Hệ Thống

| Quy tắc | Chi tiết |
|---------|----------|
| **Xóa dữ liệu** | Create-only được xóa trong phiên hiện tại. Phiên cũ → Admin/GĐ phê duyệt |
| **Chi phí đã duyệt** | Cấm xóa (bất kỳ ai) |
| **Push Notification** | Lái xe: TRIP_DISPATCHED, TRIP_CANCELED, PENALTY. Điều vận: shipment events |
| **POD Gate** | CUS duyệt e-POD + xác nhận thu hồi POD gốc → mới chuyển Hoàn thành |
| **Driver-close bypass** | Lái xe tự đóng trip → bỏ qua gate Kế toán (chỉ cần e-POD SUBMITTED) |
| **Accounting Lock** | CUS khóa sổ → mọi mutation phải qua governance (Admin phê duyệt mở lại) |
| **Change Request** | CUS sửa lô sau dispatch → tạo change request (không sửa trực tiếp) |
| **Tạm ứng** | PENDING → CHECKED → APPROVED. Auto-cấn trừ khi approve |
