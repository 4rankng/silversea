# FB-096: Kế toán — Thêm cược (gợi ý bill 4 số cuối + dữ liệu CUS)
**Nguồn:** card `141026230730-ketoan-them-cuoc-goi-y-bill-4-so-cuoi.docx` (wave W1)
**Ưu tiên:** P3
- Luồng "Thêm cược" trong Theo dõi hoàn cược: nút + modal mang tên "Thêm cược"
- Ô Bill/Book điền 4 số cuối → gợi ý bill của lô hàng (API bill-suggestions có sẵn)
- Khách hàng / Hãng tàu tự điền từ dữ liệu CUS (Bill/book – Hãng Tàu – Tên Khách hàng); sửa tay được
- Lưu qua POST /api/accounting/deposits (idempotent) — không tạo bảng cược mới
