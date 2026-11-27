# Regression spec — `SIL-1127` Dropdown gợi ý BKS phủ [Lưu BKS nhóm], chuột bấm không tới

**Ticket:** SIL-1127 (hộp "Đổi BKS nhóm": gợi ý "Không tìm thấy kết quả" che nút Lưu, chặn pointer events)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** LANDED 2026-11-27 (lane r40e) — verify on staging
**Cycle:** 2026-11 wave

## Goal

Lớp gợi ý (suggestion panel) của ô BKS KHÔNG được đè/ăn pointer events của nút [Lưu BKS
 nhóm] — bấm Lưu lưu được ngay khi gợi ý đang mở; bấm ra ngoài thì gợi ý tự đóng. Việc đổi
BKS nhóm giữ nguyên hành vi (chỉ sửa lớp gợi ý).

## Repro (QA 27/11, build 23a8fa17)

1. dungnv, /dispatch-detail?q=W3A-LCL → pill nhà xe lô W3A-LCL-01 → hộp thoại "Chỉnh sửa
   điều phối" → [Đổi BKS nhóm].
2. Ô "BKS thực": xóa biển hiện tại, gõ "99Q-99999".
3. Tấm gợi ý "Không tìm thấy kết quả" hiện và PHỦ lên nút [Lưu BKS nhóm] bên dưới.
4. Bấm chuột thật vào [Lưu BKS nhóm] — không có gì xảy ra (2 lần Playwright click thật đều
   rơi vào tấm gợi ý); phải bấm Escape trước mới bấm Lưu được.

## Expected

- Tấm gợi ý không chặn sự kiện con trỏ của nút Lưu: bấm [Lưu BKS nhóm] khi gợi ý đang mở
  → lưu ngay (1 click).
- Bấm ra ngoài (không phải ô gợi ý) → gợi ý tự đóng.
- Option rows vẫn bấm chọn được; đổi BKS nhóm vẫn lưu cả nhóm như cũ.

## Out of scope

- Không đổi logic đổi BKS nhóm (updateLclTruck, validate BKS, quick-add "+ Thêm nhanh").
- Không đổi panel của Select/menu (chỉ lớp gợi ý ComboBox).

## Acceptance criteria

### TC-1127-001 — Lưu được khi gợi ý đang mở

- **Given** hộp "Đổi BKS nhóm", ô BKS thực gõ "99Q-99999" → panel "Không tìm thấy kết quả" mở.
- **When** bấm [Lưu BKS nhóm].
- **Then** `updateLclTruck({ shipmentId, actualTruckNo: '99Q-99999' })` chạy — nút không bị
  panel ăn click.

### TC-1127-002 — Đóng khi click ngoài

- **Given** panel gợi ý đang mở.
- **When** pointerdown ngoài trường.
- **Then** panel đóng và không tự mở lại giữa thao tác.

### TC-1127-003 — Hợp đồng CSS của lớp gợi ý

- **Then** `.react-aria-Popover[data-trigger="ComboBox"]` là `pointer-events: none`,
  `[role='option']` là `pointer-events: auto`; panel Select không bị đổi.
