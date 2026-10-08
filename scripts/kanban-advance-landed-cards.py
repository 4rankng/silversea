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
    (
        '20261003_317-trung-dau-xe-no-validation.docx',
        'IN_PROGRESS',
        'DEV_COMPLETED',
        'DEV_COMPLETED — fix backend đã land (9d4ca785): assertPlanRowRigAvailable chặn '
        'gán trùng đầu xe theo khung giờ trùng lặp (cả plan row khác lẫn chuyến đã điều '
        'trên cùng một đầu xe) và trả 409 kèm thông báo rõ ràng. AC1 (4xx + thông báo) và '
        'AC3 (không hồi quy khi khung giờ không trùng) đạt. AC2 (UI hiển thị cảnh báo) '
        'CHƯA đạt — commit chỉ chạm backend, chưa có thay đổi frontend.',
        'Ghi chú nghiệm thu (03/10/2026): AC2 còn mở. Cần một thay đổi frontend hiển thị '
        'lỗi 409 ngay tại ô chọn đầu xe ở hộp thoại Chỉnh sửa điều phối, sau đó cắt staging '
        'để QA chấm lại. Repro gốc: PATCH /shipments/dispatch-detail-plan-rows/169/plan và '
        '/189/plan với cùng truckId=11 (xe 15H-209.51) — trước fix cả hai đều 200 OK.',
    ),
    (
        '20261003_316-internal-fleet-productivity-report.docx',
        'DEV_COMPLETED',
        'QA_PASSED',
        'QA_PASSED — đã lên origin/prod (1eac0862, card 20261003_316). Toàn bộ QA gates đã '
        'XANH theo thẻ; chuyển cột để QA staging chấm báo cáo hiệu quả năng suất xe nội bộ '
        'theo ngày và tháng.',
        None,
    ),
    (
        '20261003_318-dispatch-dialog-time-empty-vs-list.docx',
        'DEV_COMPLETED',
        'QA_PASSED',
        'QA_PASSED — đã lên origin/prod (f3a7778f). Cột THỜI GIAN & LỊCH TRÌNH nay ghi rõ '
        'là ngày giao dự phòng thay vì trông như giờ trả hàng đã lưu, còn hộp thoại Chỉnh '
        'sửa điều phối hiển thị đúng Giờ trả hàng. Kèm case '
        'case-QA-2026-10-03-9-dialog-time-empty-vs-list.md.',
        'Liên quan thẻ 305 (ô ngày trong hộp thoại tự nhảy về 01/01/2005): chưa xác nhận '
        'cùng gốc, 305 giữ nguyên ở IN_PROGRESS.',
    ),
]


def set_status(document, status: str) -> bool:
    """Rewrite the card's 'Trạng thái:' line as a single run."""
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
    return False


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
