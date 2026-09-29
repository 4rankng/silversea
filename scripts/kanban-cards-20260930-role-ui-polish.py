#!/usr/bin/env python3
"""Kanban-PROD TODO tickets for the four-role UI/UX polish wave (cus/dieuvan/
laixe/ops, all device sizes). Evidence: qa/role-sweep/report.json (390/768/1440)
+ qa/2026-09-30_role-sweep_*.log.

Run: python3 scripts/kanban-cards-20260930-role-ui-polish.py
"""
import pathlib
import subprocess
import tempfile

import docx

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path(REPO.joinpath('.kanban-dir').read_text().strip()) / 'TODO'
DATE = '2026-09-30'

CARDS = [
    {
        'num': '213',
        'slug': 'ops-wallet-expense-history-404',
        'title': 'P1: /ops/wallet — mục "Lịch sử chi phí" chết 404 ở mọi chiều rộng',
        'status': 'MỞ — tái lập 2026-09-30 trên dev server, role giaonhan (OPS)',
        'source': 'role-ui-sweep 2026-09-30 (ops 390/768/1440 đều NET 404) + đo lại bằng API và trình duyệt.',
        'desc': [
            '**Hiện tượng:** trang `/ops/wallet` in dòng lỗi "Không tải được lịch sử chi phí. Vui lòng thử lại."; console có `api 404 /api/ops/wallet/expenses`.',
            '**Nguyên nhân:** 6 dòng `expense_accounting_sources` kind=DRIVER trỏ tới `driver_incidental_costs` đã bị xoá (không có FK, quan hệ đa hình). `loadSources()` hydrate MỌI link rồi mới lọc, nên 1 link mồ côi ném `ApiError(404, "Khoản chi lái xe không còn tồn tại.")` và giết cả endpoint.',
            '**Phạm vi:** cùng lớp lỗi này cũng giết mọi lượt đọc khác của `loadExpenseAccountingEntries` (sổ chi phí kế toán), không riêng ví OPS.',
        ],
        'evidence': [
            '`GET /api/ops/wallet/expenses` → 404 `{"error":"Khoản chi lái xe không còn tồn tại."}`; `?status=DRAFT` → 200.',
            'SQL: DRIVER link 152 dòng, 6 mồ côi (`source_id` 391/392/402/409/413/429); OPS 563/0; TRIP 1/0.',
            'Browser (giaonhan, 390px): dòng lỗi render thật trong DOM.',
        ],
        'accept': [
            '1. `/ops/wallet` hết dòng lỗi; mục lịch sử chi phí render ở 390/768/1440.',
            '2. API trả 200 với dữ liệu thật của giaonhan.',
            '3. 6 link mồ côi được dọn ở DB local.',
            '4. Thêm test đỏ-trước: link có source đã mất không làm hỏng lượt đọc danh sách.',
            '5. `pnpm vitest run` + `cd backend && pnpm test` xanh phần liên quan.',
        ],
        'note': [
            'Sửa ở tầng đọc chung, không vá riêng ví OPS. Câu hỏi mở (không tự quyết): nguồn nào xoá `driver_incidental_costs` mà không void link — cần một card riêng cho đường ghi.',
        ],
    },
    {
        'num': '214',
        'slug': 'cus-shipments-debit-quotation-403',
        'title': 'P2: /shipments-debit (CUS) gọi API mình bị cấm — 403 và mất cột phí chuyên dụng',
        'status': 'MỞ — tái lập 2026-09-30 (sweep cus 768: `api 403 /api/quotations/fees/active?customerId=5`)',
        'source': 'role-ui-sweep 2026-09-30 + đọc mã `useActiveQuotationFees` / `dedicatedColumns`.',
        'desc': [
            '`ShipmentDebitWorkspace` gọi `/api/quotations/fees/active` cho mọi vai trò; endpoint này nằm sau `casbinAuthz(\'config\')` nên CUS bị 403.',
            'Hệ quả UI: `feeCatalog` rỗng → `dedicatedColumns([])` → bảng Chi hộ mất các cột phí chuyên dụng của khách.',
        ],
        'evidence': [
            'Sweep cus/768 ghi 403 + console error.',
            '`frontend/src/features/shipments/debit/ShipmentDebitWorkspace.tsx:101`, `ShipmentDebitTables.routing.ts:13`.',
        ],
        'accept': [
            '1. Không còn request 403 trên `/shipments-debit` ở mọi vai trò.',
            '2. Cột phí chuyên dụng hoặc hiển thị đúng, hoặc vắng có chủ ý kèm lý do được PM chấp thuận.',
        ],
        'note': [
            'CẦN THÔNG TIN (PM): CUS có được đọc danh mục phí quotation đang hiệu lực không? Nếu có → nới policy; nếu không → chặn gọi ở FE và chốt hình dạng bảng.',
        ],
    },
    {
        'num': '215',
        'slug': 'dispatch-pill-badge-and-unassigned-dup',
        'title': 'P1: lưới điều vận — chip trạng thái là pill 9999px, và "Chưa phân xe" lặp "Chưa điều xe"',
        'status': 'MỞ — đo computed style 2026-09-30 (dieuvan /dispatch-detail 390)',
        'source': 'role-ui-sweep 2026-09-30 + probe computed style trên dev.',
        'desc': [
            '**A. Pill:** `DispatchIssueStatusChip` render Badge Untitled UI `type="pill-color"` — `border-radius: 9999px`, `padding: 2px 8px`. Luật §1 cấm pill/bong bóng trong ô dữ liệu; luật 2026-09-24 đã gom về `StatusText` (text + chấm màu).',
            '**B. Trùng tín hiệu:** ô Điều phối in "Chưa phân xe" (placeholder biển số) rồi ngay dưới là chip "Chưa điều xe" — hai câu gần đồng nghĩa trên một dòng, §1 "một khái niệm, một chỗ".',
        ],
        'evidence': [
            'Computed style: `borderRadius 9999px`, `padding 2px 8px`, `fontSize 11px`, class `rounded-full … text-utility-neutral-700`.',
            '`DispatchIssueStatus.tsx:56,73`; pill còn ở `MasterPlanGrid.tsx:296,298,415` và `DetailedPlanGrid.tsx:326,328`.',
            'Tiền lệ trong repo: `DispatchIssueStatusSummaryChip` đã trả `null` khi UNASSIGNED.',
        ],
        'accept': [
            '1. Trạng thái trong ô dữ liệu là text thường + chấm màu (`StatusText`), không pill.',
            '2. Bản ghi chưa điều xe chỉ còn MỘT tín hiệu "chưa" (chip UNASSIGNED ẩn, như summary chip đang làm).',
            '3. Ảnh 390/768/1440 của lưới điều vận (có dữ liệu + rỗng) kèm theo.',
        ],
        'note': ['Kiểm luôn các pill còn lại trong 2 lưới điều vận.'],
    },
    {
        'num': '216',
        'slug': 'filler-copy-sweep-four-roles',
        'title': 'P2: dọn câu chữ dài dòng/dạy học trong app (4 vai trò)',
        'status': 'MỞ — đo 2026-09-30: 296 chuỗi ≥55 ký tự hiển thị cho người dùng',
        'source': 'Yêu cầu trực tiếp của người dùng 2026-09-30: "avoid long text filler text in the app"; luật §8 "No lecturing copy".',
        'desc': [
            'Nhiều phụ đề/khối mô tả dài 90–211 ký tự giải thích điều người vận hành đã biết.',
            'Ví dụ dài nhất: `/my-earnings` (laixe) "Số chưa thanh toán là số dư sổ lương hiện tại, không phải phép cộng trực tiếp của các dòng phía trên…" (211 ký tự).',
        ],
        'evidence': [
            'Census: 296 chuỗi; 34 chuỗi ≥90 ký tự (`/tmp/copy-census.txt`, lọc `.tsx` không test).',
            'Ví dụ khác: `/ops/wallet` "Chỉ hiển thị các khoản tạm ứng/hoàn ứng của bạn; sổ chỉ đọc."; `DriverEarningsPage.tsx:240`, `TripEditConflictDialog.tsx:38`, `CustomerCreateDialog.tsx:95`.',
        ],
        'accept': [
            '1. Bề mặt của 4 vai trò không còn câu dạy học dài; mỗi chỗ hoặc bỏ, hoặc rút còn một dòng nhãn ngắn.',
            '2. Không mất thông tin trạng thái/lỗi (thông điệp lỗi và cảnh báo giữ nguyên nghĩa).',
            '3. Ảnh trước/sau ở 390 và 1440 cho từng bề mặt bị sửa.',
        ],
        'note': ['Sửa ở tầng primitive nếu cùng một khuôn (PageHeader subtitle, empty-state subtitle).'],
    },
    {
        'num': '217',
        'slug': 'role-sweep-tapfloor-40-not-44',
        'title': 'P2: role-ui-sweep đo sàn chạm 44px trong khi luật là 40px — 24 finding sai',
        'status': 'MỞ — xác nhận 2026-09-30',
        'source': 'Đọc mã sau lượt sweep 2026-09-30; luật 2026-09-27 "component size max 40px" (`--control-max-h`).',
        'desc': [
            '`role-ui-sweep.mjs` đếm `w<44||h<44` là lỗi; luật hiện tại đặt sàn = trần = 40px (`--control-touch-h: var(--control-max-h)`).',
            'Kết quả: 24 dòng "TAP<44" trên báo cáo, trong đó 0 control thật sự dưới 40px — toàn bộ là 40×40 hợp luật.',
        ],
        'evidence': [
            'Lọc lại `qa/role-sweep/report.json`: phần tử dưới 40px = 0.',
            '`frontend/role-ui-sweep.mjs` (probe: `r.width < 44 || r.height < 44`); `mobile-ux-sweep.mjs` cùng ngưỡng; `role-ui-sweep-report.mjs` in "TAP<44".',
        ],
        'accept': [
            '1. Hai sweep đọc sàn từ token/luật 40px và không báo control 40px là lỗi.',
            '2. Báo cáo ghi rõ ngưỡng đang dùng.',
            '3. Sweep lại: số TAP giảm về đúng số control thật sự dưới 40px.',
        ],
        'note': [],
    },
    {
        'num': '218',
        'slug': 'ops-wallet-density',
        'title': 'P2: /ops/wallet thưa — 3 thẻ số dư thành dải, sổ quỹ thành dòng dữ liệu',
        'status': 'MỞ — ảnh 2026-09-30 (giaonhan, 390/1440)',
        'source': 'role-ui-sweep 2026-09-30 + ảnh chụp thật.',
        'desc': [
            'Ba thẻ số dư chiếm ~330px dọc ở 390px cho ba con số; mỗi thẻ còn kèm một câu phụ đề.',
            'Sổ quỹ render mỗi bút toán ~380px với 4 nhãn đứng riêng (Ngày/Diễn giải/Chứng từ + 3 dòng tiền).',
            'Nhà có sẵn primitive `SummaryRail` (dải kẻ, nhãn trái–số phải, không thẻ) và `record-table` — bề mặt này chưa dùng.',
        ],
        'evidence': [
            'Ảnh `qa/role-sweep/ops/ops_wallet-390.png`.',
            '`frontend/src/pages/OpsWalletPage.css` (`.ops-wallet-card*`), `OpsWalletPage.tsx:62-115`.',
        ],
        'accept': [
            '1. Ba số dư gọn trong một dải ở 390/768/1440; không còn thẻ bo góc.',
            '2. Mỗi bút toán sổ quỹ là một dòng dữ liệu dày, không phải thẻ 4 dòng nhãn.',
            '3. Ảnh before/after ở 390/768/1440.',
        ],
        'note': ['Chỉ dùng primitive sẵn có; không tạo biến thể riêng cho trang.'],
    },
]


def build(card):
    doc = docx.Document()
    doc.add_heading(card['title'], level=1)
    doc.add_paragraph(f"Trạng thái: {card['status']}")
    doc.add_paragraph(f"Nguồn: {card['source']}")
    doc.add_heading('Mô tả lỗi', level=2)
    for p in card['desc']:
        doc.add_paragraph(p)
    doc.add_heading('Bằng chứng', level=2)
    for p in card['evidence']:
        doc.add_paragraph(p, style='List Bullet')
    doc.add_heading('Tiêu chí nghiệm thu', level=2)
    for p in card['accept']:
        doc.add_paragraph(p)
    if card['note']:
        doc.add_heading('Ghi chú quy trình', level=2)
        for p in card['note']:
            doc.add_paragraph(p)
    return doc


def main():
    KANBAN.mkdir(parents=True, exist_ok=True)
    for card in CARDS:
        name = f"{DATE.replace('-', '')}_{card['num']}-{card['slug']}.docx"
        target = KANBAN / name
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp) / name
            build(card).save(tmp_path)
            # Word-locked or Drive-synced targets: copy through a fresh read.
            target.write_bytes(tmp_path.read_bytes())
        print(f"wrote {target}")


if __name__ == '__main__':
    main()
