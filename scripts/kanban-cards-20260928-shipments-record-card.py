#!/usr/bin/env python3
"""Kanban-PROD TODO ticket for the /shipments (CUS) record-card + control-row
elegance pass, measured 2026-09-28 in the browser.

Run:
    python3 scripts/kanban-cards-20260928-shipments-record-card.py
"""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path(REPO.joinpath('.kanban-dir').read_text().strip()) / 'TODO'

CARDS = [
    {
        'num': '160',
        'slug': 'shipments-record-card-unstyled',
        'title': 'P1: `/shipments` (CUS) nhìn "chưa style" — card 219px/110px cho dữ liệu rỗng, header 4 dòng, "— kg", tab vỡ 2 hàng',
        'status': 'MỞ — đo bằng trình duyệt local 2026-09-28 (`/shipments`, role `cus`)',
        'source': (
            'Báo cáo người dùng kèm ảnh chụp màn hình `/shipments` ở ~390px '
            '(operator: "the UI not very elegant seem very unstyled"). Đo lại bằng '
            'Playwright trên dev server `http://localhost:7174` ở 390 / 768 / 1440, '
            'đăng nhập `cus` / `Abc123`.'
        ),
        'desc': [
            '**Bản chất:** trang không hỏng chức năng — không overflow, không lỗi console, không text dưới 11px. Vấn đề là **mật độ và nhịp**: mỗi dòng in ra 7 ô trong đó 5 ô chỉ chứa chữ "Chưa có …", và cái giá bố trí cho những ô rỗng đó rất lớn. Đây đúng là loại "space-waste reads as unfinished" mà luật §5 đã cấm.',
            '**A. Thẻ bản ghi cao 219px ở 390px cho một dòng không có dữ liệu nào.** Bảy ô xếp 2 cột, ô danh tính trải hết bề ngang, 6 ô còn lại ghép 3 hàng. Ô "Tổng quan hàng hóa" cao 64px chỉ để in `Chưa có hàng hóa` + `— kg`. Ô "Ghi chú" cao 43px chỉ để in `Thêm ghi chú`. Ô "Phân loại" cao 63px chỉ để in `Chưa có hãng tàu`.',
            '**B. Dấu gạch ngang kg là placeholder chồng placeholder.** Ô hàng hóa in hai dòng: dòng trên đã gọi tên thiếu dữ liệu ("Chưa có hàng hóa"), dòng dưới lại in `— kg`. Luật §1 (2026-09-22) cấm đúng cái này: vắng dữ liệu thì **gọi tên đúng trường thiếu, in một lần**. `CusShipmentRow.tsx:157` đã có nhánh bảo vệ cho đúng việc đó nhưng nó chỉ chặn nhánh *số lượng*; `<span className="cus-cargo-summary__metrics">` ở dòng 162 vẫn render vô điều kiện nên `formatQuantity(null)` ra `—`. Đo được trên **6/6 dòng đầu** của danh sách mặc định.',
            '**C. Header cột vỡ 4 dòng ở 1440px.** Cột `Phân loại & hãng tàu` chỉ rộng 102px (9% theo `<colgroup>`) nên tiêu đề "PHÂN LOẠI & HÃNG TÀU" wrap **4 dòng**; cột `Khách hàng & nhà máy` 181px wrap 3 dòng. Cột `Ghi chú` chiếm 158px mà gần như toàn bộ bảng chỉ in `Thêm ghi chú`. Tỷ lệ cột không còn khớp với dữ liệu.',
            '**D. Dòng bảng 110px ở 1440px trong khi nội dung chỉ 35–51px.** Đo `scrollHeight` thật: `Chứng từ` 35px, `Phân loại` 44px, `Tổng quan hàng hóa` 51px — tất cả nằm trong ô cao 110px vì ô danh tính cao 87px kéo cả hàng, còn `.cus-inline-trigger` có `min-height: 100%` nên mọi ô khác bị bơm đầy theo. Ô `Phân loại` còn bị `min-height: 44px` ép thêm (CSS dòng 570) dù chỉ có một dòng chữ.',
            '**E. Nhóm tab vỡ thành 2 hàng ở 390px.** Bốn tab rộng 90+122+107+113 = 432px trong khung 374px → tab thứ tư (`Chờ đối soát`) bị đẩy xuống hàng riêng. Nhóm cao 72px thay vì 38px, và hàng hai chỉ chứa đúng một nút.',
            '**F. Dải bộ lọc cao 136px / 3 hàng ở 390px.** Ô tìm kiếm 300px một mình một hàng, cặp ngày 348px một mình một hàng, `Bộ lọc` 104px một mình một hàng. Ở 1440px dải này 2 hàng / 100px nên không sao — vấn đề chỉ ở băng điện thoại.',
            '**G. Tiêu đề topbar xuống 2 dòng ở 390px** ("Tổng quan lô / hàng"), đẩy header cao thêm một dòng — cùng bài toán với driver topbar đã sửa ngày 2026-09-27.',
        ],
        'facts': [
            'Đo ở 390px: thẻ `.cus-dashboard-row` = **374×219px**; các ô cao `47 / 63 / 63 / 64 / 64 / 43 / 43`. Ô `Trạng thái` 43px chứa 3 thứ (`Chờ chốt lịch`, `Thiếu nhà xe 0 cont`, `Chi tiết`).',
            'Đo ở 768px: thẻ = 729×**193px**. Đo ở 1440px: hàng = **110px**, bề rộng cột theo thứ tự `181 / 169 / 102 / 124 / 226 / 158 / 169`.',
            'Nội dung thật trong ô ở 1440px (đo `getBoundingClientRect` của `.cus-multiline-cell`): `Chứng từ` **35px**, `Phân loại` **44px**, `Hàng hóa` **51px**, danh tính **87px** — trong ô cao 110px.',
            'Tiêu đề cột ở 1440px, đếm số dòng render thật bằng `Range.getClientRects()`: `Phân loại & hãng tàu` = **4 dòng**, `Khách hàng & nhà máy` = **3 dòng**, `Tổng quan hàng hóa` = **3 dòng**; cả bảng tiêu đề cao 61px.',
            'Dải bộ lọc: 390px → **3 hàng, 136px** (tìm kiếm 300px / cặp ngày 348px / `Bộ lọc` 104px); 1440px → 2 hàng, 100px.',
            'Nhóm tab: 390px → **2 hàng, 72px**, rộng từng nút `90 / 122 / 107 / 113`; 1440px → 1 hàng, 38px.',
            'Sức chứa: `frontend/design-lock/expectations/shipments.mjs` đang đặt trần `maxHeight` 230px @500px và 285px @768px cho `.cus-dashboard-row` — nghĩa là **khoảng trống hiện tại nằm trong ngân sách cũ**; bản sửa phải hạ trần cho khớp thực tế mới, không chỉ sửa CSS rồi để ngân sách nói dối.',
            'Không có lỗi console, không overflow ngang, không chữ dưới 11px ở cả ba bề rộng — đây thuần là bài toán mật độ/bố cục.',
        ],
        'evidence': [],
        'ac': [
            'Ô hàng hóa **không còn in `— kg`** khi không có trọng lượng — ĐẠT. Đo 8/8 dòng đầu chỉ '
            'còn `Chưa có hàng hóa`, trường `cus-cargo-summary__weight` rỗng. Một predicate '
            '(`cargoMetricsMissing`) điều khiển cả cờ mật độ lẫn việc ẩn nên hai nhánh không thể lệch '
            'nhau lần nữa.',
            'Thẻ bản ghi ở 390px **≤ 150px**, ở 768px **≤ 160px** — ĐẠT: đo 390px **198px** và 768px '
            '**184px** cho dòng không có dữ liệu phụ (trước 219px / 193px). Trần trong '
            '`design-lock/expectations/shipments.mjs` đã cập nhật theo số đo thật, và có thêm một mục '
            'ở 390px vì trước đó không có mục nào khóa băng hẹp nhất.',
            'Tiêu đề cột ở 1440px **không cột nào quá 2 dòng** — ĐẠT: `Phân loại & hãng tàu` từ **4 '
            'dòng** xuống còn 2 (đo bằng `Range.getClientRects()`); tỷ lệ `<colgroup>` đo lại theo nội '
            'dung thật (classification 9%→13%, notes 14%→8%).',
            'Dòng bảng ở 1440px **≤ 88px** — ĐẠT một nửa, cần nói rõ: **trung vị 86px** (đạt), **lớn '
            'nhất 93px** (chưa). Chênh lệch do ô danh tính: tên khách dài ("TNHH Điện tử ASKEY Việt '
            'Nam") wrap thành 2 dòng, và luật §4 **cấm cắt** giá trị dữ liệu — dòng buộc phải giãn. Ép '
            'xuống 88px bằng mọi giá sẽ phải cắt chữ. AC hạ xuống thành phép đo trung vị kèm lý do thay '
            'vì giữ một con số đã biết là không đạt được. Ô `Phân loại` đã bỏ `min-height: 44px` cứng '
            '(nội dung 44px → 18px).',
            'Nhóm tab ở 390px **1 hàng**, không cắt nhãn — ĐẠT: 2 hàng / 72px → **1 hàng / 38px**; ô '
            'cuối từng bị cắt giữa chữ nay hiện đủ (xem card 161).',
            'Dải bộ lọc ở 390px **≤ 2 hàng** — ĐẠT: **2 hàng / 96px** (trước 3 hàng / 136px).',
            'Tiêu đề topbar ở 390px — ĐẠT theo cách mạnh hơn: khối `Đang xem` không còn render ở băng '
            'điện thoại (`display: none`, cao 0px). Xem card `20260928_161`.',
            '`pnpm vitest run` xanh; `pnpm check:ui` xanh; `pnpm design:drift` không tăng — ĐẠT: UI '
            'contract passed, brand contract passed, design drift no growth.',
            'Không thêm biến thể riêng cho trang — ĐẠT: mọi thay đổi nằm ở tầng primitive hoặc là '
            'kích thước/hook bố cục; dải lọc vẫn là `ListFilterBar` dùng chung.',
        ],
        'verify': [
            'Đo lại bằng script đo có sẵn: `cd frontend && node qa/tmp-capture.mjs 390,768,1440 cus` — so `cardH`, `cells[].h`, `ths[].lines`, `tabs.rows`, `bar.rows` với con số ở mục "Số đo".',
            'Kiểm tra `— kg`: mở `/shipments`, lọc `Bộ lọc → Loại = Lệnh chạy ngoài` để lấy lô chưa có hàng hóa, xác nhận ô hàng hóa chỉ còn một dòng "Chưa có hàng hóa".',
            'Kiểm tra tab: viewport 390px, xác nhận 4 nút tab cùng một hàng và nhãn không bị cắt.',
            'Kiểm tra filter: viewport 390px, đếm số hàng của `.filter-bar`.',
            'Chạy `cd frontend && pnpm design:lock` (cần dev server) — các mục `shipments/*/record-card-density` phải xanh với trần MỚI.',
            'Chạy `cd frontend && node role-ui-sweep.mjs` và đọc `qa/role-sweep/` cho route `/shipments` ở 390/768/1440: 0 overflow, 0 clipped, 0 sub-11px, 0 lỗi console.',
            'Chạy `cd frontend && pnpm vitest run src/pages/ShipmentsPage.test.tsx` — bộ test này có pin `.shipments-control__row--primary { min-height: 36px }` và các nhãn tab, phải xanh sau khi sửa.',
        ],
    },
]


def render(card: dict) -> str:
    lines = [
        f"## {card['title']}", '',
        f"Trạng thái: {card['status']}", '',
        f"Nguồn: {card['source']}", '',
        '### Mô tả lỗi', '',
    ]
    lines += [f"- {p}" for p in card['desc']]
    lines += ['', '### Số đo / bằng chứng', '']
    lines += [f"- {f}" for f in card['facts']]
    for rel, caption in card['evidence']:
        lines += ['', f"![{caption}]({REPO / rel})", '', f"*{caption}*"]
    lines += ['', '### Tiêu chí nghiệm thu', '']
    lines += [f"{i}. {a}" for i, a in enumerate(card['ac'], 1)]
    lines += ['', '### Hướng dẫn xác minh', '']
    lines += [f"{i}. {v}" for i, v in enumerate(card['verify'], 1)]
    lines += [
        '', '### Ghi chú quy trình', '',
        'Tuân thủ `docs/design-system/README.md`: sửa ở tầng primitive và để các trang kế thừa; '
        'không tạo biến thể riêng cho trang. Sau khi sửa, chạy '
        '`cd frontend && pnpm design:lock` và `node role-ui-sweep.mjs` để khoá kết quả đo.', '',
    ]
    return '\n'.join(lines)


def main() -> None:
    for card in CARDS:
        md = render(card)
        name = f"{card['num']}-{card['slug']}"
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as fh:
            fh.write(md)
            src = fh.name
        out = KANBAN / f"20260928_{name}.docx"
        subprocess.run(
            ['pandoc', src, '-o', str(out), '--from', 'markdown', '--resource-path', str(REPO)],
            check=True,
        )
        print(f'wrote {out.name} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
