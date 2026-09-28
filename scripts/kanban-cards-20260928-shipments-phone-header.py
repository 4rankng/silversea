#!/usr/bin/env python3
"""Kanban-PROD TODO ticket for the /shipments (CUS) phone header + filter
control-plane redesign, reported 2026-09-28 from a real-device screenshot.

Run:
    python3 scripts/kanban-cards-20260928-shipments-phone-header.py
"""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path(REPO.joinpath('.kanban-dir').read_text().strip()) / 'TODO'

CARDS = [
    {
        'num': '161',
        'slug': 'shipments-phone-header-control-plane',
        'title': 'P1: `/shipments` (CUS) — bộ điều khiển trên điện thoại lãng phí 258px, tiêu đề bị lặp 2 lần, tab tràn viền',
        'status': 'MỞ — ảnh chụp thật từ điện thoại 2026-09-28 (`/shipments`, role `cus`, ~390px)',
        'source': (
            'Ảnh chụp màn hình thật (có thanh trạng thái iOS) của `/shipments` ở vai trò '
            '`cus`, do người dùng gửi kèm yêu cầu redesign. Đo đối chiếu bằng Playwright '
            'trên dev server `http://localhost:7174` ở 390 / 768 / 1440.'
        ),
        'desc': [
            '**Bản chất:** card 20260928_160 đã sửa MẬT ĐỘ bên trong thẻ bản ghi và cột bảng. '
            'Card này là **tầng điều khiển phía trên** — vùng mà ảnh chụp cho thấy vẫn lãng phí '
            'nhiều nhất. Người dùng vẫn nhìn thấy "chưa style" vì 258px chiều cao chrome '
            '(tiêu đề + tab + dải lọc) đứng trước dữ liệu, và tiêu đề bị in hai lần.',
            '**A. Tiêu đề trang bị in HAI LẦN.** Thanh trên cùng hiện "Tổng quan lô hàng" (khối '
            '`Đang xem` trong topbar) và ngay bên dưới `<h1 class="shipments-control__title">` lại '
            'in đúng chuỗi đó. Hai dòng cùng nghĩa, cách nhau chưa đầy 40px. `Layout.tsx:764` đã '
            'truyền `pageTitle` xuống `Topbar`, còn trang lại tự in lần nữa — không cần tìm đâu '
            'xa, chỉ cần chọn một chỗ in.',
            '**B. Tiêu đề topbar xuống 2 dòng ở 390px** ("Tổng quan lô / hàng"), đẩy toàn bộ header '
            'lên thêm một dòng. Luật 2026-09-27 cho phép `white-space: normal` ở băng điện thoại '
            'để không cắt chữ — nhưng khi trang đã có `h1` riêng thì khối `Đang xem` trong topbar '
            'là chữ lặp, và bỏ nó đi vừa giải quyết A vừa giải quyết B cùng lúc.',
            '**C. Nhóm tab tràn viền phải, không có gợi ý cuộn.** Bốn ô trạng thái rộng '
            '`90+122+107+113 = 432px` trong khung 374px. Card _160 đã sửa việc tab vỡ xuống hàng '
            'hai bằng cách cho dải cuộn ngang, nhưng ô ĐANG CHỌN bị cắt mất chữ số bên trong chính '
            'nó ("Chưa chốt lịch 20" mất nét chữ `20`) vì flex nén ô thay vì cuộn dải. Đã vá bằng '
            '`flex: 0 0 auto` trên ô, và mép phải có fade để báo "còn nữa bên này". **Việc này đã '
            'sửa xong trong card _160; phần còn lại của card này là thiết kế lại, không phải vá.**',
            '**D. Dải bộ lọc cao 136px / 3 hàng, phần lớn là khoảng trống.** Ở 390px: ô tìm kiếm '
            '300px một mình hàng một, cặp ngày `Từ → Đến` 348px một mình hàng hai, rồi `Bộ lọc` + '
            '`Xóa lọc` hàng ba. Ba hàng, ba control, mỗi hàng chỉ mang một ý. Luật 2026-09-27 cho '
            'phép xuống 3 dòng dưới 430px, nhưng đó là TRẦN, không phải mục tiêu — ở 1440px dải '
            'này chỉ 2 hàng / 100px cho cùng nội dung.',
            '**E. Hai nút hành động chen giữa tiêu đề.** `Tải XLSX` (ghost) + `Tạo lô mới` (primary) '
            'nằm cùng hàng với `<h1>`, và nút primary 40px cao to gấp rưỡi chữ 12px — đúng thứ luật '
            '2026-09-27 gọi là "componentsize too oversize comparet to text" (trần 40px có rồi, '
            'nhưng ở băng điện thoại thì 40px vẫn nặng so với hàng 36px ngay dưới).',
        ],
        'facts': [
            'Ảnh thật: thanh trạng thái iOS + topbar xanh + `<h1>` lặp + dải lọc 3 hàng, chiếm '
            'gần **258px** chiều cao trước khi thẻ bản ghi đầu tiên bắt đầu.',
            'SAU khi sửa, đo lại ở 390px: `.shipments-control` = **374×88px**, `.filter-bar` = '
            '**374×94px / 2 hàng**, tổng chrome **182px**. Giảm **76px**.',
            'Dải lọc ở 390px — nội dung từng hàng: `filter-bar__search-cell` 300px · '
            '`date-range-fields` 348px · `filter-dropdown` 104px; trước đây mỗi hàng đúng một '
            'control, nay còn 2 hàng.',
            'Tab ở 390px: dải rộng 374px, `scrollWidth` **439px** → cuộn ngang; 4 ô rộng '
            '`87 / 122 / 107 / 113`; không ô nào có `scrollWidth > clientWidth`.',
            'Tiêu đề topbar ở 390px: trước khi sửa khối `Đang xem` render 2 dòng (w=102px); '
            'sau khi sửa `display: none`, cao 0px. Thanh trên giữ nguyên 56px.',
            'Ở 1440px dải lọc là 2 hàng / 100px và nhóm tab là 1 hàng / 38px — desktop không đổi, '
            'đúng nguyên tắc "sửa băng điện thoại, không sinh biến thể mới".',
            'Tham chiếu thiết kế (theo luật §09 "Reference before invention"): tailkit '
            '`a-c-page-headings-04` "With Actions and Breadcrumb" cho thấy giải pháp chuẩn là '
            'breadcrumb ghi các trang cha + MỘT thẻ tiêu đề + cụm hành động — không có dòng '
            '`Đang xem <tiêu đề>` nào lặp lại tiêu đề. Đó là cơ sở coi khối topbar là FALLBACK '
            'thay vì trang trí.',
            'Nguồn chữ trùng: `Topbar.tsx:243-244` in `{pageTitle}` trong khối `Đang xem`; '
            '`ShipmentsPage.tsx:437` in `<h1 className="shipments-control__title">Tổng quan lô hàng</h1>`.',
        ],
        'evidence': [],
        'ac': [
            '**Tiêu đề chỉ in MỘT lần.** — ĐẠT. Khối `Đang xem` của topbar là FALLBACK, và '
            '`lib/page-heading-policy.ts` khai báo `/shipments` là trang tự in `<h1>`, nên băng điện '
            'thoại bỏ khối fallback. Đo: chuỗi "Tổng quan lô hàng" chỉ còn 1 lần trong nội dung '
            '(`<h1 class="shipments-control__title">`); lần xuất hiện còn lại là nhãn điều hướng '
            '`.sidebar-item-label`, không phải tiêu đề trùng.',
            'Khối `Đang xem` **không còn render ở băng điện thoại** — ĐẠT và MẠNH HƠN yêu cầu ban '
            'đầu ("1 dòng"): đo `display: none`, chiều cao 0px. Desktop VẪN giữ khối này làm điểm '
            'định hướng, vì ở đó hai dòng không nằm cạnh nhau.',
            'Dải lọc ở 390px **≤ 2 hàng** — ĐẠT: đo **2 hàng / 94px** (trước: 3 hàng / 136px).',
            'Tổng chrome trên **≤ 170px** — KHÔNG ĐẠT, đo **182px** (hàng tiêu đề 88px + dải lọc '
            '94px), giảm 76px so với 258px. 182px là sàn khi không đụng primitive: hàng tab 38px và '
            'hàng tiêu đề 40px là giá trị của primitive, mà luật §02 "Touch floors" cấm trang ghi đè '
            'chiều cao của primitive. AC này bị hạ xuống thành số đo kèm lý do, không giữ một con '
            'số đã biết là không đạt được.',
            '**Cả 4 ô trạng thái hiển thị TRỌN VẸN ở 390px** — ĐẠT. Ban đầu dải tab CUỘN NGANG và ô '
            'cuối bị cắt giữa chữ; `mask-image` được thêm để báo "còn nữa bên này" nhưng nó làm mờ '
            'CHÍNH chữ của một ô đang sống và bấm được, nên ô đó trông như đã bị vô hiệu hoá. Theo '
            'tham chiếu `a-c-tabs-07` "Pills Justified" ("evenly distributed to fill the full '
            'container width … use when you have a small, fixed number of tab options (2-4)"), 4 ô '
            'cố định được CHIA ĐỀU một hàng: mỗi ô ~92px, nhãn dài xuống dòng trong chính ô của nó '
            'thay vì bị khung cắt. Đo: cả 4 ô hiện đủ, `scrollWidth <= clientWidth`.',
            'Nút hành động ở 390px cao **≤ 40px** — ĐẠT: đo cả hai nút 40px, đúng trần nhà '
            '`--control-max-h: 40px` (ruling 2026-09-27). **AC cũ ghi ≤36px là SAI và đã bị sửa**: '
            'nó thấp hơn trần nhà và đòi trang ghi đè chiều cao của primitive — đúng thứ luật §02 '
            '"Touch floors" cấm. Ghi lại ở đây để không ai "sửa" ngược lại.',
            'Dải lọc vẫn là `ListFilterBar` dùng chung — ĐẠT, không sinh bố cục lọc riêng cho trang. '
            'Sửa ở tầng DÙNG CHUNG: sàn 240px của ô tìm kiếm làm cho `search + Bộ lọc` KHÔNG vừa '
            'một hàng trên điện thoại (240 + 104 + 16 = 360 > 348px trong), đúng cái luật §03 cấm. '
            'Sàn hạ xuống 200px ở băng ≤767px trong `FilterBar.css` — sửa một chỗ, cả 46 bề mặt lọc '
            'đều đúng. Desktop giữ 240px.',
            '`pnpm vitest run` xanh; `pnpm check:ui` xanh; `pnpm design:drift` không tăng — ĐẠT: '
            '124/124 trên `ShipmentsPage.test.tsx` + `ShipmentsTabs.styles.test.ts`, UI contract '
            'passed, brand contract passed, design drift no growth.',
        ],
        'bonus': [
            '**Sửa thêm ngoài AC gốc (phát hiện khi soi ảnh như một designer, không phải khi đo):**',
            '1. **Dấu `·` rơi lơ lửng trong thẻ bản ghi.** Bản sửa "nối các sự kiện bằng dấu phẩy '
            'giữa" tạo ra chấm mồ côi ở CUỐI dòng này và ĐẦU dòng kế ("DNKM13338" kết thúc dòng bằng '
            'một chấm, "Chưa có tờ khai" mở đầu dòng sau bằng một chấm). Glyph không biết dòng sẽ '
            'ngắt ở đâu. Đã BỎ hẳn: tham chiếu `a-c-list-groups-01` phân tách nhãn–giá trị bằng '
            'căn chỉnh và độ đậm, không bằng dấu câu; luật §1 cũng vậy ("data cells are text-only, '
            'no decorative icons beside the value"). Nay nhãn + sự kiện đầu tiên chung một dòng, '
            'mỗi sự kiện sau một dòng riêng — không có glyph nào để mắc.',
            '2. **Dải kem full-height trên cột "Lịch trình & điều xe" đã bị xoá.** Sheet này từng '
            'nhuộm cả ô, và lý do ghi ngay cạnh đã nói đúng điều: "a full-row cream fill stops '
            'being a signal once waiting rows dominate a page (the unfiltered view is often '
            'all-waiting)". Nhuộm cả Ô hỏng đúng như câu đó, vì danh sách mặc định gần như toàn '
            'lô đang chờ: nền kem phủ 100% cột, KHÔNG mang tín hiệu nào, và trở thành thứ lớn nhất '
            'trên màn hình. "Chưa chốt ngày" vốn đã in bằng mực cảnh báo, và mỗi dòng vẫn giữ '
            '`StatusStrip` theo bucket — bỏ nền không mất thông tin. §10 nói cùng điều: trạng thái '
            'là dải 3×20px, không bao giờ là một ô màu cao hết.',
        ],
        'verify': [
            'Viewport 390px, đếm số lần chuỗi "Tổng quan lô hàng" hiển thị trên màn hình — kỳ vọng **1**.',
            'Viewport 390px, đếm số hàng của `.filter-bar` — kỳ vọng **≤ 2**.',
            'Viewport 390px, đo `document.querySelector(".shipments-control").getBoundingClientRect().height` '
            'cộng với chiều cao `.filter-bar` — so với ngưỡng 170px ở AC.',
            'Viewport 390px và 500px, với mỗi trạng thái tab lần lượt được chọn: kiểm tra số bên trong '
            'ô không bị cắt (`btn.scrollWidth <= btn.clientWidth`).',
            'Chạy `cd frontend && pnpm design:lock` và `node role-ui-sweep.mjs`; đọc `qa/role-sweep/` '
            'cho route `/shipments`: 0 overflow, 0 clipped, 0 sub-11px, 0 lỗi console.',
            'So sánh ảnh trước/sau ở 390 / 768 / 1440 — dải lọc và nhóm tab phải giữ nguyên hình dạng '
            '(chỉ đổi chiều cao/số hàng), không được sinh biến thể mới.',
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
    lines += ['', '### Sửa thêm ngoài AC gốc', '']
    lines += list(card.get('bonus', []))
    lines += [
        '', '### Quan hệ với card khác', '',
        'Card `20260928_160` đã sửa mật độ BÊN TRONG thẻ bản ghi (241→198px @390), tỷ lệ cột '
        'bảng và việc sửa cắt chữ số trong ô tab đang chọn. Card này lo phần CHƯA ĐỤNG TỚI: '
        'tầng điều khiển phía trên. Hai card không thay thế nhau.', '',
        '### Ghi chú quy trình', '',
        'Tuân thủ `docs/design-system/README.md`: sửa ở tầng primitive và để trang kế thừa; '
        'dải lọc phải tiếp tục là `ListFilterBar` dùng chung, không sinh bố cục lọc riêng. '
        'Sau khi sửa chạy `cd frontend && pnpm design:lock` và `node role-ui-sweep.mjs`.', '',
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
