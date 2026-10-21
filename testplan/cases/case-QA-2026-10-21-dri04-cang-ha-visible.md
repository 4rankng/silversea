# Case QA-2026-10-21-dri04-cang-ha-visible — driver trip: Cảng hạ + Địa chỉ giao luôn 2 dòng rõ

Card 211026130843 (dri-04). Trên driver trip detail, cặp dòng "Cảng hạ" /
"Địa chỉ giao hàng" fallback câm lặng: lô xuất khẩu thì dòng Địa chỉ giao hàng
biến mất hẳn (delivery row chỉ render cho IMPORT且有 factory — card 121026141020),
lô thiếu điểm hạ thì Cảng hạ rơi về "—" → QA tưởng không hiển thị / không implement.

## Trạng thái trước fix

- `cangHa = locations.drop ?? (IMPORT ? 'Chưa có cảng hạ' : '—')` → EXPORT/thiếu
  điểm hiện "—" thay vì named fallback.
- `deliveryAddress` chỉ tính cho IMPORT; EXPORT hoặc thiếu factory → row ẩn hoàn toàn.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| DRI04-R1 | Driver mở chuyến XUẤT KHẨU có điểm hạ | CẢ HAI dòng hiện: "Cảng hạ: <cảng>" và "Địa chỉ giao hàng: <cảng>" (XK giao/hạ tại cảng — 2026-09-18 ruling); dòng Địa chỉ giao mang tooltip 1 dòng giải thích luật |
| DRI04-R2 | Chuyến XK thiếu điểm hạ | 2 dòng vẫn hiện đủ nhãn: "Chưa có cảng hạ" / "Chưa có địa chỉ giao" — không bao giờ ẩn dòng |
| DRI04-R3 | Chuyến nội địa (không direction) có factory | Cảng hạ = điểm hạ (hoặc "Chưa có cảng hạ"); Địa chỉ giao hàng = đích đến factory (hoặc "Chưa có địa chỉ giao") |
| DRI04-R4 | IMPORT giữ nguyên luật FB-082 | Địa chỉ giao hàng = đích factory (không echo bãi hạ); Cảng hạ ưu tiên depot legacy |
| DRI04-R5 | Vitest | Unit pin R1–R3 trong `DriverTaskInfoSections.test.tsx` |

## Verify

- UI drive script: `testplan/qa/scripts/2026-10-21-cus11-dri04-ui-drive.mjs`
- Environment: local dev (frontend 7175/7176-worktree, backend 3002, postgres 5441)
- Role: DRIVER (`dvthuc` — trips 37088/40395; `bqhuong` — trip 193113)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| DRI04-R1 XK có điểm hạ (trip 37088) — trước: delivery row ẨN; sau: 2 dòng 'Cảng ICD Sóng Thần' + tooltip luật XK | 3 (UI DRIVEN) | `qa/2026-10-21-cus11-dri04/dri04-r1-export-drop-{before,after}.png`, logs | staging; IMPORT có depot legacy (unit-only) |
| DRI04-R2 XK thiếu điểm (trip 40395) — trước '—' + ẩn; sau 'Chưa có cảng hạ' / 'Chưa có địa chỉ giao' | 3 (UI DRIVEN) | `qa/2026-10-21-cus11-dri04/dri04-r2-export-bare-{before,after}.png`, logs | staging |
| DRI04-R3 nội địa (trip 193113) — trước: delivery row ẩn; sau: 'Nhà máy Tân Tạo' cạnh 'Kho Trả Hàng Thủ Đức' | 3 (UI DRIVEN) | `qa/2026-10-21-cus11-dri04/dri04-r3-domestic-{before,after}.png`, logs | staging; desktop width (driver app mobile 390) |
| DRI04-R4 IMPORT FB-082 law | Unit | `DriverTaskInfoSections.test.tsx` (đích factory, depot leads Hạ) | không drive UI trip IMPORT trong đợt này |
| DRI04-R5 vitest | Unit | 164/164 scoped pass | — |
| DB không đổi (read-only fix) | 2 (DB VERIFIED) | DB rows before/after identity trong log | — |

## Not covered

- Staging (local dev per brief).
- Viewport desktop cho driver app (designed mobile 390px; drive ở 390).
- Row "Trả cont rỗng" (legacy data) — không đổi luật, chỉ giữ nguyên conditional.
