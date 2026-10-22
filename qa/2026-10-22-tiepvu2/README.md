# TiepVu 22/10-2 — QA evidence (cards 261022213755a/b/c)

Environment: local dev. Stacks — TRƯỚC (pre-fix): main checkout
`http://localhost:7175` → backend :3002; SAU (fixed): worktree
`fix-tiepvu2-off2` `http://localhost:7176` → backend :3003 (cùng DB local
:5441). Accounts: `testplan/testaccounts.txt` (laixe / cus / admin, Abc123).
Viewport driver (a): 390×900; (b)/(c): 1440×900.

## Gates (đầy đủ output trong gates.txt)
- `pnpm lint` → 0 errors
- `cd backend && npx tsc --noEmit` → 0
- `cd backend && pnpm test` → 397/397 + 338/338 pass
- `cd frontend && npx tsc -b` → 0; `pnpm tsgo --noEmit` → 0
- `cd frontend && pnpm test` → 5497 + 2 dist-contract (sau `make build`) = all pass
- `make build` → thành công

## (a) Driver hoàn tất lô KHÔNG ảnh — card 261022213755a
QA trip 194126 (fulfillment 143547; QA prep: driver_id tạm gán laixe
(drivers.id 1), planned_start_at đẩy về 2026-10-20 để qua rule "hoàn thành ≥
khởi hành"; sau QA đã restore driver_id=42966. Trip giữ trạng thái COMPLETED —
side-effect dứt khoát của lần chạy complete, không rollback được).

- TRƯỚC (7175): `driver-a3-epod-gate` — card "Chứng từ bắt buộc", nút
  HOÀN THÀNH CHUYẾN `disabled:true`, footer "e-POD là bắt buộc … Thiếu Phiếu
  bãi / phiếu hạ / Biên bản giao nhận"; sticky bar "Còn thiếu 2 chứng từ".
- SAU (7176): `driver-a3-epod-gate` — card "Chứng từ giao hàng", nút
  `disabled:false`, footer "Ảnh e-POD hiện tùy chọn … Đủ điều kiện hoàn thành
  chuyến."; sticky bar "Chưa có 2/2 ảnh chứng từ (tùy chọn)".
- Click HOÀN THÀNH CHUYẾN với 0 ảnh → POST /complete **200**
  `{"status":"COMPLETED","evidenceStatus":{"ready":true,"hasSubmittedPod":false,...}}`
  → điều hướng /my-trips (`driver-a4-after-complete`).
- DB: trips 194126 → COMPLETED, completed_at=2026-10-22 14:52:36.568,
  trip_pod_submissions=0, 4 mốc tự ghi (ORDER_RECEIVED sẵn + PICKED_UP /
  LOADING_OR_RETURNING / DELIVERED inferredFromCompletion).

## (b) Search kho GLC — card 261022213755b
QA seed: kho "GLC" (KHO-E2E-QA-GLC, id 27165, shortName "GLC") qua POST
/api/shipments/operational-sites (admin); đã soft-delete sau QA. Form tạo lô
nhập lẻ (cus), ô Kho lấy hàng:

- TRƯỚC (7175): gõ G→L→C đủ "GLC" → `aria-expanded="false"`, 0 option GLC
  (menu đóng ngầm giữa chừng — đúng repro "gõ GLC không ra").
- SAU (7176): "GLC" → `aria-expanded="true"`, 1 option GLC; biến thể
  Glc / glc / GL → đều `options=1 expanded=true`; click option → input
  commit "GLC" (id 27165).

## (c) Badge NHẬP LẺ/XUẤT LẺ — card 261022213755c
- List CUS (cus, /shipments): TRƯỚC badge LCL row đọc "Nhập"; SAU đọc
  "Nhập lẻ" (các dòng FCL giữ "Nhập") — `cus-c1-list-badges`.
- Chi tiết lô LCL 312423 (LONG MINH, IMPORT): TRƯỚC "Xuất / Nhập: Nhập";
  SAU "Xuất / Nhập: Nhập lẻ" (+ "Loại lô: Hàng lẻ (LCL)") — `cus-c2-detail`.

## Cleanup
- Kho QA 27165 soft-deleted (DELETE API, 200).
- Trip 194126: driver_id restore về 42966; trạng thái COMPLETED giữ nguyên
  (kết quả của lần hoàn thành QA — append-only), planned_start_at/departure_date
  còn giá trị QA 2026-10-20.
- Không lô hàng mới nào được submit trong phase (b) (form không lưu).

## Driver
`qa/scripts/2026-10-22-tiepvu2/qa-tiepvu2-driver.mjs` + `qa-tiepvu2-c-detail.mjs`
(chạy từ frontend/ để resolve @playwright/test). Log: `qa-tiepvu2-{truoc,sau}-driver.log`.
