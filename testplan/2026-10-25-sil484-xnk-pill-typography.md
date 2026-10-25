# SIL-484 — /shipments-detail cột NHẬP/XUẤT: pill XNK nhỏ hơn cột kề

- **Ticket:** SIL-484 (board, In Progress) — "[Owner] /shipments-detail cột NHẬP/XUẤT: font-size LỚN hơn cột kề — pill XNK đồng bộ typography bảng"
- **Reported:** Owner 25/10, ảnh đính kèm ticket (`qa/2026-10-25-sil484/sil484-owner-before.jpg`)
- **Severity:** minor / visual · **Type:** regression case (style law)

## Bug

Trên `/shipments-detail`, pill định hướng (Nhập/Xuất/Chưa xác định) ở cột
**NHẬP/XUẤT** của bảng ledger container render ở **11px**
(`--text-caption-size`) trong khi các cột kề (Bill/Booking, Số tờ khai,
Hãng tàu) dùng cỡ dữ liệu bảng **12px** (`--text-data-size` qua
`--ops-table-primary-size`/supporting) → pill đọc nhỏ hơn rõ rệt so với
cột kề (đo trước sửa: pill 11px/19.4px cao, cell kề 12px).

## Expected

Pill đồng bộ typography bảng: font **12-13px** (bằng cỡ dữ liệu cột kề),
chiều cao pill **20-22px**. Token phải là token chia sẻ
(`--text-data-size`), không phải số cứng page-local.

## Reproduction

1. `make dev`, đăng nhập role đọc (cus).
2. Mở `/shipments-detail`, tìm bảng ledger container, cột NHẬP/XUẤT.
3. So pill với text cột Hãng tàu kề: trước sửa pill nhỏ hơn; sau sửa
   đồng cỡ (12px), pill cao ~22px.

## Regression coverage

- `frontend/src/pages/ShipmentContainersPage.styles.test.ts` — assertion
  mới pin `.shipment-container-ledger__direction` =
  `font-size: var(--text-data-size)` + `line-height: 1.5` và cấm quay lại
  `--text-caption-size`.
- UI drive: `qa/2026-10-25_sil484_ui-drive.mjs` (probe before/after +
  zoom PNG, rung 3 evidence cho thay đổi read-only).
