# SIL-638 (id 742) — TC1 gate sai theo khung giờ + TC2 chặn bất đối xứng (QA 03/11/2026)

QA verdict trên staging build `da2e6fc2` (round 03/11, evidence
`~/workspace/qa-1103/wave-qa/`): 2 lỗi thật trong logic điều phối Hàng Kẹp.
Build `da2e6fc2` ĐÃ bao gồm đợt fix 02/11 (4453a6572 — TC6(2) unprovable
weight + TC1 IN_TRANSIT busy warn), nên 2 case dưới đây là phần còn sót.

## Case S638-T1R2 — TC1: leg 14:00 bị chặn trước khi phát lệnh dù gap 6h ("1 READY leg/truck/day")

### Reproduction (pre-fix)

1. 2 lệnh ĐƠN (SINGLE) 20' cùng xe, cùng ngày; khung giờ khai báo
   KHÔNG trùng: ca sáng 08:00–12:00 và ca chiều 14:00–18:00 (gap 6h).
2. Gán chân ca chiều 14:00–18:00 (chưa phát lệnh nào) → **bị CHẶN** dù
   không có trùng giờ và không có chuyến đang chạy.

### Root cause

Cửa hàng chặn gán (plan-row holders) vẫn count chân READY trên xe trong
ngày qua window phình của holder: chân chưa phát không có giờ chạy thật,
nên holderEnd rơi vào coalesce mặc định (slot + 8h hoặc NGUYÊN NGÀY với
holder date-only), nuốt cả start 14:00 của chân chiều → guard đáp 409
(warn same-lot / hard cross-lot) — hành xử như "1 READY leg/truck/ngày"
thay vì luật overlap thật của khung giờ.

### Expected behavior (post-fix)

- Điều kiện chặn = **overlap khung giờ thật** (giờ khai báo 2 chân) +
  **trạng thái Đang chạy (IN_TRANSIT) chưa hoàn tất** — KHÔNG còn đếm số
  leg READY/truck/ngày.
- Ca chiều 14:00–18:00 lưu THÀNH CÔNG khi ca sáng 08:00–12:00 (chạy xoay
  vòng sáng/chiều).
- Trùng giờ thật (10:00–14:00 vs 08:00–12:00) vẫn chặn với cảnh báo xung
  đột thời gian; xe đang có lệnh IN_TRANSIT vẫn cảnh báo "xe đang bận"
  (confirmable — đợt 02/11 giữ nguyên, không regress).

## Case S638-T2R2 — TC2: chặn gán khi phân loại không đồng nhất chỉ chặn 1 chiều

### Reproduction (pre-fix)

1. Cont A khai KẸP (DOUBLE), Cont B để ĐƠN (SINGLE), cùng 1 xe.
2. Chiều KẸP(trước)→ĐƠN(gán sau): bị từ chối 409
   "Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe" (đúng).
3. Chiều ĐƠN(trước)→KẸP(gán sau): **lưu im lặng** — row KẸP là declared
   pair nên guard bỏ TOÀN BỘ scan plan-row holders (không nhìn thấy chân
   ĐƠN đang giữ xe) → không lỗi gì, không cảnh báo.

### Root cause

`assertPlanRowRigAvailable` tính `planConflicts = []` ngay khi row đang
lưu là DOUBLE/COMBINED (carve pair własnej arrangement) — carve này không
phân biệt holder CÙNG loại (arrangement thật) với holder ĐƠN (mâu thuẫn
phân loại). Ở trip-side, KẸP phát lên holder ĐƠN chỉ rơi vào confirmable
warn (dis-03), không phải refusal đối xứng.

### Expected behavior (post-fix, ticket v2 + brief 03/11)

- Gán 2 cont cùng xe khi phân loại KHÔNG đồng nhất (KẸP + ĐƠN) phải bị
  từ chối CẢ HAI CHIỀU (KẸP→ĐƠN và ĐƠN→KẸP) với CÙNG message không tương
  thích: "Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe".
- 2 chân CÙNG khai báo (DOUBLE↔DOUBLE, COMBINED↔COMBINED) giữ nguyên
  carve arrangement (TC3/TC7/auto-pair không đổi).
- TC6(1) 40' Kẹp, TC6(2) weight soft warning, TC7-TC9: không regress.

## Gates

- `cd backend && npx tsx --test --test-concurrency=1` trên các suite
  dispatch-planning + auto-pair + tc6 (--test-concurrency=1 BẮT BUỘC —
  shared DB deadlock).
- `pnpm exec tsc -p backend/tsconfig.json --noEmit`.
- Driver local (BE :3013 + ss-prod-db local, read-mostly probe family
  BK-S638*): PHASE=before tái hiện, PHASE=after chứng minh fix.
