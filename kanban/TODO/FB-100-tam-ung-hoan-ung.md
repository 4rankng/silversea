# FB-100: Tạm ứng & hoàn ứng — nút phê duyệt, tick xác nhận, ghi nhận số âm
**Nguồn:** card `141026230770-tam-ung-hoan-ung-thieu-nut-va-so-am.docx` (wave W1) +
CPB-03/CPB-04
**Ưu tiên:** P2
- Dòng PENDING ở Yêu cầu tạm ứng có nút "Phê duyệt tạm ứng" (kế toán, duyệt =
  giải ngân KP-148 — cùng endpoint màn chi phí)
- Phiếu hoàn ứng: tick "Xác nhận hoàn ứng" bắt buộc trước khi ghi nhận; backend
  lưu checked_by/checked_at
- refundAmount có dấu (schema create+update) + bỏ min=0: phiếu ứng cao hơn chi
  phí (còn phải hoàn ứng ÂM) ghi nhận được, vẫn phải cân đối
- Báo cáo "Còn phải hoàn ứng (có dấu)" = ĐNTT − ĐÃ ỨNG + "Đề nghị thu tiền
  ứng" đã có sẵn — giữ nguyên
