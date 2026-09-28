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
            'Ảnh thật: thanh trạng thái iOS + topbar xanh + `<h1>` lặp + dải lọc 3 hàng chiếm '
            'gần **258px** chiều cao trước khi thẻ bản ghi đầu tiên bắt đầu.',
            'Đo ở 390px: `.shipments-control` = **374×122px** (2 hàng), `.filter-bar` = **374×136px** '
            '(3 hàng). Tổng chrome trên = **258px**.',
            'Đo nội dung dải lọc ở 390px: `filter-bar__search-cell` 300px · `date-range-fields` 348px '
            '· `filter-dropdown` 104px — mỗi hàng đúng một control, không hàng nào ghép được hai.',
            'Đo tab ở 390px (sau khi vá `_160`): dải rộng 374px, `scrollWidth` **439px** → cuộn ngang; '
            '4 ô rộng `87 / 122 / 107 / 113`; trước khi vá ô ĐANG CHỌN bị cắt số bên trong viền '
            '(`countRight` vượt `btnRight` 2–7px trên cả 4 ô).',
            'Đo tiêu đề topbar ở 390px: khối `Đang xem` render "Tổng quan lô hàng" trên **2 dòng** '
            '(w=102px, lines=2); thanh trên cao 56px.',
            'Ở 1440px dải lọc là 2 hàng / 100px và nhóm tab là 1 hàng / 38px — cùng nội dung, nhưng '
            'băng điện thoại tốn gấp rưỡi. Vấn đề là băng điện thoại, KHÔNG phải desktop.',
            'Nguồn chữ trùng: `Topbar.tsx:243-244` in `{pageTitle}` trong khối `Đang xem`; '
            '`ShipmentsPage.tsx:430` in `<h1 className="shipments-control__title">Tổng quan lô hàng</h1>`.',
        ],
        'evidence': [
            ('frontend/qa/tmp-capture/ticket-160-header-390.png',
             'Vùng điều khiển ở 390px sau khi vá: tiêu đề + 2 nút + dải tab cuộn ngang'),
        ],
        'ac': [
            '**Tiêu đề chỉ in MỘT lần.** Chọn một chỗ (khuyến nghị: giữ `<h1>` trong trang vì nó '
            'thuộc về nội dung trang và đã có test pin; bỏ khối `Đang xem` của topbar trên băng '
            'điện thoại). Sau khi sửa, chuỗi "Tổng quan lô hàng" **chỉ xuất hiện 1 lần** trên màn hình.',
            'Tiêu đề topbar ở 390px **1 dòng** (hiện 2 dòng) — hoặc khối đó không còn render ở băng điện thoại.',
            'Dải lọc ở 390px **≤ 2 hàng** (hiện 3 hàng / 136px), và tổng chrome trên (tiêu đề + tab + '
            'lọc) **≤ 170px** (hiện 258px).',
            'Không ô tab nào bị cắt chữ bên trong viền của chính nó ở mọi bề rộng — kể cả khi dải '
            'đang cuộn và ô ĐANG CHỌN nằm sát mép phải.',
            'Nút hành động ở 390px cao **≤ 36px** và tiêu đề + nút dùng chung một nhịp chữ (hiện nút '
            'primary 40px, chữ 12px).',
            'Giữ nguyên luật: dải lọc phải vẫn là `ListFilterBar` dùng chung, không tạo bố cục lọc '
            'riêng cho trang (`docs/design-system/03` §"List filter bars").',
            'Cập nhật `frontend/design-lock/expectations/shipments.mjs` nếu có mục nào đo chiều cao '
            'vùng điều khiển; và thêm một mục đo **số hàng của dải lọc** ở 390px để trần "2 hàng" '
            'được khoá thay vì chỉ ghi trong tài liệu.',
            '`cd frontend && pnpm vitest run` xanh; `pnpm check:ui` xanh; `pnpm design:drift` **không tăng**.',
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
