# Testplan — Chi phí - Quyết toán (Debit CUS) — rung wave _17/_18/_19 (2026-09-18)

Nguồn (spec cards):
- `20260918_17-debit-cus-l1-lot-list.docx` — Lớp 1: danh sách lô, bộ lọc, tổng hợp doanh thu
- `20260918_18-debit-cus-l2-workspace.docx` — Lớp 2: workspace 3 bảng cước/chi hộ/phải trả
- `20260918_19-debit-cus-lock-debitnote.docx` — Khóa lô, điều chỉnh cước, xuất Debit Note
- Spec gốc: '2026.9.17_Chi_phi_Debit_Cus - SỬA L1.docx'; PRD tiền: O2C §7 (phải thu ≠ đã thu ≠
  đã khóa) + §8 (lưu lặp không nhân đôi).

Màn hình mới 'Chi phí - Quyết toán' — nav Sidebar NGAY DƯỚI 'Chi tiết lô hàng' (rung riêng
TC-DN-COMMON-01). Chuẩn làn: UI DRIVEN trên staging, bấm thật, ảnh từng case; API chỉ làm bằng
chứng phụ (đọc payload/DB-shaped endpoint); ghi buildHash từng rung; fixture QA-owned prefix
`QAE2E-CHIPHI-` công bố trước khi seed.

## Điều kiện tiền đề (fixture set, QA seed trước khi rung)

- F-SET-A: 1 lô FCL ≥2 container có đủ: cước auto (gốc hợp đồng + fuel), HQGS các luồng
  (đỏ/xanh/vàng), chi hộ có hóa đơn (nâng/hạ/CSHT kèm số HD), Phí khác (nhập tay), cược hãng tàu > 0,
  tạm thu sửa chữa > 0, khoản chi OPS (Bảng 2.3), PS thực tế trống.
- F-SET-B: 1 lô dùng-chung (kẹp/kết hợp) — 1 khoản phí phủ 2 lô, phải cộng một lần duy nhất.
- F-SET-C: 1 lô thiếu dữ liệu tiền (chưa xác định) và 1 lô đã khóa sẵn.
- Số liệu gốc mỗi fixture chốt bằng bảng mốc (expected rollup) trước khi rung.

## _17 — Lớp 1: bộ lọc + danh sách + tổng hợp

- TC-DN-17-01 — Customer-required gate (P0): chưa chọn khách → không có danh sách lô; chọn khách →
  danh sách tải đúng phạm vi khách. Fail nếu danh sách hiện sẵn hoặc lệch khách.
- TC-DN-17-02 — Filter persistence: Date Range (theo ngày giao hàng) + Trạng thái Khóa lô
  [Tất cả | Đang mở | Đã khóa] giữ theo URL, reload giữ nguyên kết quả; đổi nhánh filter cập nhật
  đúng danh sách.
- TC-DN-17-03 — Rollup đúng nguồn (P0): từng dòng = cước vận tải (auto) + tổng chi hộ + tổng phải
  thu khách + lợi nhuận KHỚP bảng mốc fixture; phí dùng chung (kẹp/kết hợp) chỉ tính 1 lần
  (đối chiếu F-SET-B). Fail nếu lệch số hoặc đếm đôi.
- TC-DN-17-04 — 🔓/🔒 đúng thực tế: hàng Đang mở/Đã khóa phản ánh đúng trạng thái lot; hàng khóa
  phân biệt rõ (nền/badge) ở CẢ 1440/820/390px (ảnh từng viewport).
- TC-DN-17-05 — chưa-xác-định vs 0 (P0, O2C §7): ô thiếu dữ liệu hiển thị 'chưa xác định', không
  tự điền 0; phải thu ≠ đã thu ≠ đã khóa hiển thị đúng nhãn.
- TC-DN-17-06 — Debit Note enablement: nút [Xuất Debit Note] render đúng vị trí; DISABLE khi chưa
  tích hoặc chỉ tích lô đang mở; ENABLE đúng khi có ≥1 lô đã khóa được tích (hành vi xuất rung ở
  _19).
- TC-DN-17-07 — 3 viewports: 1440/820/390 — layout danh sách gọn, cột tiền không vỡ dòng, hàng
  khóa nhận diện được (ảnh từng cỡ).

## _18 — Lớp 2: workspace 3 bảng

- TC-DN-18-01 — [+]/[−] mở đóng workspace dưới đúng dòng lô, không làm nhảy dòng khác; trạng thái
  mở giữ khi cuộn trong phiên.
- TC-DN-18-02 — Bảng 2.1 (auto, gắn container): Số Container (+loại), Cước thu, Phụ phí xăng dầu,
  Lạch Huyện, Phí HQGS (luồng đúng màu auto) khớp nguồn theo từng container; ô ✏️ PS thực tế nhập
  được, LƯU được, Tổng dòng + rollup cập nhật sau lưu.
- TC-DN-18-03 — Bảng 2.2: cột Ops-invoiced (Phí Nâng/Hạ/CSHT kèm số HD) READ-ONLY thật sự (không
  sửa được bằng click lẫn keyboard); Phí khác nhập tay được số phải thu + TÊN PHÍ; Cược hãng tàu
  > 0 và Tạm thu sửa chữa > 0 hiện ⚠️ + nền cam; trạng thái Chứng từ Ops (📎 Đã đủ / thiếu) đúng.
- TC-DN-18-04 — Bảng 2.3 (phải trả, gắn lô) READ-ONLY thật sự ở mọi kích thước; số khớp điều
  vận/OPS đã nhập (cước trả + Lạch Huyện, Phí HQGS + Phí phát sinh).
- TC-DN-18-05 — Rollup lên Lớp 1: sau khi điền Thu khách ở 2.2 và LƯU, tổng Lớp 1 cập nhật NGAY
  (không tải lại); bấm lưu LẶP 3 lần → số không nhân đôi (PRD O2C §8; kiểm cả Idempotency-Key
  replay ở mức API nếu thấy cần).
- TC-DN-18-06 — Nhãn tiền đúng loại phải thu/đã thu/phải trả/đã khóa; thiếu dữ liệu → chưa xác
  định, không 0 hóa.

## _19 — Khóa lô + điều chỉnh cước + Debit Note

- TC-DN-19-01 — Khóa: bấm [🔒 KHÓA LÔ HÀNG] → TOÀN BỘ ô nhập Lớp 2 đóng băng thật (read-only cả
  keyboard/Tab+gõ), lô chuyển 🔒, tổng Lớp 1 giữ nguyên số đã khóa; kỳ dầu mới về sau KHÔNG đổi
  số đã khóa (nếu có cài đặt giá mới, đối chiếu trước/sau).
- TC-DN-19-02 — Sau khóa, mọi thay đổi chỉ đi theo nghiệp vụ điều chỉnh: không còn đường sửa âm
  thầm; chỉnh sửa sau khóa đều qua form điều chỉnh có quyền + lý do + lịch sử.
- TC-DN-19-03 — [✏️ ĐIỀU CHỈNH CƯỚC]: chỉ mở khi có quyền; giữ cước hợp đồng hiển thị để đối
  chiếu; lý do BẮT BUỘC có nội dung (bỏ trống bị chặn); lịch sử xem được trước/sau.
- TC-DN-19-04 — Xuất Debit Note: chỉ bật khi có lô khóa được tích; file xuất (in/xem trước) KHỚP
  số màn hình: mã lô, khách, cước, chi hộ, phải thu, tổng; bấm lặp → không tạo bản trùng.
- TC-DN-19-05 — Mất kết nối/thử lại: replay cùng key không sinh lô khóa/Debit trùng; thông báo
  phân biệt rõ 'đã lưu' vs 'chưa rõ kết quả'.

## Chung (cross-card)

- TC-DN-COMMON-01 — Nav 'Chi phí - Quyết toán' trong Sidebar NGAY DƯỚI 'Chi tiết lô hàng'.
- TC-DN-COMMON-02 — Phân quyền: CUS chỉ thấy lô phạm vi mình; DISPATCHER/ADMIN xem theo role
  hiện hành (đối chiếu role matrix nếu spec có đính).
- TC-DN-COMMON-03 — Mọi rung ghi buildHash + fixtures dùng; số mốc expected được nêu trong report.

## Ghi chú thực thi

- Thứ tự rung: _17 → _18 → _19 (phụ thuộc tuần tự); TC 17-05/17-06 dùng chung fixture _19.
- API support: GET workspace/aggregate endpoints đối chiếu số; Idempotency-Key replay cho
  18-05/19-04/19-05; KHÔNG dùng API để biến trạng thái khi case đòi bấm UI thật.
- Ảnh: mỗi case ≥1 ảnh; 3-viewport (1440/820/390) bắt buộc cho 17-04/17-07.
- Bug phát hiện ngoài case → card mới + ghi chéo vào report rung đó (chuẩn _16 đã làm).

## Lớp adversarial — MAXIMUM-RIGOR re-rung (user directive 2026-09-18 "test very very carefully")

Áp cho build cut I trở đi (sau fix _18/_19). Giữ nguyên 18-TC làm base; mỗi mục dưới đây là
lớp bắt buộc thêm vào, chạy TRÊN DỮ LIỆU THẬT lẫn fixture:

- ADV-1 REAL-DATA MATRIX: rung trên các lô thật của staging với dữ liệu lộn xộn — thiếu EDD,
  container không có snapshot, dòng raw/catalog trộn lẫn — không chỉ fixture sạch. Lớp lock-500
  và empty-rows thường nổ ở đây.
- ADV-2 IDEMPOTENCY SEQUENCES: với MỌI thao tác ghi (L2 save, lock, adjust, Debit Note) —
  double-click, retry-sau-thất-bại, replay cùng Idempotency-Key; khẳng định mỗi lần: 1 dòng /
  1 tài liệu / tiền KHÔNG nhân đôi.
- ADV-3 CONCURRENCY: 2 phiên (thanhdc + admin) sửa cùng L2 của một lô; lock trong khi phiên kia
  đang sửa; version conflict phải nổi lên sạch (409 + thông báo), không ghi đè im lặng.
- ADV-4 MONEY-STATE AUDIT: trên TỪNG lớp ô — phải thu ≠ đã thu ≠ đã khóa ≠ chưa xác định render
  và persist phân biệt; kể cả sau lock (số đóng băng) và sau khi mở KỲ DẦU MỚI (số đã khóa không
  dịch chuyển).
- ADV-5 KEYBOARD-LEVEL FREEZE: ô L2 đã khóa phải cưỡng được keyboard entry, Enter submission, và
  programmatic focus — không chỉ nhìn disabled.
- ADV-6 EXPORT AUDIT: dòng Debit Note = màn hình = lock snapshot (đối chiếu 3 chiều); xuất lần 2
  replay cùng tài liệu (không trùng); số không đổi sau bất kỳ thay đổi dữ liệu về sau.
- ADV-7 VIEWPORT + KEYBOARD-ONLY: 3 viewport (1440/820/390) cho MỖI trạng thái quan trọng
  (list, L2 mở, locked, debit export) + một lượt đi toàn bộ L2 bằng keyboard-only (Tab/Enter).

Quy tắc báo cáo: mỗi tiêu chí ghi buildHash + ảnh riêng; ghi thẳng hàng "NOT COVERED" cho phần
không chạy được — gap trung thực thay vì pass bịa.
