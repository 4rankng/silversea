#!/usr/bin/env python3
"""Generate Kanban-PROD TODO tickets for the 'các chi phí.pdf' QA audit (2026-09-22).

Each card embeds its own screenshots and full facts, adhering to the UI Verification
Contract in AGENTS.md.
"""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path('/Users/dev/Library/CloudStorage/GoogleDrive-frankng.sg@gmail.com/My Drive/SilverSea/Kanban-PROD/TODO')
EV = 'qa/2026-09-22_cac-chi-phi-audit'
SPEC = 'testplan/2026-09-22-cac-chi-phi-audit-bugs.md'

CARDS = [
    dict(
        num='51',
        slug='phoi-phieu-dialog-chi-tiet-ve-ngoai-man-hinh',
        case_id='TC-CCP-01',
        title='Hộp thoại "Xem chi tiết" (Chi hộ & Tiền đường) trên màn Phơi phiếu render ngoài màn hình ở top >21,000px do thiếu backdrop fixed',
        status='MỞ — phát hiện qua QA thực tế theo tài liệu các chi phí.pdf (local dev HEAD, 1440px)',
        source=f'Yêu cầu mục 3.a ("Kiểm soát phơi phiếu - Chi hộ & Tiền đường") trong tài liệu `các chi phí.pdf`. Thao tác chuột thật bởi vai trò Kế toán (`ketoan`) trên màn hình `/accounting/phoi-phieu`.',
        desc=[
            'Khi kế toán bấm nút "Xem chi tiết" ở cột "Chi hộ (Phải thu / Phải trả)" hoặc cột "Tiền đường", giao diện hoàn toàn không xuất hiện hộp thoại nào trước mắt người dùng (nhìn như nút bấm bị liệt hoặc không có phản hồi).',
            'Nguyên nhân kỹ thuật: Trong `PhoiPhieuChiHoDialog.tsx` và `PhoiPhieuTienDuongDialog.tsx`, dialog render thẻ `<div role="dialog" className="ops-modal">` nhưng KHÔNG import stylesheet `ops-modal.css` và KHÔNG có thẻ bọc `<div className="ops-modal-backdrop">` (hoặc `OpsModalBackdrop`).',
            'Đồng thời, component này được mount ở cuối file `PhoiPhieuControlPage.tsx` (phía dưới toàn bộ bảng 100+ dòng, 2 bảng báo cáo tháng thu/trả và danh sách phân công xe).',
            'Kết quả đo DOM thực tế bằng Puppeteer: Hộp thoại render tại toạ độ `top: 21588.375px` (Chi hộ) và `top: 21277px` (Tiền đường) trên màn hình viewport cao 900px. Người dùng phải cuộn chuột qua 24 trang màn hình mới thấy modal nằm trơ trọi, không backdrop, không căn giữa ở tận đáy trang.',
            'Theo mục 3.a của tài liệu `các chi phí.pdf`, popup này là chức năng trọng yếu để kế toán kiểm tra, chỉnh sửa chi hộ (nhập Thu = Trả, cập nhật ngày lấy phơi, trạng thái lấy) và tiền đường theo từng container/chuyến.',
        ],
        evidence=[
            (f'{EV}/01_phoi_phieu_dialog_top_invisible.png',
             'Giao diện người dùng sau khi bấm nút "Xem chi tiết": màn hình đứng yên, không có hộp thoại nào xuất hiện trong tầm nhìn.'),
            (f'{EV}/01_phoi_phieu_dialog_scrolled_bottom.png',
             'Cuộn chuột xuống toạ độ y = 21,500px: Hộp thoại chi tiết Chi hộ nằm trơ trọi ở đáy trang web sau hàng trăm dòng dữ liệu.'),
        ],
        facts=[
            'File `frontend/src/pages/accounting/PhoiPhieuControlPage.tsx` (dòng 265): `{chiHoTripId != null && <PhoiPhieuChiHoDialog ... />}` nằm ở đáy component.',
            'File `frontend/src/features/accounting/PhoiPhieuChiHoDialog.tsx` (dòng 109): `<div role="dialog" aria-modal="true" aria-label="Chi tiết chi hộ" className="ops-modal">` thiếu thẻ `.ops-modal-backdrop` (thẻ này có `position: fixed; inset: 0; z-index: var(--z-modal); display: flex; align-items: center; justify-content: center`).',
            'File `frontend/src/features/accounting/PhoiPhieuTienDuongDialog.tsx` (dòng 33): cũng mắc lỗi tương tự.',
            'Cả hai file đều thiếu `import "./ops-modal.css";`.',
            'Số đo Puppeteer: `top: 21588.375px`, `scrollY: 0`, `height: 574px`, hoàn toàn nằm ngoài viewport 1440×900.',
        ],
        ac=[
            'Khi bấm "Xem chi tiết" ở bất kỳ dòng nào trong cột Chi hộ hoặc Tiền đường, modal chi tiết phải hiển thị ngay lập tức ở chính giữa màn hình (viewport center).',
            'Bọc dialog bằng `OpsModalBackdrop` hoặc lớp `.ops-modal-backdrop` với nền mờ che phủ toàn bộ trang web và khoá cuộn nền.',
            'Import đầy đủ `./ops-modal.css` trong cả `PhoiPhieuChiHoDialog.tsx` và `PhoiPhieuTienDuongDialog.tsx`.',
            'Bấm phím Escape hoặc nút [✕] phải đóng modal và trả tiêu điểm về nút kích hoạt.',
            'Bổ sung test tự động kiểm tra modal hiển thị trong viewport (`rect.top >= 0 && rect.bottom <= window.innerHeight`).',
        ],
        verify=[
            'Chạy dev server: `make dev` (port 7175 và 3002).',
            'Đăng nhập tài khoản `ketoan` / mật khẩu `Abc123`.',
            'Truy cập `/accounting/phoi-phieu`.',
            'Bấm nút "Xem chi tiết" ở dòng đầu tiên của cột "Chi hộ": Hộp thoại chi tiết phải xuất hiện ngay giữa màn hình với backdrop tối màu bao quanh.',
            'Tích chọn "Tích để nhập Thu và Trả phơi bằng nhau" và kiểm tra giá trị Thu tự động điền sang Trả.',
            'Bấm nút "Xem chi tiết" ở cột "Tiền đường": Hộp thoại chi tiết tiền đường phải xuất hiện giữa màn hình.',
        ],
    ),
    dict(
        num='52',
        slug='invoice-tracking-chong-chu-14-cot',
        case_id='TC-CCP-02',
        title='Bảng "Theo dõi hóa đơn kết hợp" bị chồng chữ chéo giữa các cột do table-layout fixed chia đều 80.6px kết hợp nowrap và overflow visible',
        status='MỞ — phát hiện qua QA thực tế theo tài liệu các chi phí.pdf (local dev HEAD, 1440px)',
        source=f'Yêu cầu mục 3.c ("Theo dõi hóa đơn kết hợp") trong tài liệu `các chi phí.pdf`. Màn hình `/accounting/invoice-tracking` (Kế toán `ketoan`).',
        desc=[
            'Bảng "Theo dõi hóa đơn kết hợp" có 14 cột nhưng sử dụng `table-layout: fixed; width: 100%` mà không đặt độ rộng tối thiểu cho bảng (`min-width: 1400px` trở lên) hoặc không phân bổ tỷ lệ cột (`colgroup`).',
            'Trên màn hình 1440px tiêu chuẩn, mỗi cột bị ép co lại chỉ còn 80.64px.',
            'Trong `AccountingInvoiceTrackingPage.css`, các ô nội dung sử dụng `.ivt-stack > span { white-space: nowrap; }` đồng thời các ô `td` không có `overflow: hidden`.',
            'Kết quả: Các dòng chữ dài (Mã lô `SHP-2609-00020`, Tên khách hàng `CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH`, Số hóa đơn `HD-C18-01`, Số tiền `12.000.000 đ`) có độ rộng từ 140px đến 180px, tràn tự do sang phải từ 35px đến 60px và đè thẳng lên nội dung của cột kế tiếp (đè lên số container `QATU1234569`, đè lên số tiền `8.000.000 đ`). Chữ và số đè lên nhau thành một khối đen hỗn độn, người dùng không thể đọc được hóa đơn nào thuộc số tiền nào.',
        ],
        evidence=[
            (f'{EV}/02_invoice_tracking_overlap_crop.png',
             'Ảnh crop thực tế bảng hóa đơn: Tên công ty Long Minh tràn đè lên mã container; thông tin hóa đơn HD-C18-01 đè trực tiếp lên cột tiền kế bên.'),
        ],
        facts=[
            'CSS hiện tại: `frontend/src/pages/AccountingInvoiceTrackingPage.css` có `.invoice-tracking-table { width: 100%; table-layout: fixed; }` và `.ivt-stack > span { white-space: nowrap; }`.',
            'Đo đạc DOM thực tế: Bảng rộng 1129px, chia đều 14 cột = 80.64px/cột.',
            'Text width của ô Mã lô / Khách hàng = 115px (tràn 34.4px sang cột Container).',
            'Text width của ô Số hóa đơn / Số tiền = 140px (tràn 59.4px sang cột Số tiền xuất).',
            'Số và chữ đè chồng chéo lên nhau làm mất tính chính xác của dữ liệu tài chính.',
        ],
        ac=[
            'Bảng 14 cột phải có `min-width` tối thiểu đủ cho tất cả các cột hiển thị rõ ràng (khuyến nghị `min-width: 1350px` kèm thanh cuộn ngang mượt mà trong container bọc ngoài).',
            'Bổ sung `colgroup` hoặc thiết lập chiều rộng hợp lý cho các cột text dài (Mã lô & Khách hàng ≥ 160px, Hóa đơn ≥ 130px, Container ≥ 120px).',
            'Tuyệt đối không để chữ của cột này tràn sang và che khuất nội dung của cột kế tiếp (`overflow: hidden; text-overflow: ellipsis` kèm title/tooltip đầy đủ, hoặc cho phép wrap hợp lý).',
            'Nội dung số tiền phải căn phải và hiển thị phân cách hàng nghìn rõ ràng.',
        ],
        verify=[
            'Đăng nhập tài khoản `ketoan` → truy cập `/accounting/invoice-tracking`.',
            'Kiểm tra màn hình ở kích thước 1440×900: Tên khách hàng và số hóa đơn phải nằm trọn vẹn trong cột của mình, không có chữ nào đè lên cột bên cạnh.',
            'Kiểm tra cuộn ngang nếu bảng mở rộng hơn kích thước cửa sổ hiển thị.',
        ],
    ),
    dict(
        num='53',
        slug='deposit-tracker-nut-da-hoan-cuoc-bi-xen-va-be-token-ngay',
        case_id='TC-CCP-03',
        title='Bảng "Theo dõi hoàn cược container" bị xén nút thao tác "Đã hoàn cược" ở mép phải và bẻ gãy token ngày/mã bill',
        status='MỞ — phát hiện qua QA thực tế theo tài liệu các chi phí.pdf (local dev HEAD, 1440px)',
        source=f'Yêu cầu mục 3.c ("Theo dõi hoàn cược") trong tài liệu `các chi phí.pdf`. Màn hình `/accounting/deposit-tracker` (Kế toán `ketoan`).',
        desc=[
            'Bảng "Theo dõi hoàn cược container" có 11 cột. Khi xem ở độ phân giải 1440×900 tiêu chuẩn, mép phải của bảng bị cắt cụt: nút bấm "Đã hoàn cược" ở cột cuối cùng bị mất mép viền và chữ "cược", chỉ còn nhìn thấy "Đã hoàn". Người dùng khó thao tác hoặc tưởng nhầm là nút bị lỗi.',
            'Ngoài ra, các ô hiển thị ngày tháng và mã ngắn không được bảo vệ `white-space: nowrap`: ngày "21/09/26" bị bẻ làm 2 dòng thành "21/09" ở trên và "/26" ở dưới; mã bill "DUE1" bị bẻ thành "DUE" ở trên và số "1" ở dưới.',
        ],
        evidence=[
            (f'{EV}/03_deposit_tracker_clipped_crop.png',
             'Ảnh crop bảng hoàn cược: Nút thao tác bị xén thành "Đã hoàn" mất mép viền phải, token ngày bị gãy dòng "21/09" và "/26".'),
        ],
        facts=[
            'Bảng `.deposit-tracker-table` có 11 cột với tổng chiều rộng nội dung cần thiết ~1280px, nhưng vùng hiển thị trên màn hình 1440px sau khi trừ sidebar và padding chỉ còn ~1130px.',
            'Container bảng thiếu cấu hình cuộn ngang rõ ràng và thiếu `padding-right` an toàn cho cột hành động cuối.',
            'Các cột ngày tháng thiếu rule `white-space: nowrap`, dẫn đến việc ngắt dòng giữa ngày và năm.',
        ],
        ac=[
            'Nút "Đã hoàn cược" và các nút hành động trong cột Thao tác phải hiển thị nguyên vẹn 100%, không bị cắt viền hay che khuất ở bất kỳ độ phân giải nào từ 1280px đến 1920px.',
            'Bổ sung `overflow-x: auto` với indicator cuộn rõ ràng cho bảng hoàn cược container.',
            'Định dạng ngày tháng (`DD/MM/YYYY`) và mã định danh phải có `white-space: nowrap` để tránh bị ngắt dòng mất thẩm mỹ.',
        ],
        verify=[
            'Đăng nhập tài khoản `ketoan` → truy cập `/accounting/deposit-tracker`.',
            'Kiểm tra cột cuối cùng: nút bấm "Đã hoàn cược" phải hiển thị đầy đủ cả chữ và viền bo góc.',
            'Kiểm tra cột Ngày: định dạng ngày tháng hiển thị trên 1 dòng đơn.',
        ],
    ),
    dict(
        num='54',
        slug='phoi-phieu-be-chu-header-containe-r',
        case_id='TC-CCP-04',
        title='Tiêu đề cột "Thông số container" trên bảng Phơi phiếu bị ngắt chữ "CONTAINE" và "R" trên 2 dòng',
        status='MỞ — phát hiện qua QA thực tế theo tài liệu các chi phí.pdf (local dev HEAD, 1440px)',
        source=f'Màn hình `/accounting/phoi-phieu` (Kế toán `ketoan`).',
        desc=[
            'Trên bảng Kiểm soát phơi phiếu (`table.ppc-board`), tiêu đề cột thứ 4 là "Thông số container". Do ô tiêu đề hẹp và áp dụng `text-transform: uppercase` hoặc thiếu quy tắc ngắt từ, từ "CONTAINER" bị ngắt đôi: dòng 2 hiện chữ `CONTAINE`, dòng 3 trơ trọi một chữ `R`.',
            'Giao diện kế toán chuyên nghiệp không được để chữ tiếng Anh / tiếng Việt bị ngắt cụt một chữ cái rơi xuống dòng tiếp theo.',
        ],
        evidence=[
            (f'{EV}/04_phoi_phieu_header_wrap.png',
             'Ảnh crop tiêu đề bảng phơi phiếu: Chữ "CONTAINER" bị bẻ làm 2 dòng với chữ "R" nằm đơn lẻ ở dòng 3.'),
        ],
        facts=[
            'Cột có header `Thông số container`. Bề rộng cột bị co khiến chữ `CONTAINER` không đủ chỗ trên 1 dòng.',
            'Thiếu thuộc tính `word-break: keep-all` hoặc min-width cột phù hợp.',
        ],
        ac=[
            'Tiêu đề cột phải được ngắt từ nguyên vẹn (`word-break: keep-all` hoặc phân bổ độ rộng cột hợp lý).',
            'Tuyệt đối không để một chữ cái đơn lẻ (`R`) rơi xuống dòng riêng biệt.',
        ],
        verify=[
            'Đăng nhập tài khoản `ketoan` → truy cập `/accounting/phoi-phieu`.',
            'Quan sát tiêu đề cột "Thông số container": chữ phải được ngắt từ tự nhiên và ngay ngắn.',
        ],
    ),
]


def render(card: dict) -> str:
    lines = [f"## {card['title']}", '', f"Trạng thái: {card['status']}", '', f"Nguồn: {card['source']}", '', '### Mô tả lỗi', '']
    lines += [f"- {p}" for p in card['desc']]
    lines += ['', '### Bằng chứng', '']
    lines += [f"- {f}" for f in card['facts']]
    for rel, caption in card['evidence']:
        lines += ['', f"![{caption}]({REPO / rel})", '', f"*{caption}*"]
    lines += ['', '### Tiêu chí nghiệm thu', '']
    lines += [f"{i}. {a}" for i, a in enumerate(card['ac'], 1)]
    lines += ['', '### Hướng dẫn xác minh', '']
    lines += [f"{i}. {v}" for i, v in enumerate(card['verify'], 1)]
    lines += ['', '### Case QA', '', f"`{card['case_id']}` — `{SPEC}`. Chạy lại ca này trước khi chuyển card sang QA_PASSED.", '']
    return '\n'.join(lines)


def main() -> None:
    KANBAN.mkdir(parents=True, exist_ok=True)
    for card in CARDS:
        md = render(card)
        name = f"20260922_{card['num']}-{card['slug']}"
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as fh:
            fh.write(md)
            src = fh.name
        out = KANBAN / f"{name}.docx"
        subprocess.run(['pandoc', src, '-o', str(out), '--from', 'markdown', '--resource-path', str(REPO)], check=True)
        print(f'wrote {out.name} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
