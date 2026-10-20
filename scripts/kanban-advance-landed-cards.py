#!/usr/bin/env python3
"""Advance three Kanban-PROD cards whose code has landed.

Board hygiene rule this follows: a card's "Trạng thái:" line must agree with
the folder it sits in (scripts/kanban-board-hygiene.py). Each move therefore
rewrites that line AND relocates the file, so the two can never drift.

    python3 scripts/kanban-advance-landed-cards.py           # apply
    python3 scripts/kanban-advance-landed-cards.py --dry-run # report only

Safe-by-construction details:
  * The new file is written to a .tmp sibling and re-opened with python-docx
    before the source is unlinked, so a corrupt write can never destroy the
    only copy of a card.
  * The status paragraph is rewritten as ONE run carrying the full "Trạng
    thái: ..." line. These cards hold exactly one run per status line, so no
    sibling run is orphaned and the kanban-board-hygiene.py label prefix
    always survives.
  * Idempotent: a card already in its destination column is reported and
    skipped, never re-written.
"""
import argparse
import shutil
import sys
from pathlib import Path

import docx

KANBAN = Path(
    (Path(__file__).resolve().parents[1] / '.kanban-dir').read_text().strip()
)

# (card file, source column, destination column, status line, extra body block)
MOVES = [
    # 20/10 QA R24 (build 8bfa2ac7) để lại các thẻ này; verdict + code đã có trên main.
    (
        '201026090100-verifyfail-tokhai-a1-autocopy-thieu.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — PASS, không cần code: verify lại trên build hiện hành đã thấy '
        'auto-copy đủ Tuyến/Nâng/Hạ (fix fd5fbdd9 đã live); cảnh báo 20/10 là staging cũ. '
        'Evidence: testplan/2026-10-20-verifyfail-reverify-current-build.md, '
        'qa/2026-10-20-verifyfail/.',
        'Verify lại có build gate cứng (/api/health.buildHash): staging chạy c7d305ce lúc '
        'bắt đầu, có deploy mới 57d253ff giữa round; bằng chứng cuối lấy trên 57d253ff '
        '(fd5fbdd9 là ancestor). Drive CUS lot 174 DNKM13335: thêm container chỉ nhập '
        'CSQU3054383 → Tuyến ASKEY, Nâng Cảng Đình Vũ, Hạ TC - HICT. Nhà xe "Chờ phân xe" '
        'đúng luật first-non-null vì hàng anh em không có nhà xe.',
    ),
    (
        '201026090200-verifyfail-debit-van-ten-dai.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — PASS, không cần code: verify lại trên build hiện hành (fix 65acec44 '
        'đã live), bảng chốt debit chỉ hiện tên ngắn; cùng hồ sơ verifyfail 20/10.',
        'Evidence: testplan/2026-10-20-verifyfail-reverify-current-build.md (Verdict 2), '
        'qa/2026-10-20-verifyfail/201026090200_ui-0{1,2,3}-*.png + driver log '
        '(RUNG3_DRIVE_PASS). Wire proof: /accounting/debit-board 191 dòng, không tên khách '
        'nào bắt đầu bằng "CÔNG TY". Read-only, không sửa dữ liệu.',
    ),
    (
        '201026092400-fb002-enter-khong-luu-lichtrinh.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — PASS, không cần code: Enter trong hộp thoại Lịch trình đã lưu '
        '(fix 2e1a762b đã live); cảnh báo là build cũ. Lưu ý: surface FCL readonly theo '
        'thiết kế.',
        'Evidence: testplan/2026-10-20-verifyfail-reverify-current-build.md (Verdict 3), '
        'qa/2026-10-20-verifyfail/201026092400_db-side-effect.txt. Nuance: hộp thoại sửa lịch '
        'trình chỉ tồn tại trên dòng LCL — ô lịch trình của FCL readonly theo thiết kế, '
        'không phải hồi quy.',
    ),
    (
        '201026095604b-party-summary-ten-ngan-join.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — FIXED (2072d933): BE thêm row partyId/partyShortName/partyKind, FE '
        'join theo ID, fallback theo tên cho row không resolve được ID; cột Còn nợ giữ '
        'nguyên tiền. Unit 14/14 + rung UI.',
        'Evidence: testplan/2026-10-20-regressions-fb063-fb066-party-summary.md, '
        'qa/2026-10-20-regressions/. Không derive-by-string (cắt "CÔNG TY" khỏi display) vì '
        'sẽ trùng tên và hỏng đối soát.',
    ),
    (
        '201026101500-fb063-header-wrap-regression.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — FIXED (2072d933): bỏ white-space:normal, luật 1 dòng cho mọi nhãn '
        'cột header + cột type 124px / weight 144px; 9/9 nhãn 1 dòng ở 1440/1366/1280.',
        'Evidence: testplan/2026-10-20-regressions-fb063-fb066-party-summary.md, '
        'qa/2026-10-20-regressions/fb063-{before,after}-header-*.png + fb063-label-widths.json.',
    ),
    (
        '201026101600-fb066-quickadd-plate-regression.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — KHÔNG TÁI LẬP (không code): 3/3 surface quick-add PASS ở HEAD; '
        '8bfa2ac7 là ancestor, không commit nào trong 22c9c80b..HEAD chạm quick-add chain. '
        'Nếu QA báo lại cần bằng chứng tái hiện mới.',
        'Evidence: testplan/2026-10-20-regressions-fb063-fb066-party-summary.md (Verdict '
        'TC-201026101600), qa/2026-10-20-regressions-fb066-master/. Ba surface: Gán xe nhóm '
        '(/dispatch), dispatch detail editor (/dispatch-detail), /trips/new.',
    ),
    # FB-093 — hai thẻ QA 19/10 (build 64f81514) đã có code trên main và đã deploy.
    (
        '191026100833-fb093-bks-ao-khong-click-sua.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — FIXED (3651d0d0, deploy a1be51b1): badge "Báo khách (Ảo)" nay là '
        '<button> mở panel editor sửa BKS báo khách ngay trên /accounting/chot-debit; lưu qua '
        'updateLclTruck, lỗi server hiện nguyên văn trong role="alert" và panel KHÔNG đóng.',
        'Cơ chế: badge theo đúng luật billingPlateTrigger của ledger CUS; panel (USearchableField '
        '+ EditActions) đặt ngay dưới FilterBar vì badge nằm trong bảng cuộn ngang nên popover '
        'trong ô sẽ bị cắt. Đã kiểm UI thật: staging build a1be51b1, lô CL5B-L01 — click badge → '
        'editor seed 51G-999.99, sửa rồi Lưu → badge đổi theo giá trị server, không reload trang; '
        'plate 21 ký tự → 400 "Giá trị không hợp lệ" hiện trong role="alert", panel giữ nguyên '
        'giá trị đã gõ. Pin: AccountingDebitClosePage.fb093.test.tsx + AccountingDebitClosePage.'
        'lcl-columns.test.tsx.',
    ),
    (
        '191026100833-fb093-thieu-nut-ghep-cuoc-thu-khach.docx',
        'QA_TESTED',
        'DEV_COMPLETED',
        'DEV_COMPLETED — FIXED (3651d0d0, deploy a1be51b1): nút "Ghép cước thu khách" trên '
        '/accounting/chot-debit, dùng lại đúng MergeRevGroupDialog của Chi phí - Quyết toán; '
        'chỉ bật khi chọn ≥2 lô lẻ CHƯA ghép cước (aria-disabled + DisabledActionTip).',
        'Hai surface còn lại trong thẻ KHÔNG làm, và đây là lý do: /accounting/phoi-phieu là bảng '
        'theo CHUYẾN (PhoiPhieuRow.tripId) và wire của nó không có cargoMode/revGroupId, nên thêm '
        'merge ở đó đòi sửa projection BE và chọn theo chuyến chứ không theo lô; popup "Chọn Debit" '
        'cũng vậy. Nghiệp vụ ghép cước thu thuộc bảng quyết toán theo LÔ, và bảng quyết toán '
        'chính là bảng này. Đã kiểm UI thật: chọn 2 lô lẻ LONG MINH chưa ghép → nút bật, dialog mở '
        'đúng 2 lô (Lô 1 giữ 100% cước vận tải) → "Đã ghép cước thu khách cho 2 lô", Lô 2 hiện '
        '"Ghép cùng Bill <bill Lô 1>" 0₫; tick 1 lô đã ghép → nút aria-disabled, click không mở '
        'dialog. Pin: AccountingDebitClosePage.fb093.test.tsx.',
    ),
]


def set_status(document, status: str) -> bool:
    """Rewrite the card's 'Trạng thái:' line as a single run.

    A card that never had one (the QA templates carry no status line — 162 of
    them on the board) gets one APPENDED rather than being left behind: the
    line is what the hygiene gate compares against the folder, so a card
    without it can never agree with where it sits.
    """
    for paragraph in document.paragraphs:
        if paragraph.text.strip().startswith('Trạng thái:'):
            for run in paragraph.runs[1:]:
                run.text = ''
            line = f'Trạng thái: {status}'
            if paragraph.runs:
                paragraph.runs[0].text = line
            else:
                paragraph.add_run(line)
            return True
    document.add_paragraph(f'Trạng thái: {status}')
    return True


def apply_move(name: str, src_col: str, dest_col: str, status: str, block, dry_run: bool) -> str:
    src = KANBAN / src_col / name
    dest = KANBAN / dest_col / name
    if dest.exists():
        return f'skip (already in {dest_col}): {name}'
    if not src.exists():
        return f'!! not on the board in {src_col}: {name}'

    document = docx.Document(str(src))
    if not set_status(document, status):
        return f'!! no "Trạng thái:" line, left untouched: {name}'
    if block:
        document.add_paragraph(block)

    if dry_run:
        return f'[dry-run] {src_col} -> {dest_col}: {name}'

    # Write beside the destination, prove it re-opens, only then drop the source.
    tmp = dest.with_suffix('.docx.tmp')
    document.save(str(tmp))
    try:
        docx.Document(str(tmp)).paragraphs  # re-open proves the zip is intact
    except Exception as exc:  # noqa: BLE001 — surface whatever python-docx raises
        tmp.unlink(missing_ok=True)
        return f'!! write failed, source kept: {name} ({exc})'
    shutil.move(str(tmp), str(dest))
    src.unlink()
    return f'moved {src_col} -> {dest_col}: {name}'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    print(f'Board: {KANBAN}')
    print(f'Mode:  {"DRY RUN (no writes)" if args.dry_run else "LIVE"}')
    failures = 0
    for move in MOVES:
        result = apply_move(*move, dry_run=args.dry_run)
        print(result)
        if result.startswith('!!'):
            failures += 1
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
