# FB-101: Chấm công bị ẩn — hiện mục cho kế toán + điều tra nguyên nhân
**Nguồn:** card `141026230780-cham-cong-bi-an-kiem-tra-he-thong.docx` (wave W1)
**Ưu tiên:** P2
- Nguyên nhân: (1) module timesheet chưa lên staging thời điểm báo (chưa làm
  xong — đã có từ wave D 290b7c09); (2) mục "Chấm công lái xe" đóng khung
  DISPATCHER nên kế toán vẫn không thấy; không phải lỗi máy khách
- Mục "Chấm công lái xe" mở cho ACCOUNTANT (nav + route); ô lưới read-only với
  kế toán, nút "Lưu lưới" chỉ hiện cho vai trò ghi được (backend
  dispatcherOrAbove)
- Pin nav cập nhật + test TimesheetGridPage vai trò
