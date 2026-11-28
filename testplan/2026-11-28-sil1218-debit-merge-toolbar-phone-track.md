# SIL-1218 (id 1400) — /accounting/ghep-bo-debit 390px: bộ lọc co về viewport (regression case)

Case ID: TC-SIL-1218-02
Feature: Toolbar bộ lọc (Khách hàng / Tìm kiếm / Từ–Đến / Lọc tuyến) của bảng Ghép bộ Debit ở băng ≤768px.

## Repro (QA, build 7a02200e → deb08aa9 — FAIL 2 lần)
1. Đăng nhập ngocntm, mở /accounting/ghep-bo-debit ở 390px.
2. Nhìn dải lọc đầu trang.

## Expected
- Mọi ô lọc vừa viewport hoặc xếp dọc full-width từng dòng; không ô nào nằm ngoài tầm với; placeholder không cắt giữa chữ.
- Bảng tiền giữ cuộn ngang riêng qua `.app-body` (luật SIL-897) — desktop one-row space-between giữ nguyên (luật SIL-987).

## Sửa (round 2 — 28/11)
- Round 1 (`min-width: 0` trên con toolbar) đo được 0px NHƯNG toolbar vẫn ~3187px: implicit column của `.debit-merge` grid lấy content minimum từ `.debit-merge__pane` (bảng tiền ~3.2kpx — pane cố ý không phải scroll container).
- Band ≤768px thêm `.debit-merge { grid-template-columns: minmax(0, 1fr) }` — cắt chuỗi min-content ở track; bảng vẫn tràn vào .app-body cuộn ngang như cũ.

## Pins
- `frontend/src/features/accounting/DebitMergeGrid.test.tsx` — "SIL-1218: the phone toolbar shrinks to the viewport…" pin track minmax(0,1fr) + child floors + vị trí rule (band-only, không rò ra desktop).

## Not covered
- UI DRIVEN 390px: QA verify trên staging sau deploy commit này.
