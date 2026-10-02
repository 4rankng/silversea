# CASE QA-2026-09-24-04 — P3 phơi phiếu: dialog chi phí và panel "Thêm khoản chi" không được mở/đè đồng thời

- **Card:** 20260923_11 (defect VISUAL ưu tiên cao — Chief, ảnh nghiệm thu P3)
- **Màn:** P3 phoi-phieu — Kế toán kiểm soát phôi phiếu đối chiếu tiền thu và trả
- **URL:** http://localhost:7175 (local dev) / https://vantai.tingting.vip/
- **Scope:** `frontend/src/features/accounting/PhoiPhieu*` + `frontend/src/pages/accounting/PhoiPhieuControlPage.tsx` — không backend.

## Repro steps (trước fix — RED)

1. Mở P3 phơi phiếu, tìm một chuyến trên bảng kiểm soát.
2. Bấm icon biên lai cột "Chi hộ" → dialog **Chi tiết chi phí** (bảng STT/Nội dung phí/Hóa đơn/Số tiền thu/Số tiền trả + Hủy) mở ra.
3. Bấm **＋ Thêm dòng** → panel **Thêm khoản chi** (Nhóm chi phí/Loại phí/Thực chi/Thực thu/… + Đồng/Lưu khoản chi) mở ra.
4. **Lỗi (ảnh Chief):** 2 surface cùng mounted → nội dung 2 surface trộn vào nhau, checkbox "Nhập Thu và Trả bằng nhau" nằm giữa vùng đè.
5. Variant board-level: mở "Xem chi tiết" (tiền đường) rồi bấm icon "Chi tiết chi hộ" trên cùng row → 2 dialog board cùng mở.

## Expected behavior (sau fix)

- Chỉ **1 surface active** tại một thời điểm:
  - Mở panel "Thêm khoản chi" → dialog "Chi tiết chi phí" **không render** (không còn backdrop/overlay chồng nhau); panel hiển thị một mình.
  - Đóng panel (✕ hoặc "Đóng") → quay lại dialog "Chi tiết chi phí", edits dở dang trên bảng rows còn nguyên (component giữ mount).
  - Tạo khoản chi xong (Lưu khoản chi) → invalidate `qk.phoiPhieu.chiHo(tripId)`, quay lại dialog với row mới.
  - Board: trigger surface này phải clear state surface kia — luôn `getAllByRole('dialog')).toHaveLength(1)`.
- Không còn vùng đè: không simultaneously có `dialog "Chi tiết chi hộ"` + `dialog "Thêm khoản chi"` trong DOM.

## Regression pin (automated)

- `frontend/src/features/accounting/PhoiPhieuChiHoDialog.test.tsx` — describe "one modal surface at a time in the chi-hộ flow (card 20260923_11)": 2 test (mở panel → dialog đóng; đóng panel → dialog trở lại, luôn đúng 1 dialog).
- `frontend/src/features/accounting/PhoiPhieuDialogs.test.tsx` — "retires the open detail surface when another is requested — never two board dialogs at once".
- **Red-first evidence:** revert 2 file source về HEAD → cả 2 test mới FAIL (2 failed | 12 passed); với fix → 18/18 pass.

## Chạy lại

```bash
cd frontend && npx vitest run src/features/accounting/PhoiPhieuChiHoDialog.test.tsx src/features/accounting/PhoiPhieuDialogs.test.tsx
```

## Trạng thái

- Automated: **PASS** (qa/2026-09-24_card-11_frontend-gates.log).
- Browser click-through: **NOT TESTED** theo chỉ đạo card ("KHÔNG browser QA") — chưa chụp ảnh after 1280/390; Chief criteria #3 (ảnh after) còn nợ khi có QA browser.
