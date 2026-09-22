#!/usr/bin/env python3
"""Generate Kanban-PROD TODO tickets for the 2026-09-22 4-role visual UI/UX sweep.

Each card embeds its own screenshots (no local-path references — the board lives
on Google Drive and every card must be self-contained).
"""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path('/Users/dev/Library/CloudStorage/GoogleDrive-frankng.sg@gmail.com/My Drive/SilverSea/Kanban-PROD/TODO')
EV = 'qa/2026-09-22_ui-ux-sweep-4roles'
SPEC = 'testplan/2026-09-22-ui-ux-sweep-4-roles.md'

CARDS = [
    dict(
        num='20',
        slug='phan-trang-noi-giua-bang-che-dong',
        case_id='TC-UI-01',
        title='Thanh phân trang dính nổi giữa bảng, che mất dòng dữ liệu (danh sách lô hàng / chi tiết container)',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local dev HEAD + staging build bf6e659a)',
        source=f'Phiên QA UI/UX 4 vai trò (chứng từ / điều vận / lái xe / OPS), case **TC-UI-01** trong `{SPEC}`. Màn: `/shipments` (vai trò CUS `cus`) và `/shipments-detail` (vai trò CUS `thanhdc` trên staging).',
        desc=[
            'Footer phân trang (`Số dòng mỗi trang · Hiển thị 1–20 trên 445 · chuyển trang`) được gắn `position: sticky; bottom: 0` trong `.shipment-container-ledger`/danh sách, nhưng khung cuộn thật của ứng dụng (`main.app-body`) không trùng đáy màn hình. Kết quả: thanh này **dừng lại giữa bảng**, đè lên dòng dữ liệu bên dưới nó, và các dòng tiếp theo vẫn vẽ tiếp ở dưới thanh đó.',
            'Trên `/shipments` (local HEAD, 20 dòng/trang): dòng thứ 4 bị cắt ngang bởi thanh phân trang, dòng thứ 5 nằm dưới thanh — người dùng đọc sai thứ tự dòng và mất một phần nội dung dòng.',
            'Trên `/shipments-detail` (staging, 7 container): thanh phân trang nằm giữa danh sách, che dòng container phía dưới (ô "Chưa phân nhà xe" bị cắt giữa chữ).',
            'Điều kiện tái hiện: danh sách có ≥ 2 dòng (rule `:has(tbody > tr:nth-child(2))`) và vùng cuộn cao hơn màn hình.',
        ],
        evidence=[
            (f'{EV}/evidence/01-list-footer-overlap-local.png',
             'Local HEAD `/shipments`: thanh phân trang nằm giữa danh sách, cắt ngang dòng C12 CUSTOMER và còn dòng khác ở dưới thanh'),
            (f'{EV}/evidence/01b-staging-footer-overlap.png',
             'Staging `/shipments-detail`: thanh phân trang nằm giữa bảng container, che dòng phía dưới nó'),
        ],
        facts=[
            'CSS hiện tại: `frontend/src/pages/ShipmentContainersPage.css` → `.shipment-container-ledger:has(tbody > tr:nth-child(2)) > .ds-pagination { position: sticky; bottom: 0; margin-bottom: -32px; padding-bottom: calc(12px + 32px); }` (commit `b6eda31c`, có mặt ở HEAD và ở build staging `bf6e659a`).',
            'Ảnh local chụp tại 1440×900, tài khoản `cus`, `/shipments` có 445 lô (20 dòng/trang) ⇒ tái hiện ở HEAD, không phải lỗi riêng của staging.',
            'Ảnh staging chụp tại 1568×1000, tài khoản `thanhdc`, lô có 7 container; DOM: bảng `tableWidth 1272`, không có scroller ngang (`scrollWidth == clientWidth`).',
            'Không có lỗi console/network nào trên hai màn này (probe sweep: `consoleErr=0`, `reqFail=1` = `GET /api/auth/me` bị huỷ khi điều hướng).',
        ],
        ac=[
            'Thanh phân trang không bao giờ được vẽ đè lên vùng dữ liệu: hoặc nằm ngoài luồng ở cuối bảng (static), hoặc dính đúng đáy khung cuộn thật (`main.app-body`) và không dòng nào bị che.',
            'Cuộn tới cuối danh sách phải thấy dòng cuối cùng nguyên vẹn, thứ tự dòng không bị cắt quãng.',
            'Đúng ở 1366 / 1440 / 1680 / 1920 và ở cả bảng 1 dòng (không sticky) lẫn bảng nhiều dòng (sticky) — không dùng `margin-bottom` âm để bù khung ứng dụng.',
            'Regression: một case cho danh sách nhiều dòng ≥ 20 ở 1440×900 khẳng định `pagination.getBoundingClientRect().top >= lastRow.getBoundingClientRect().bottom` khi đã cuộn hết.',
        ],
        verify=[
            'Local (`make dev`): đăng nhập `cus`/Abc123 → mở `/shipments` (445 lô) → cuộn giữa danh sách: hiện tại thanh phân trang nằm giữa, chồng lên một dòng.',
            'Sau khi sửa: thanh phân trang chỉ nằm ở đáy khung cuộn hoặc cuối bảng, không che dòng nào.',
            'Đối chiếu staging: `thanhdc`/Abc123 → `/shipments-detail` → lô 7 container.',
        ],
    ),
    dict(
        num='21',
        slug='cot-thao-tac-bop-0px-tren-staging',
        case_id='TC-UI-02',
        title='Cột "Thao tác" bị bóp về 0px trên staging: header xếp dọc từng ký tự, nút Thêm/Xóa còn 16px — bản vá 8e21fbdf chưa được cut',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (staging build bf6e659a)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-02** (`{SPEC}`). Ảnh người dùng gửi ngày 22/09/2026 (mũi tên đỏ chỉ vào header "THAO TÁC" bị xếp dọc và ô "Thiếu dữ liệu") chính là trạng thái này.',
        desc=[
            'Trên staging, `/shipments-detail` render cột cuối **rộng 0px**: header "THAO TÁC" bị bẻ thành 7 dòng, mỗi dòng 1 ký tự, tràn ra ngoài mép phải của bảng; các nút trong dòng bị bóp còn 16px ngang ("＋ Thêm" = 16×89, "Xóa" = 16×57) nên chữ trong nút cũng xếp dọc và không thể bấm.',
            'Nguyên nhân đã được xác định và đã sửa ở HEAD: `colgroup` có 8 cột cộng đủ 100% mà thiếu rule cho cột thứ 9, nên `table-layout: fixed` cho cột "Thao tác" 0px từ ~1366px trở lên. Bản vá `8e21fbdf` (22/09 12:34) thêm `.shipment-container-ledger__col--actions { width: 7%; }`.',
            'Build staging hiện tại `bf6e659a` (22/09 08:55) **không chứa** `8e21fbdf` (`git merge-base --is-ancestor 8e21fbdf bf6e659a` → false). Vì vậy lỗi vẫn còn nguyên trên môi trường người dùng đang xem, dù code đã đúng ở local.',
            'Số đo tại 1568px trên staging: cột "Thao tác" `width = 0`, header 7 dòng, `textW = 10px`; 8 cột còn lại bình thường (140–204px).',
        ],
        evidence=[
            (f'{EV}/evidence/00-user-report-thao-tac.png',
             'Ảnh người dùng gửi 22/09/2026 (mũi tên đỏ): header "THAO TÁC" xếp dọc từng ký tự ở mép phải bảng, cùng ô "TRẠNG THÁI" mang badge "Thiếu dữ liệu" — chính là trạng thái dưới đây'),
            (f'{EV}/evidence/02-thao-tac-column-staging.png',
             'Staging 1568px: cột cuối 0px — header "THAO TÁC" xếp dọc từng ký tự, nút "Thêm/Xóa" bị bóp thành cột chữ dọc ở mép phải bảng'),
            (f'{EV}/staging/staging-shipments-detail-1568.png',
             'Staging `/shipments-detail` toàn màn (1568×1000, tài khoản thanhdc) — trạng thái người dùng chụp lại'),
            (f'{EV}/screens/desktop/cus__shipments-detail.png',
             'Cùng màn trên local HEAD (1440px): cột "Thao tác" 89px, hiển thị đúng — chứng minh bản vá đã có trong code, chỉ thiếu ở build đang phát'),
        ],
        facts=[
            'Staging `GET /api/health` → `buildHash: bf6e659a`; commit `bf6e659a` (22/09 08:55) là cha của `8e21fbdf` (22/09 12:34) — kiểm chứng bằng `git merge-base --is-ancestor`.',
            'Đo staging 1568px: `Thao tác` th = 0px, 7 dòng chữ, text width 10px; nút "＋ Thêm" 16×89, "Xóa" 16×57.',
            'Đo local HEAD: 1440px → `Thao tác` 80px / 2 dòng; 1280px → 84px; 1920px → 114px / 1 dòng. Ở 1024–1100px cột còn 71–89px và **nút "＋ Thêm" bị bẻ 3 dòng (47×57)** — vẫn là lỗi thật, chưa được xử lý.',
            'Ngưỡng nguy hiểm: từ 1101px (mốc `table-layout: fixed`) tới ~1366px cột này chỉ còn 71–89px; dưới 1101px bảng chuyển sang chế độ card.',
        ],
        ac=[
            'Cut staging chứa `8e21fbdf` và xác minh lại `/shipments-detail` ở 1568px: cột "Thao tác" ≥ 88px, header 1–2 dòng, mọi nút ≥ 40px ngang, bấm được bằng chuột thật (`elementFromPoint` trả về đúng nút).',
            'Ở dải 1024–1200px, cột hành động và nút bên trong phải còn đủ chỗ: nhãn nút không được bẻ thành cột chữ dọc.',
            'Thêm rào chắn hồi quy: một test khẳng định tổng `width` các `col` **bằng 100%** và mỗi cột header cao ≤ 2 dòng ở 1366/1440/1568/1680 — để lỗi "cột thứ 9 bị bỏ quên" không tái diễn khi thêm/bớt cột.',
            'Case QA phải chạy trên **bản build staging đã cut**, không chỉ local (lỗi này sống sót đúng vì QA trước chỉ kiểm local).',
        ],
        verify=[
            'Trước: mở https://vantai.tingting.vip/shipments-detail (đăng nhập `thanhdc`/Abc123) ở cửa sổ 1568px → cột cuối bị bóp 0px, header xếp dọc.',
            'Sau khi cut: cùng URL/cùng bề rộng → cột "Thao tác" hiện "＋ Thêm" và "Xóa" trên 1–2 dòng, bấm "Xóa" mở hộp thoại xác nhận.',
            'Kiểm tra build đang phát: `curl -s https://vantai.tingting.vip/api/health` phải trả buildHash có chứa `8e21fbdf` (hoặc commit mới hơn).',
        ],
    ),
    dict(
        num='22',
        slug='bang-chia-cho-cho-cot-rong',
        case_id='TC-UI-03',
        title='Bảng danh mục chia bề rộng cho các cột rỗng 100%, cột nội dung phải bẻ chữ 3–4 dòng',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-03** (`{SPEC}`). Màn: `/config/customers` (CUS `cus`), `/config/routes` (CUS), `/fleet/drivers` + `/fleet/vehicles` (điều vận `dieuvan`).',
        desc=[
            'Các bảng danh mục dùng `table-layout` chia đều bề rộng, không quan tâm cột có dữ liệu hay không. Kết quả là **một nửa bảng là ô trống "—"**, còn cột nội dung thật bị bóp phải bẻ chữ.',
            '`/config/customers` (222 khách hàng): 6/12 cột hiển thị "—" ở **mọi** dòng — `Địa chỉ`, `SĐT liên hệ`, `Kế toán liên hệ`, `SĐT Kế toán`, `Hạn thanh toán chỉ hộ (ngày)`, `Hạn thanh toán cước (ngày)`. Cột `Tên khách hàng` bị bẻ 3–4 dòng.',
            '`/config/routes`: 5/6 cột dữ liệu rỗng hoàn toàn (`Mã tuyến`, `Điểm đóng/trả`, `Về cầu đường`, `Khoảng cách (km)`, `Ghi chú`) — bảng gần như không truyền tải thông tin.',
            '`/fleet/drivers` (71 tài xế): 7/10 cột rỗng (`Mã tài xế`, `Số CCCD`, `GPLX`, `Hạn bằng lái`, `SĐT`, `Ngân hàng nhận tiền`, `Số TK nhận tiền`, `Hình thức lương`); đầu đề `MÃ TÀI XẾ` phải bẻ 2 dòng trong khi cột rỗng bên cạnh chiếm chỗ.',
            '`/fleet/vehicles`: `Nhà xe` và `Rơ-moóc đang nối` rỗng toàn bộ.',
            'Hệ quả: người dùng phải quét mắt qua hàng loạt dấu "—" để tìm dữ liệu thật, và nội dung thật bị cắt/bẻ — đúng cảm nhận "UI lãng phí chỗ" trong báo cáo.',
        ],
        evidence=[
            (f'{EV}/evidence/03a-customers-dead-columns.png',
             '`/config/customers`: 6 cột "—" trên mọi dòng; mã số thuế bị bẻ giữa số (0107654|321, 022136|54)'),
            (f'{EV}/evidence/03b-routes-dead-columns.png',
             '`/config/routes`: 5/6 cột dữ liệu rỗng hoàn toàn'),
            (f'{EV}/evidence/03c-fleet-drivers-dead-columns.png',
             '`/fleet/drivers`: 7/10 cột "—"; header "MÃ TÀI XẾ" bẻ 2 dòng; KPI hiển thị "71người"'),
        ],
        facts=[
            '`probe/desktop/cus__config-customers.json`: 2886 ô dữ liệu / **222 ô trống**; cột `Hạn Thanh Toán Chi hộ (Ngày)` rộng 105.7px mà **222/222 dòng trống**; các cột `Địa chỉ` (66.6px), `Mã KH` (63px), `MST` (79.8px) đều chỉ 1–2 dòng có dữ liệu.',
            '`probe/desktop/cus__config-routes.json`: **4 cột chết** — `Mã Tuyến` 114.4px, `Điểm đóng/trả` 194.5px, `Vé cầu đường` 103px, `Ghi chú` 125.8px, tất cả **185/185 dòng trống**.',
            '`probe/desktop/dieuvan__fleet-drivers.json`: `Hạn bằng lái` 103.2px và `Hình thức lương` 121px đều **71/71 dòng trống**; `probe/desktop/dieuvan__fleet-vehicles.json`: `Nhà xe` 118.4px **19/19 trống**.',
            '`/shipments` (danh sách lô hàng của CUS) cũng vậy: `Chứng từ` 171.6px (20/20 trống), `Phân loại & hãng tàu` 103px, `Lịch trình & điều xe` 228.8px, `Ghi chú` 160.2px — **664px trên tổng 1272px (52%) bề rộng bảng dành cho cột không có dữ liệu**, trong khi tên khách hàng phải bẻ 3 dòng.',
            'Ảnh `/config/routes` cho thấy tiêu đề trang "Tuyến đường & Cự ly" trong khi sidebar và topbar gọi là "Tuyến đường" — ba tên cho một màn.',
        ],
        ac=[
            'Cột **không có dữ liệu ở mọi dòng của tập kết quả đang lọc** phải tự ẩn (hoặc gom vào panel "Thông tin chi tiết" của dòng) thay vì chiếm bề rộng; khi có ≥ 1 dòng có dữ liệu thì cột hiện lại. Ngoại lệ: cột mang thông tin nghiệp vụ bắt buộc (ví dụ `Trở ngại`, `Trạng thái`) vẫn giữ ô nhưng phải thu về bề rộng nội dung, không giữ chỗ lớn.',
            'Bề rộng cột còn lại phải được chia theo nội dung thật (không chia đều): không cột nội dung nào bị bẻ chữ quá 2 dòng với dữ liệu seed, và tổng bề rộng các cột hiển thị vẫn = 100%.',
            'Không bẻ token: mã số thuế / SĐT / biển số / mã lô phải nằm trên một dòng (xem thêm card `20260922_23`).',
            'Regression: test khẳng định bảng danh mục không render `<td>` chỉ chứa "—" cho ≥ 90% số dòng ở cột **không bắt buộc** (ngưỡng cấu hình được), và ảnh chụp 1440px của 4 màn danh mục không còn cột rỗng toàn bộ.',
            'Thống nhất nhãn màn: tiêu đề trang = nhãn sidebar = nhãn topbar.',
        ],
        verify=[
            'Local: `cus`/Abc123 → `/config/customers`, `/config/routes`; `dieuvan`/Abc123 → `/fleet/drivers`, `/fleet/vehicles`.',
            'Hiện tại: hơn nửa bảng là "—". Sau khi sửa: các cột rỗng biến mất, tên khách hàng/tuyến đường không còn bẻ 3–4 dòng.',
        ],
    ),
    dict(
        num='23',
        slug='bang-header-tran-va-token-bi-be',
        case_id='TC-UI-04',
        title='Bảng dữ liệu: header đè lên nhau và token bị bẻ giữa dòng (số container, mã lô, số tiền, MST)',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-04** (`{SPEC}`). Màn chính: `/accounting/invoice-tracking` (CUS `cus`); cùng lỗi trên `/config/customers`, `/fleet/drivers`, `/shipments-detail`.',
        desc=[
            '`/accounting/invoice-tracking` render 13 cột **bằng nhau 98px** với header `white-space: nowrap`. Header dài hơn ô nên chữ tràn sang ô bên cạnh: "Thông tin lô hàng" tràn **+40px** (đọc thành "THÔNG TIN LÔCONTAINER"), "Nhà cung cấp hđ" tràn **+28px** (đọc thành "NHÀ CUNG CẤPHĐTHÔNG TIN HĐ"). Biểu tượng sắp xếp `⇅` nằm chồng lên ký tự cuối.',
            'Các ô dữ liệu dùng `overflow-wrap: anywhere` trong cột 98px nên **bẻ token giữa dòng**: số container `QATU1234569` → `QATU12345` / `69`; mã lô `SHP-2609-00020` → `SHP-2609-` / `00020`; tiền `12.000.000 đ` → `12.000.000` / `đ`; tên khách hàng dài mỗi dòng một chữ.',
            'Cùng lớp lỗi ở nơi khác: `/config/customers` bẻ mã số thuế `0107654321` → `0107654` / `321`, SĐT `02438888888` → `024388` / `88888`; `/fleet/drivers` bẻ mã định danh `1790007586185-jz77mf-10` thành 3 dòng; `/shipments-detail` bẻ `Chưa gán biển` / `số`.',
            'Với màn tài chính, việc bẻ token không chỉ xấu mà còn gây đọc sai số: "12.000.000" rồi "đ" ở dòng dưới dễ bị đọc thành 12 triệu thiếu đơn vị.',
        ],
        evidence=[
            (f'{EV}/evidence/04-invoice-header-overflow.png',
             '`/accounting/invoice-tracking` desktop 1440px: header "THÔNG TIN LÔ" đè "CONTAINER", "NHÀ CUNG CẤP" đè "THÔNG TIN HĐ"; ô bẻ token QATU12345|69, SHP-2609-|00020, 12.000.000|đ'),
            (f'{EV}/evidence/04b-invoice-mobile-vertical-text.png',
             '`/accounting/invoice-tracking` mobile 390px: mọi giá trị xếp dọc từng ký tự (SHP/-26/09-/000/20, "CÔNG TY…" chạy dọc 231px), hàng tiêu đề đè chữ thành một dải'),
            (f'{EV}/evidence/03a-customers-dead-columns.png',
             '`/config/customers`: MST và SĐT bị bẻ giữa số ở cột 80px'),
        ],
        facts=[
            'Đo DOM 1440px (`probe/desktop/cus__invoice-tracking.json`): mỗi `th` đúng 98px; chữ tràn khỏi ô: `Thông tin lô hàng` **+49.6px**, `Nhà cung cấp hđ` **+38.2px**, `Thông tin hđ` +12.3px, `Ngày gửi hđ` +4.1px, `Chênh lệch` +2.3px.',
            'Cặp header đè nhau (đo bằng `Range.getClientRects`): `Thông tin lô hàng` ↔ `Cont` chồng **35.5×14px**; `Nhà cung cấp hđ` ↔ `Thông tin hđ` chồng **26.2×14px**.',
            'Token bị bẻ giữa dòng (cùng probe): `21/09/2026` → `21/09/202|6`; `QATU1234569` → `QATU1234|569`; `SHP-2609-00020` → `SHP-|2609-` + `2609-|00020`; `HD-C18-01` bị bẻ; `12.000.000 đ` tách đơn vị sang dòng khác. Ô dùng `overflow-wrap: anywhere` + `th` không `overflow: hidden`.',
            'Mobile 390px (`probe/mobile/cus__invoice-tracking.json`): bảng chỉ có khung cuộn ngang 374px cho 13 cột ⇒ mỗi ô rộng **24.9–36.9px**; `verticalCharWrap` = 8 phần tử — `21/09/2026` bẻ 4 dòng (21/ | 09/ | 202 | 6), `SHP-2609-00020` bẻ 5 dòng, tên khách hàng cao **231px** xếp dọc từng ký tự.',
            'Số cột 13 = 100%/13 ≈ 7.7% mỗi cột, không có `colgroup` theo nội dung và **không có chế độ card cho mobile** (các bảng khác như `/config/customers`, `/shipments-detail` đều chuyển sang card ở < 1101px).',
            'Test hiện có không phủ: các ô không đặt `overflow: hidden` nên bộ đo "chữ bị cắt" (`scrollWidth > clientWidth`) trả 0 — phải đo bằng `Range.getClientRects` mới thấy (đã bổ sung vào harness sweep).',
        ],
        ac=[
            'Header không bao giờ tràn khỏi ô của nó: hoặc cho phép bẻ dòng theo từ (`overflow-wrap: break-word`) + chiều rộng cột theo nội dung, hoặc rút gọn nhãn — cấm `overflow: visible` + `nowrap` khi ô hẹp hơn nhãn.',
            'Không token nào bị bẻ giữa dòng: số container, mã lô, số hóa đơn, số tiền + đơn vị tiền, MST, SĐT, biển số phải nằm trọn một dòng (`white-space: nowrap` cho token, `tabular-nums` cho số). Nếu cột không đủ chỗ, phải cho cuộn ngang/giãn cột, không bẻ token.',
            'Quy tắc này áp cho mọi bảng: `/accounting/invoice-tracking`, `/config/customers`, `/config/routes`, `/fleet/*`, `/shipments-detail`, `/shipments`, `/dispatch*`.',
            'Mobile ≤ 640px: bảng 13 cột phải chuyển sang chế độ card (như `/config/customers` đang làm) hoặc cho cuộn ngang với bề rộng cột tối thiểu đủ đọc (≥ 88px). **Cấm** mọi trường hợp chữ xếp dọc từng ký tự (`w < 70px` mà `h > 2.2×w`).',
            'Regression mobile: case 390×844 khẳng định không phần tử chữ nào có `width < 70 && height > 2.2 * width` trên 3 màn bảng nhiều cột (`/accounting/invoice-tracking`, `/config/customers`, `/shipments-detail`).',
            'Regression: một test chung duyệt các bảng chính ở 1280/1440/1920, khẳng định (a) không `th` nào có `textWidth > cellWidth`, (b) không cặp `th` nào chồng chữ, (c) không text node nào bị bẻ giữa 2 dòng trong cùng một token (đo bằng `Range.getClientRects`).',
        ],
        verify=[
            'Local: `cus`/Abc123 → `/accounting/invoice-tracking` ở 1440px → nhìn hàng tiêu đề: hiện tại "THÔNG TIN LÔCONTAINER".',
            'Sau khi sửa: mỗi nhãn nằm gọn trong ô; ô Số tiền hiển thị "12.000.000 đ" trên một dòng; ô Cont hiển thị "QATU1234569" trọn vẹn.',
            'Lặp lại ở 1280px và 1920px.',
        ],
    ),
    dict(
        num='24',
        slug='trang-thai-trung-lap-va-doi-nghich',
        case_id='TC-UI-05',
        title='Trạng thái trùng lặp và đối nghịch nhau trong cùng một dòng: "Chờ phân xe" hai lần, "Đã điều xe" + "Thiếu dữ liệu", icon xe tải lặp hai lần',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD + staging)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-05** (`{SPEC}`). Màn: `/shipments-detail` (CUS, cột `Trạng thái` + `Phân xe`) và `/shipments` bản mobile (thẻ lô hàng).',
        desc=[
            'Cột `TRẠNG THÁI` lặp lại đúng thông tin đã có ở cột `PHÂN XE` của cùng dòng: cả hai đều hiện "Chờ phân xe"; cột trạng thái còn gắn thêm badge chung chung "⚠ Thiếu dữ liệu ▾" — không nói thiếu trường nào.',
            'Badge này xuất hiện cả trên dòng có trạng thái "Đã điều xe" và trên dòng đã "Hoàn thành" (ảnh người dùng gửi), tức là trạng thái và cảnh báo mâu thuẫn nhau ở cùng một ô.',
            'Trên thẻ lô hàng mobile, cùng một thẻ hiển thị vừa tín hiệu tích cực "Đã phát lệnh cho tài xế" (xanh) vừa "Chưa chốt ngày" / "Toàn bộ chờ phân xe" (vàng) mà không giải thích quan hệ giữa chúng.',
            'Icon xe tải bị vẽ **hai lần** cạnh nhau ở ô trạng thái mobile: một lần trong chip "Đang chạy", một lần là icon trần chỉ có `title`/`aria-label` — người dùng nhìn không biết icon thứ hai nghĩa gì.',
        ],
        evidence=[
            (f'{EV}/evidence/05a-ledger-status-duplicate.png',
             '`/shipments-detail`: `PHÂN XE` và `TRẠNG THÁI` cùng hiện "Chờ phân xe"; badge "Thiếu dữ liệu" chung chung, xuất hiện cả khi dòng đã điều xe'),
            (f'{EV}/evidence/05b-mobile-card-conflicting-status.png',
             '`/shipments` mobile: chip "Đang chạy" + icon xe tải trần lặp lại; cùng thẻ vừa "Đã phát lệnh cho tài xế" vừa "Toàn bộ chờ phân xe"'),
        ],
        facts=[
            'Nguồn: `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx` — ô `Trạng thái` render nhãn dispatch + badge "Thiếu dữ liệu"; ô `Phân xe` render badge "Chờ phân xe"/"Chưa gán biển số".',
            'Mobile: `frontend/src/features/shipments/cus/CusShipmentRow.tsx` — ô `Trạng thái` render `<WorkflowBadge>` (đã có icon xe tải + nhãn "Đang chạy") rồi tới `<PrimarySignalIcon>` **cùng icon**, chỉ có `title`/`aria-label`, không có chữ.',
            '`vehicleReadinessLabel()` (cusUtils.ts) trả "Toàn bộ chờ phân xe" trong khi `DispatchIssueStatus` trả "Đã phát lệnh cho tài xế" cho cùng lô — hai nguồn sự thật khác nhau cùng hiển thị trên một thẻ.',
            'Ảnh zoom 200% ô trạng thái mobile xác nhận 2 icon giống nhau nằm cạnh nhau.',
        ],
        ac=[
            'Mỗi khái niệm chỉ có **một** chỗ hiển thị: trạng thái điều xe không lặp lại ở cả `Phân xe` và `Trạng thái`; nếu cần, cột `Trạng thái` chỉ hiện nhãn nghiệp vụ cấp lô (Mới tạo / Đang chạy / Hoàn thành / Đã hủy).',
            'Cảnh báo thiếu dữ liệu phải nêu **đúng trường thiếu** ("Thiếu ngày vận chuyển", "Thiếu biển số") và **không được** xuất hiện trên dòng đã đủ dữ liệu; không dùng nhãn chung "Thiếu dữ liệu".',
            'Không icon nào được lặp lại trong cùng một ô; mọi icon mang nghĩa phải có nhãn chữ nhìn thấy được hoặc bị bỏ.',
            'Quan hệ giữa các tín hiệu trên thẻ mobile phải đọc được: nếu "đã phát lệnh cho tài xế" mà vẫn "toàn bộ chờ phân xe", phải hiển thị như một câu giải thích hoặc ẩn tín hiệu mâu thuẫn (kèm quyết định nghiệp vụ của lead nếu là lỗi dữ liệu).',
            'Regression: một case cho mỗi tổ hợp (đủ dữ liệu / thiếu ngày / thiếu biển số / đã điều xe / hoàn thành) khẳng định số badge trong ô trạng thái và nội dung badge.',
        ],
        verify=[
            'Local: `cus`/Abc123 → `/shipments-detail` ở 1440px → dòng container chưa phân xe: đọc cột `PHÂN XE` và `TRẠNG THÁI` (hiện tại trùng "Chờ phân xe").',
            'Local mobile 390px: `cus`/Abc123 → `/shipments` → mở thẻ lô hàng: hiện tại có 2 icon xe tải cạnh nhau trong ô trạng thái.',
        ],
    ),
    dict(
        num='25',
        slug='chu-mo-dat-tuong-phan-thap',
        case_id='TC-UI-06',
        title='Chữ mẫu/giá trị trống gần như vô hình (tương phản 1.88:1) trên mọi màn CUS',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px + 390px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-06** (`{SPEC}`). Màn: `/shipments`, `/shipments-detail`, `/shipments-debit` (vai trò CUS).',
        desc=[
            'Các chuỗi thay thế cho dữ liệu trống ("Chưa có nhà máy", "Chưa có Bill/Booking", "Chưa có tờ khai", "Chưa có hãng tàu", "Chưa có tuyến đường", "Thêm ghi chú") dùng class `.cus-empty` với màu quá nhạt: **tỷ lệ tương phản 1.88:1** trong khi WCAG AA yêu cầu ≥ 4.5:1 cho chữ 11–12px.',
            'Trên nền trắng, người dùng gần như không thấy các dòng này; ảnh chụp ở 100% cho thấy chúng chỉ là những vệt xám mờ, còn ở ảnh mobile thì mất hẳn.',
            'Đây là các thông báo "vì sao ô trống" — nếu không đọc được thì người dùng tưởng dữ liệu bị mất thay vì chưa nhập.',
        ],
        evidence=[
            (f'{EV}/evidence/06-empty-placeholder-contrast.png',
             '`/shipments`: "Chưa có Bill/Book", "Chưa có tờ khai", "Chưa có hãng tàu" là vệt xám rất nhạt (1.88:1)'),
        ],
        facts=[
            'Probe DOM `probe/desktop/cus__shipments.json` → `lowContrast`: `span.cus-empty "Chưa có nhà máy"` ratio **1.88**, `strong.cus-empty "Chưa có Bill/Book"` 1.88, `span.cus-empty "Chưa có tờ khai"` 1.88, `span.cus-classification__shipping-line.cus-empty "Chưa có hãng tàu"` 1.88, `span.cus-empty "Chưa có tuyến đường"` 1.88 (ngưỡng cần 4.5).',
            'Cùng lớp màu xuất hiện trên `/shipments-detail`, `/shipments-debit`, `/recoverable-costs`.',
            'Ngoài ra `div.kpi__meta.kpi__meta--up "Đang quản lý"` = 3.01:1 trên `/config/customers`.',
        ],
        ac=[
            'Mọi chữ hiển thị (kể cả trạng thái trống, nhãn phụ, ghi chú KPI) đạt tối thiểu 4.5:1 với nền của nó; chữ ≥ 18.66px đậm hoặc ≥ 24px đạt ≥ 3:1.',
            'Sửa ở tầng token (biến màu dùng chung cho trạng thái trống), không sửa từng chỗ; cảnh báo trống phải phân biệt được với dữ liệu thật nhưng vẫn đọc được.',
            'Regression: test so màu tính toán (computed color vs background) cho các class hiển thị trạng thái trống và đạt ≥ 4.5:1; nếu có thể, thêm kiểm tra tự động qua axe/jest-axe cho 3 màn chính.',
        ],
        verify=[
            'Local: `cus`/Abc123 → `/shipments` → dòng có ô trống: hiện tại chữ "Chưa có Bill/Book" gần như không đọc được.',
            'Sau khi sửa: đọc rõ các dòng đó trên nền trắng, và trên nền dòng hover/xám vẫn đạt ≥ 4.5:1.',
        ],
    ),
    dict(
        num='26',
        slug='sap-xep-khong-co-chi-bao-doc-duoc',
        case_id='TC-UI-07',
        title='Không có chỉ báo sắp xếp đọc được: ký tự "⇅" tí hon dính vào nhãn, có cột có cột không',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-07** (`{SPEC}`). Màn: `/config/routes`, `/config/customers`, `/fleet/drivers`, `/fleet/vehicles`, `/dispatch-detail`.',
        desc=[
            'Cột sắp xếp được chỉ được đánh dấu bằng ký tự `⇅` cỡ ~10px dán ngay sau nhãn, không có khoảng cách, không có khung. Ở 100% nó đọc như dấu câu lạc vào tiêu đề ("TRẠNG THÁI ⇅" trông như "TRẠNG THÁI !").',
            'Khi nhãn bẻ 2 dòng, ký tự này rơi xuống **dòng thứ hai** nằm lệch dưới nhãn (`/dispatch-detail`: "THỜI GIAN & LỊCH TRÌNH" + `⇅` ở dòng dưới) nên càng rời rạc.',
            'Một số cột không có ký tự này (không sắp xếp được) nhưng không có khác biệt nào khác — người dùng không biết cột nào bấm được.',
            'Không thấy trạng thái "đang sắp xếp theo cột nào / tăng hay giảm" ngoài việc bấm thử.',
        ],
        evidence=[
            (f'{EV}/evidence/07-sort-affordance.png',
             '`/config/routes` phóng 150%: ký tự ⇅ nằm lệch dưới nhãn, cỡ nhỏ, không đọc được là chỉ báo sắp xếp'),
        ],
        facts=[
            'Ảnh phóng 250% `/dispatch-detail`: nhãn "THỜI GIAN & LỊCH TRÌNH" + `⇅` ở dòng thứ hai; "NÂNG HÀNG"/"TRẢ HÀNG" không có ký tự nào.',
            'Component: `SortHeader` (dùng chung) render ký tự sắp xếp trong cùng dòng chữ của `th`.',
            'Bảng `th` dùng `overflow-wrap: anywhere; white-space: normal` nên nhãn dài bẻ dòng và đẩy ký tự xuống.',
        ],
        ac=[
            'Chỉ báo sắp xếp là icon ≥ 12px nằm **cùng dòng nhãn** (không rơi xuống dòng dưới khi nhãn bẻ 2 dòng), có trạng thái rõ: chưa sắp xếp / tăng dần / giảm dần.',
            'Cột không sắp xếp được không hiện chỉ báo; toàn bộ header sắp xếp được phải là `button` với `aria-sort` đúng (đã có `aria-sort` thì giữ).',
            'Header band không được cao quá 2 dòng với mọi nhãn hiện có (xem card `20260922_22`).',
            'Regression: test khẳng định mọi `th` sắp xếp được render icon cùng dòng nhãn (đo `getClientRects` của nhãn và icon cùng `top`) và `aria-sort` phản ánh trạng thái.',
        ],
        verify=[
            'Local: `dieuvan`/Abc123 → `/fleet/drivers` ở 1440px → nhìn hàng tiêu đề: ký tự ⇅ nằm lệch dưới nhãn.',
            'Sau khi sửa: icon nằm cạnh nhãn trên cùng dòng, bấm cột thấy trạng thái tăng/giảm rõ ràng.',
        ],
    ),
    dict(
        num='27',
        slug='pill-va-mau-ngu-nghia-sai',
        case_id='TC-UI-08',
        title='Lạm dụng "pill" cho trạng thái/giá trị trống và dùng màu xanh cho chi phí (màu ngữ nghĩa sai)',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px + 390px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-08** (`{SPEC}`). Màn: `/dispatch-detail` (điều vận), `/ops/orders` + `/ops/wallet` (OPS), `/my-orders` (OPS), `/shipments` mobile (CUS).',
        desc=[
            'Nhiều giá trị/trạng thái được render trong "pill" bo tròn, ngược quy ước trình bày của ứng dụng (workboard dùng chữ + màu, không pill): `Đơn` (phân loại, `/dispatch-detail`), `Chưa có tuyến đường` (giá trị trống lại trông như nút, `/ops/orders`), `Cần xử lý` (trạng thái, `/my-orders`), dấu `–` một mình trong pill xám (`/shipments` mobile).',
            'Pill cho giá trị trống đặc biệt gây hiểu nhầm: "Chưa có tuyến đường" nằm trong khối bo tròn giống hệt một nút bấm được.',
            'Màu ngữ nghĩa dùng sai: `/ops/wallet` hiển thị "Chi phí đã ghi nhận 2.335.800 đ" bằng **màu xanh thành công** trong khi đây là chi phí; hai ô còn lại (số dư, đã trả lại) màu đen. Xanh trong ứng dụng này đang mang nghĩa "đã nhận/hoàn tất".',
        ],
        evidence=[
            (f'{EV}/evidence/08b-pill-classification.png',
             '`/dispatch-detail`: "Đơn" render như pill xám — ngược quy ước, và trùng màu với nút phụ'),
            (f'{EV}/evidence/08a-wallet-cost-green.png',
             '`/ops/wallet`: "Chi phí đã ghi nhận" màu xanh — chi phí bị tô màu của trạng thái thành công'),
        ],
        facts=[
            '`/ops/wallet` đo DOM: ba ô KPI cùng một khối có viền; ô 3 (chi phí) mang class biến thể success nên chữ xanh, hai ô kia chữ đen.',
            '`/ops/orders`: giá trị thiếu được render thành chip có nền (`Chưa có tuyến đường`), trong khi `/shipments-detail` render giá trị thiếu bằng chữ mờ — hai quy ước cho cùng một khái niệm.',
            '`/my-orders` ô `Trạng thái` = pill nền xám + chữ đỏ đậm; bảng cùng trang ở màn khác dùng chữ + chấm màu.',
        ],
        ac=[
            'Giá trị trống và phân loại dùng chữ theo quy ước chung (màu mờ/đậm theo ngữ nghĩa), **không** nền bo tròn; pill chỉ dành cho nhãn trạng thái có ý nghĩa trạng thái và phải thống nhất toàn ứng dụng.',
            'Màu chỉ mã hoá ngữ nghĩa: chi phí/phải trả không dùng token success; xanh = hoàn tất/đã nhận, vàng = cần chú ý, đỏ = lỗi/chặn — áp cho mọi KPI và ô bảng.',
            'Một bảng quy ước duy nhất cho nhãn trạng thái (class dùng chung) để mọi màn hiển thị giống nhau.',
            'Regression: snapshot/rule test khẳng định KPI chi phí không dùng class success; và các trang danh sách không render pill cho giá trị trống.',
        ],
        verify=[
            'Local: `giaonhan`/Abc123 → `/ops/wallet` → đọc 3 ô KPI: hiện tại ô "Chi phí đã ghi nhận" màu xanh.',
            'Local: `dieuvan`/Abc123 → `/dispatch-detail` và `giaonhan` → `/ops/orders`: xem pill "Đơn" và chip "Chưa có tuyến đường".',
        ],
    ),
    dict(
        num='28',
        slug='kpi-dinh-so-va-don-vi',
        case_id='TC-UI-09',
        title='KPI dính số vào đơn vị: "71người", "19xe", "14NCC"',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-09** (`{SPEC}`). Màn: `/fleet/drivers`, `/fleet/vehicles`, `/suppliers` (điều vận).',
        desc=[
            'Component `KPI` render `{value}{unit}` liền nhau không có khoảng cách, nên số và đơn vị dính thành một từ: "71người", "19xe", "14NCC".',
            'Trong khi đó component `Money` (dùng ở ví OPS, bảng kê) hiển thị đúng "13.664.200 đ". Hai primitive khác nhau cho cùng một việc ⇒ lỗi chỉ xuất hiện ở các màn dùng `KPI` trực tiếp.',
            'Lỗi nhỏ nhưng xuất hiện ở mọi đầu trang danh mục, làm giảm độ tin cậy của số liệu.',
        ],
        evidence=[
            (f'{EV}/evidence/09-kpi-unit-glued.png',
             'Phóng 300%: `/fleet/drivers` "71người" và `/suppliers` "14NCC" — không có khoảng cách giữa số và đơn vị'),
        ],
        facts=[
            'Mã nguồn: `frontend/src/components/UI.tsx` → `<div className="kpi__value">{value}{unit && <span className="kpi__value-unit">{unit}</span>}</div>`; `frontend/src/components/KpiCard.css` → `.kpi__value-unit` không có `margin-left`/`gap`.',
            'Chỗ gọi: FleetDriversView (unit="người"), FleetVehiclesView (unit="xe"), SuppliersView (unit="NCC").',
        ],
        ac=[
            'Số và đơn vị luôn cách nhau một khoảng (khoảng trắng hoặc `margin-left: 2–4px`) ở mọi KPI, mọi bề rộng.',
            'Không cần sửa từng chỗ gọi: sửa một lần ở primitive `KPI`/`.kpi__value-unit`.',
            'Regression: test style khẳng định `.kpi__value-unit` có khoảng cách dương với phần số (hoặc ảnh chụp 1440px của 3 màn danh mục).',
        ],
        verify=[
            'Local: `dieuvan`/Abc123 → `/fleet/drivers` → ô "Tổng tài xế": hiện tại "71người". Sau khi sửa: "71 người".',
            'Kiểm tra thêm `/fleet/vehicles` ("19 xe") và `/suppliers` ("14 NCC").',
        ],
    ),
    dict(
        num='29',
        slug='nav-cus-muc-khong-mo-duoc',
        case_id='TC-UI-10',
        title='Sidebar CUS có mục "Theo dõi hoàn cược" nhưng vai trò CUS bị đá về /shipments',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-10** (`{SPEC}`). Vi phạm AUTH-04/AUTH-05 trong `testplan/roles/README.md` §5.',
        desc=[
            'Sidebar của vai trò CUS (Nhân viên Chứng từ) render mục **"Theo dõi hoàn cược"** trong nhóm "Đối soát", nhưng route `/accounting/deposit-tracker` chỉ cho ADMIN/MANAGER/ACCOUNTANT. CUS bấm vào bị chuyển thẳng về `/shipments`.',
            'Điều hướng "chết" kiểu này khiến người dùng tưởng mình thiếu quyền hoặc app lỗi; QA ghi nhận `landed: "/shipments"` khi điều hướng trực tiếp tới `/accounting/deposit-tracker` bằng tài khoản `cus`.',
            'Mục cùng nhóm "Theo dõi hóa đơn" thì mở được (CUS có quyền đọc), nên sự khác biệt không thể đoán trước.',
        ],
        evidence=[
            (f'{EV}/evidence/10-cus-nav-dead-item.png',
             'Sidebar CUS: nhóm "Đối soát" có "Theo dõi hóa đơn" (mở được) và "Theo dõi hoàn cược" (bị đá về /shipments)'),
        ],
        facts=[
            'Nav: `frontend/src/components/Layout.tsx` (case CUS) khai báo `deposit-tracker` → `/accounting/deposit-tracker` **không kèm điều kiện capability**.',
            'Route guard: `frontend/src/App.tsx` → `/accounting/deposit-tracker` chỉ cho `isAdmin || MANAGER || ACCOUNTANT`.',
            'Bằng chứng chạy: probe `probe/desktop/cus__deposit-tracker.json` → `landed: "/shipments"` (yêu cầu `/accounting/deposit-tracker`).',
            'Mục `recoverable-costs` thì đúng: nav ẩn khi thiếu capability `recoverable_costs.read`, và probe cũng cho `landed: "/shipments"` khi vào thẳng URL.',
        ],
        ac=[
            'Mọi mục trong sidebar phải mở được với vai trò đang đăng nhập: hoặc cấp quyền đọc `/accounting/deposit-tracker` cho CUS, hoặc ẩn mục khỏi nav CUS — không để cả hai.',
            'Quy tắc chung: mục nav phải được suy ra từ cùng nguồn quyền với route guard (tránh hai nguồn sự thật).',
            'Regression: một test duyệt toàn bộ mục nav của từng vai trò, khẳng định mỗi đường dẫn không bị chuyển hướng khi đăng nhập bằng vai trò đó.',
        ],
        verify=[
            'Local: `cus`/Abc123 → bấm "Theo dõi hoàn cược" ở sidebar → hiện tại bị đá về "Tổng quan lô hàng".',
            'Sau khi sửa: hoặc mục không còn hiện, hoặc mở đúng màn "Theo dõi hoàn cược".',
        ],
    ),
    dict(
        num='30',
        slug='lai-xe-desktop-trong-va-route-mo-coi',
        case_id='TC-UI-11',
        title='Màn lái xe: trang trống gần hết ở desktop, và route "hai lệnh" không có lối vào',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px + 390px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-11** (`{SPEC}`). Màn: `/my-trips` (lái xe `laixe`) và `/my-trips/two-orders`.',
        desc=[
            '`/my-trips` ở 1440×900 chỉ hiển thị thanh tab và một dòng chữ trống giữa trang, bỏ trống ~75% diện tích; không có minh hoạ, không có nút "Tải lại", không có gợi ý việc cần làm. Trong khi đó phiên bản mobile của cùng màn có bố cục thẻ đầy đủ.',
            'Bộ đếm trên tab hiển thị như số mũ nhỏ (`Lệnh mới ⁰`) chứ không dùng `Badge` như phần còn lại của ứng dụng.',
            'Route `/my-trips/two-orders` (màn "hai lệnh trong ngày") tồn tại và render được, nhưng **không có liên kết nào trong ứng dụng trỏ tới nó** — người dùng không thể mở bằng giao diện; chỉ vào được khi gõ URL.',
        ],
        evidence=[
            (f'{EV}/evidence/11a-driver-desktop-empty.png',
             '`/my-trips` ở 1440×900: tab kéo hết bề rộng, phần nội dung trống gần hết trang, không có CTA'),
            (f'{EV}/evidence/11b-two-orders-orphan-route.png',
             '`/my-trips/two-orders` render bình thường nhưng không có lối vào từ bất kỳ màn nào'),
        ],
        facts=[
            '`frontend/src/App.tsx` khai báo route `/my-trips/two-orders`; grep toàn bộ `frontend/src` chỉ thấy tham chiếu trong file test và chính page đó — không có `Link`/`href` nào trỏ tới.',
            'Nav vai trò DRIVER có 4 mục (`Hành trình`, `Thông báo`, `Thu nhập`, `Kỷ luật`) — không có mục hai lệnh.',
            'Ảnh 1440px cho thấy nội dung chỉ cao ~150px trong khung 900px.',
        ],
        ac=[
            'Màn lái xe trên desktop dùng bố cục có bề rộng tối đa và tận dụng chiều cao: thẻ chuyến đi bố trí nhiều cột hoặc danh sách có khung, trạng thái trống có minh hoạ + hành động (ví dụ "Tải lại") — không còn màn hình trống trải.',
            'Bộ đếm trên tab dùng `Badge` thống nhất với phần còn lại.',
            'Hoặc thêm lối vào hợp lý cho `/my-trips/two-orders` (nút/tab trong "Hành trình" khi tài xế có ≥ 2 lệnh trong ngày), hoặc gỡ route và page — không để màn mồ côi.',
            'Regression: test khẳng định mọi route của vai trò DRIVER đều có ít nhất một đường điều hướng trong UI (nav, tab, hoặc link trong trang).',
        ],
        verify=[
            'Local: `laixe`/Abc123 ở 1440×900 → `/my-trips`: hiện tại trống gần hết trang.',
            'Gõ thẳng `/my-trips/two-orders`: màn render được nhưng không tìm thấy lối vào nào trong sidebar/tab.',
        ],
    ),
    dict(
        num='31',
        slug='empty-state-tu-che-va-form-tao-lo',
        case_id='TC-UI-12',
        title='Trạng thái trống tự chế ở "Chi phí - Quyết toán" và 3 kiểu checkbox/ô bắt buộc khó hiểu ở form tạo lô',
        status='MỞ — phát hiện qua QA UI/UX sweep 2026-09-22 (local HEAD, 1440px)',
        source=f'Phiên QA UI/UX 4 vai trò, case **TC-UI-12** (`{SPEC}`). Màn: `/shipments-debit` và `/shipments/new` (vai trò CUS).',
        desc=[
            '`/shipments-debit` khi chưa chọn khách hàng hiển thị trạng thái trống tự chế (chỉ hai dòng chữ canh giữa), không dùng `EmptyState` chung của design system (có minh hoạ + CTA) như các màn khác; đồng thời nút "Xuất Debit Note" vẫn hiện nổi bật như thể bấm được dù chưa có dữ liệu.',
            '`/shipments/new`: ba kiểu điều khiển chọn khác nhau trên cùng một màn — `Lệnh chạy ngoài` (ô viền ở đầu thẻ), `Có cước container` (ô viền trong lưới trường), `Đóng kết hợp` (checkbox trơn). Người dùng không biết kiểu nào là "tuỳ chọn theo nhóm", kiểu nào là cờ dữ liệu.',
            'Trường `Số Bill/Booking *` được đánh dấu **bắt buộc** nhưng bị `disabled` (mờ) khi chưa chọn `Hình thức xuất nhập khẩu`; không có chú thích nói vì sao không nhập được.',
            'Radio `Hàng nguyên container (Cont)` / `Hàng lẻ` render thành hai khối viền lớn bo tròn (dạng pill), không giống điều khiển chọn của phần còn lại của form.',
        ],
        evidence=[
            (f'{EV}/evidence/12a-debit-empty-state.png',
             '`/shipments-debit`: trạng thái trống tự chế, không minh hoạ/CTA; nút "Xuất Debit Note" vẫn nổi bật khi chưa chọn khách hàng'),
            (f'{EV}/evidence/12b-create-form-checkboxes.png',
             '`/shipments/new`: "Lệnh chạy ngoài" là ô viền ở đầu thẻ; "Số Bill/Booking *" bắt buộc nhưng bị mờ, không giải thích'),
        ],
        facts=[
            '`/shipments-debit` không import `EmptyState` (design system) trong khi `/shipments-detail`, `/shipments` dùng.',
            '`/shipments/new`: `Lệnh chạy ngoài` và `Có cước container` render trong khối có viền; `Đóng kết hợp` là `<input type="checkbox">` trơn — ba class khác nhau cho cùng hành vi.',
            'Ô `Số Bill/Booking *` có `disabled` khi chưa chọn hình thức xuất nhập khẩu; nhãn vẫn kèm dấu `*` bắt buộc.',
        ],
        ac=[
            'Mọi trạng thái trống dùng chung component `EmptyState` (minh hoạ + câu giải thích + hành động khi hợp lệ) và hành động chính chỉ bật khi có dữ liệu hợp lệ.',
            'Form dùng một quy ước duy nhất cho điều khiển chọn: nhóm tuỳ chọn theo bộ dữ liệu, cờ dữ liệu là checkbox cùng kiểu; không dùng ba kiểu trình bày khác nhau.',
            'Trường bắt buộc nhưng tạm khoá phải nêu lý do ngay cạnh nhãn ("chọn Hình thức xuất nhập khẩu trước") thay vì chỉ mờ đi.',
            'Regression: test khẳng định trạng thái trống ở 3 màn CUS dùng cùng component; test form khẳng định chỉ một class điều khiển chọn được dùng trong form tạo lô.',
        ],
        verify=[
            'Local: `cus`/Abc123 → `/shipments-debit`: hiện tại trạng thái trống chỉ có hai dòng chữ.',
            'Local: `cus`/Abc123 → `/shipments/new` (hoặc nút "Tạo lô mới"): đối chiếu ba kiểu điều khiển chọn và trường bắt buộc bị mờ.',
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
    lines += ['', '### Case QA', '', f"`{card['case_id']}` — `{SPEC}` (mục 2). Chạy lại ca này (local + staging sau khi cut) trước khi chuyển card sang QA_PASSED.", '']
    return '\n'.join(lines)


def main() -> None:
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
