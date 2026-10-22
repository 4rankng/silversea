# Case QA-2026-10-22-nangha-lcl — Chi tiết lô: cột Nâng/Hạ của dòng LCL phải là Đóng/Trả, không phải "Chưa cập nhật"

Card 261022093846 (Zalo khách 22/10 09:38, kèm screenshot). Hai lô LCL NHẬP
(YUANFANG K6356464 · Long Minh ASKEY K95249354, giao 23/10) hiển thị chip
"NÂNG/HẠ – Chưa cập nhật" trên bảng Chi tiết lô hàng (`/shipments-detail`).
Khách làm rõ: **lô LCL không có khái niệm nâng/hạ** — chỉ có ĐIỂM ĐÓNG HÀNG +
ĐIỂM TRẢ HÀNG. Placeholder "Chưa cập nhật" đọc như đang chờ data không bao
giờ đến = sai nghĩa (cùng lớp lỗi DRI-04: fallback câm lặng).

## Nguyên nhân (audit 22/10)

- FE `ShipmentContainerLedger.tsx` cột "Nâng / hạ" render `row.liftSite` /
  `row.dropoffSite` — field per-**container** (cảng nâng/hạ).
- BE `buildLotFlatRow` (`cus-shipment-workspace-reads.service.ts`) đổ
  liftSite/dropoffSite từ `resolveLiftSite(support, null, lotAssignment)`:
  chỉ đọc `shipment_containers.pickup_port_id` hoặc assignment snapshot kiểu
  PORT. Lô LCL không có container; kho CFS là site WAREHOUSE → cả hai null.
- Dữ liệu thật của lô đã có trong model nhưng không được project:
  `shipments.pickup_warehouse_site_id` (kho CFS), `factory_name` /
  `operational_site_id` (nhà máy), `pickup_location` / `delivery_location`
  (free-text). Luật hướng (directive 2026-10-17, cùng `resolveLiftDropPoints`):
  IMPORT đóng tại kho / trả tại nhà máy; EXPORT ngược lại.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| NANGHA-R1 | `/shipments-detail`, dòng lô LCL NHẬP có kho + nhà máy | Cột Nâng/hạ in `Đóng <kho>` / `Trả <nhà máy>` (hai dòng, cùng layout Nâng/Hạ); tooltip `Lô lẻ: không nâng/hạ — đóng tại <kho>, trả tại <nhà máy>` |
| NANGHA-R2 | Dòng lô LCL XUẤT | Đảo chiều đúng luật: Đóng = nhà máy, Trả = kho |
| NANGHA-R3 | Dòng lô LCL thiếu cả hai điểm | Hai vế in `—` (KHÔNG BAO GIỜ "Chưa cập nhật"); tooltip vẫn giải thích luật với "chưa rõ" |
| NANGHA-R4 | Dòng container (FCL/cont) | Giữ nguyên nhãn Nâng/Hạ + fallback "Chưa cập nhật" + chip trạng thái — không đổi |
| NANGHA-R5 | Vitest | Pin R1–R4 trong `ShipmentContainerLedger.test.tsx`; luật BE (swap hướng + fallback free-text) pin trong `backend/src/tests/unit/cus-lot-lift-drop-points.test.ts` |

## Verify

- UI drive script: `testplan/qa/scripts/2026-10-22-nangha-lcl-ui-drive.mjs`
- Environment: local dev — BEFORE phase trên stack main checkout (ports chuẩn,
  code gốc), AFTER phase trên stack worktree này (backend/frontend port riêng,
  cùng DB 5441). Role ADMIN (admin/Abc123).
- Fixtures (idempotent, DB local): lô 312423 (LCL01L2-DATED-017205) gán kho
  catalog site 5 "ASKEY - XƯỞNG 2" + site 1 "LM Võ Cường"; lô 312422
  (UNDATED) giữ trống. Hai lô Zalo production KHÔNG bị đụng (§2).

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| NANGHA-R1 lô LCL NHẬP có kho+NM — trước "Nâng/Hạ Chưa cập nhật"; sau Đóng ASKEY - XƯỞNG 2 / Trả LM Võ Cường + tooltip luật | 3 (UI DRIVEN) | `qa/2026-10-22-nangha-lcl/nangha-lcl-r1-r2-lcl-{before,after}.png`, `nangha-lcl-ui-{before,after}.log` (DOM text + title), API rows log | staging; viewport mobile 390 (drive 1440); role CUS | 
| NANGHA-R2 lô LCL trống điểm — sau '—' ×2 + tooltip "chưa rõ", không bao giờ "Chưa cập nhật" | 3 (UI DRIVEN) | same screenshots/logs (dòng UNDATED cùng bảng) | staging; mobile |
| NANGHA-R3 dòng container giữ Nâng/Hạ + cảng (cả 2 phase) | 3 (UI DRIVEN) | `nangha-lcl-r3-fcl-{before,after}.png` (TSTU3443063: SITC - Lạch Huyện / TC - HICT) | các cont khác trên trang |
| BE luật hướng + fallback free-text | Unit | `backend/src/tests/unit/cus-lot-lift-drop-points.test.ts` (7/7) | — |
| FE renderer pin R1–R4 | Unit | `ShipmentContainerLedger.test.tsx` (74/74 scoped) | — |
| Read-only fix — DB không đổi schema | 2 (DB VERIFIED) | DB lots identity trong log (version=1 giữ nguyên cả 2 phase) | — |

## Not covered

- Staging (local dev per brief).
- Viewport mobile 390 cho bảng Chi tiết lô (drive desktop 1440).
- Phối phiếu/phôi bằng chứng từ — dùng nguồn khác (container projection), không đổi.
- Sửa điểm đóng/trả từ bảng Chi tiết lô — lot row vẫn read-only; edits trên Tổng quan.

