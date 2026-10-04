# Case QA-2026-10-04-328 — Form tạo lô nhập được NHIỀU tờ khai (card 20261004_328)

- Card: 20261004_328-cus-single-to-khai (bug P2, feedback Zalo 19/09)
- Environment: local dev (:7175) DEV evidence; staging QA rung after cut
- Account: thanhdc / Abc123 (Khách hàng)
- mutates: none ở rung visual (draft-only, không submit); persistence chứng minh bằng test

## Repro (pre-fix)
1. Đăng nhập thanhdc, vào /shipments/new (Tạo lô mới).
2. Mục Danh tính lô: ô "Số tờ khai" — CHỈ 1 ô, không có nút thêm; lô nhiều tờ khai không nhập đủ.

## Expected (post-fix)
- Nút "+ Thêm tờ khai" tạo dòng "Số tờ khai N" — nhiều dòng đồng thời (≥2-3), xóa/sửa từng dòng.
- Lưu lô → N dòng thành N tờ khai (seam declarations); guard trùng lặp cảnh báo TỪNG dòng; lô 1 tờ khai giữ nguyên payload/hành vi cũ.

## Rungs
- UI DRIVEN: real-tap "+ Thêm tờ khai" ×2 → 3 ô đồng thời (label-aware count=3), real-keyboard nhập "TK-2026-00x"; matrix form 1280/1440/1920/2560 + 390.
- TEST VERIFIED (audit lane ShipmentForms325 trên landing 553239b4): red tests cho retry-reconcile (createDeclaration 4×→2), per-row duplicate-guard (dòng 2+), single-row payload pin; gap-fill commit b48375a3.
- Staging rung: tạo lô thật 3 tờ khai → kiểm tra chi tiết lô có đủ 3; record buildHash.

## Status
- [x] local visual rung executed (lead) — 04/10 (draft rows; persistence = tests)
- [ ] staging rung executed (lead)
