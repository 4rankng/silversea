#!/usr/bin/env python3
"""Kanban-PROD TODO tickets the 2026-09-30 nine-width mobile sweep surfaced.

Run: python3 scripts/kanban-cards-20260930-mobile-width-findings.py
"""
import pathlib
import tempfile

import docx

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path(REPO.joinpath('.kanban-dir').read_text().strip()) / 'TODO'
DATE = '20260930'

CARDS = [
    {
        'num': '221',
        'slug': 'topbar-month-chip-overflows-360',
        'title': 'P1: chip tháng trên topbar tràn khỏi màn hình ở 360/390 — mọi trang, mọi vai trò',
        'status': 'MỞ — đo 2026-09-30 bằng mobile-ux-sweep (9 chiều rộng)',
        'source': 'mobile-ux-sweep 2026-09-30: 58 finding `offscreen`, 100% trong đó là `.topbar-date*` '
                  '(qa/2026-09-30_role-polish_mobile-ux-sweep.log, findings.json).',
        'desc': [
            '`.topbar-date` (chip tháng) rộng quá khung: đo `l=162 r=392 vw=360` ở 360px và '
            '`l=173 r=402 vw=390` ở 390px — tràn 32px và 12px, trên MỌI route (admin/dieuvan/cus).',
            'Nguyên nhân: phần "01/09 – 30/09" (`__period`) chỉ bị ẩn ở băng điện thoại cho '
            'topbar LÁI XE (`topbar.css` — luật 2026-09-27); topbar chuẩn vẫn giữ nó.',
        ],
        'evidence': [
            'samples: `div.topbar-date l=162 r=392 vw=360`, `button.topbar-date__trigger l=170 r=384`, '
            '`span.topbar-date__period l=289 r=371` — 20 route × 360/390.',
            '`responsive.css` băng ≤640 ẩn `__sep` nhưng giữ `__period`; `topbar.css` ẩn `__period` '
            'chỉ cho `.topbar--driver`.',
        ],
        'accept': [
            '1. Ở 360 và 390, không phần tử `.topbar-date*` nào vượt mép phải.',
            '2. Quy tắc ẩn kỳ nằm ở MỘT chỗ (băng dùng chung), không hai bản.',
            '3. `aria-label` của chip vẫn mang kỳ; chọn tháng vẫn đổi được kỳ.',
            '4. Ảnh 360/390/1440 + sweep lại 0 `offscreen` cho `.topbar-date`.',
        ],
        'note': [],
    },
    {
        'num': '222',
        'slug': 'config-routes-cell-offscreen-360',
        'title': 'P3: /config/routes — ô bảng tràn mép ở 360/390',
        'status': 'MỞ — đo 2026-09-30 (mobile-ux-sweep, admin 360/390)',
        'source': 'mobile-ux-sweep 2026-09-30: `td l=188 r=388 vw=360` và `td l=203 r=403 vw=390` '
                  'trên /config/routes (ngoài 4 vai trò của đợt polish).',
        'desc': ['Một ô `<td>` rộng quá khung ở cả 360 và 390 trên trang danh mục tuyến đường.'],
        'evidence': ['findings.json: route `/config/routes`, width 360 và 390, kind `offscreen`, sel `td`.'],
        'accept': [
            '1. Không ô nào của bảng vượt mép ở 360/390.',
            '2. Ảnh 360/390 kèm theo.',
        ],
        'note': ['Không thuộc 4 vai trò của đợt polish 2026-09-30; nộp lại để không mất dấu.'],
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
        name = f"{DATE}_{card['num']}-{card['slug']}.docx"
        target = KANBAN / name
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp) / name
            build(card).save(tmp_path)
            target.write_bytes(tmp_path.read_bytes())
        print(f'wrote {target}')


if __name__ == '__main__':
    main()
