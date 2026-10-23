# Case QA-2026-10-23-FB138 — Gán xe nhóm (ĐV): dropdown Loại xe thiếu options Xe tải

Card 231026162327 (QA R39 retest residual, build staging). Surface: /dispatch →
[Gộp hàng] → tích ≥2 lô LCL → popup "Gán xe nhóm" → dropdown
"Loại xe tính cước trả ĐV". Spec 23/10 §3: dropdown phải có TRỌNG TẢI XE TẢI
(1.25T, 2.5T, 5T…) VÀ Cont 20'/40'; ràng buộc nhà xe theo loại xe.

## Root cause

Các lớp xe tải (1.25T…15T) chỉ sống trong DEMO seeder dev/staging
(`seed-demo-freight-pricing.ts`, ensure-if-missing). Staging là prod-mirror:
chạy MIGRATION (đã có 4 lớp CONT giá của card 20260922_58) nhưng không chạy
demo seeder → catalog chỉ có 4 options Cont → dropdown không bao giờ hiện
Xe tải, không test được ràng buộc "xe tải ⇒ chỉ nhà xe ngoài" (FB-090).

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| FB138-R1 | Mở popup Gán xe nhóm, mở dropdown Loại xe | Menu grouped 2 section header: "XE TẢI (TẤN)" (1.25T/2.5T/3.5T/5T/8T/10T/15T) và "CONTAINER" (CONT20.LIGHT/HEAVY, CONT40.LIGHT/HEAVY) |
| FB138-R2 | DB prod-mirror (không có lớp xe tải) chạy migration mới | 7 dòng `1.25T…15T` xuất hiện (INSERT … ON CONFLICT DO NOTHING, idempotent) |
| FB138-R3 | Chọn lớp Xe tải | Dropdown Nhà xe CHỈ hiện nhà xe ngoài; hint "100% xe ngoài" |
| FB138-R4 | Đang giữ Đội xe nội bộ (lớp Cont) rồi đổi sang lớp Xe tải | Nhà xe reset về trống (không giữ ID mồ côi) + warning dưới field yêu cầu chọn lại nhà xe ngoài |
| FB138-R5 | Chọn lớp Cont | Nhà xe hiện cả Đội xe nội bộ SilverSea lẫn Nhà xe ngoài (như cũ) |
| FB138-R6 | Vitest | `AssignTruckGroupDialog.test.tsx` pin R1 + R3 + R4 |

## Verify
- `qa/2026-10-24-gomhang-r39/` — Playwright trước/sau + migration output.
