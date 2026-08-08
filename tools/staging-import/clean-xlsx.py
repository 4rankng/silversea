#!/usr/bin/env python3
"""
Clean the source `29.7 - DATA PM.xlsx` for master-data import.

The raw xlsx (Vietnamese spec, written by the customer's planning team) has
data-quality issues that cause the master-data-import to BLOCK rows:

  * THÔNG TIN NCC row 3 (LONG MINH) — the system always blocks an NCC row
    unless it's empty; LONG MINH is already a customer (created by the seed),
    so we move its identity into the THÔNG TIN KH (customer) sheet and clear
    the NCC row.
  * LOẠI HÌNH XE — 4 vehicle rows reference drivers that are not in the
    personnel sheet (LỤC VĂN LÔ, NGUYỄN VĂN THỌ, LÊ QUANG TUYỀN,
    TRẦN VĂN THẮNG); these rows are dropped.
  * LOẠI HÌNH XE R24 has a typo plate `15H-116,24` (comma). Corrected to
    `15H-116.24`. R31 plate `15H - 150.77` has whitespace. Normalized to
    `15H-150.77`. R38 plate has trailing space. Stripped.
  * LOẠI HÌNH XE R43, R45 — these are NOTE rows (instructions about
    vehicle registration), not vehicle records. Dropped.

Output: `qa/2026-08-08_staging-import/29.7-DATA-PM-cleaned.xlsx`
"""
import os
import sys
import shutil
import openpyxl

SRC = '/Users/dev/My Drive/SilverSea/2. Raw_data/29.7 - DATA PM.xlsx'
DST = '/Users/dev/Documents/projects/silversea/qa/2026-08-08_staging-import/29.7-DATA-PM-cleaned.xlsx'


def clean_organization_to_customer(wb):
    """Clear THÔNG TIN NCC and add an ÁNH XẠ KHÁCH HÀNG mapping so the
    master-data-import can link sites to the existing LONG MINH customer
    (created by the seed) without re-creating it (parseTemplateSheet blocks
    any non-empty row in THÔNG TIN KH)."""
    ncc = wb['THÔNG TIN NCC']
    long_minh = {
        'internalCode': ncc.cell(row=3, column=2).value,  # MÃ NỘI BỘ
        'taxCode': ncc.cell(row=3, column=3).value,        # MST
        'name': ncc.cell(row=3, column=4).value,            # TÊN KHÁCH HÀNG
    }
    # Clear the NCC row so the importer sees an empty template (no BLOCKED).
    for col in range(1, 27):
        cell = ncc.cell(row=3, column=col)
        try:
            cell.value = None
        except (AttributeError, TypeError):
            pass
    # Add an ÁNH XẠ KHÁCH HÀNG sheet that maps the LONG MINH internal code
    # to its tax code, so the importer can find the seeded customer when
    # applying the NHÀ MÁY sites.
    if 'ÁNH XẠ KHÁCH HÀNG' in wb.sheetnames:
        del wb['ÁNH XẠ KHÁCH HÀNG']
    ws = wb.create_sheet('ÁNH XẠ KHÁCH HÀNG')
    ws.cell(row=1, column=1).value = 'MÃ NỘI BỘ'
    ws.cell(row=1, column=2).value = 'MST'
    ws.cell(row=1, column=3).value = 'TÊN KHÁCH HÀNG XÁC NHẬN'
    ws.cell(row=2, column=1).value = long_minh['internalCode']
    ws.cell(row=2, column=2).value = long_minh['taxCode']
    ws.cell(row=2, column=3).value = long_minh['name']
    return long_minh


def safe_clear(ws, row, col):
    """Clear a cell value, working around merged-cell read-only attribute."""
    cell = ws.cell(row=row, column=col)
    if hasattr(cell, 'value'):
        try:
            cell.value = None
        except (AttributeError, TypeError):
            # Merged cell — unmerge the range if it touches this cell, then clear.
            merged_ranges = list(ws.merged_cells.ranges)
            for r in merged_ranges:
                if r.min_row <= row <= r.max_row and r.min_col <= col <= r.max_col:
                    ws.unmerge_cells(str(r))
                    break
            ws.cell(row=row, column=col).value = None


def clean_fleet(wb):
    """Fix invalid plates, drop unknown-driver rows, drop note rows."""
    ws = wb['LOẠI HÌNH XE']
    UNKNOWN_DRIVER_ROWS = {16, 20, 31, 38}  # LỤC VĂN LÔ, NGUYỄN VĂN THỌ, LÊ QUANG TUYỀN, TRẦN VĂN THẮNG
    NOTE_ROWS = {43, 45}
    fixed = []
    for rn in range(4, ws.max_row + 1):
        if rn in UNKNOWN_DRIVER_ROWS or rn in NOTE_ROWS:
            for col in range(1, ws.max_column + 1):
                safe_clear(ws, rn, col)
            fixed.append(('drop', rn, None))
            continue
        plate = ws.cell(row=rn, column=2).value
        if plate and isinstance(plate, str):
            new_plate = plate.strip().replace(' ', '').replace(',', '.')
            if new_plate != plate:
                safe_clear(ws, rn, 2)
                ws.cell(row=rn, column=2).value = new_plate
                fixed.append(('plate', rn, f'{plate} -> {new_plate}'))
    return fixed


def main():
    if not os.path.exists(SRC):
        sys.exit(f'source not found: {SRC}')
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    shutil.copy2(SRC, DST)
    wb = openpyxl.load_workbook(DST)
    moved = clean_organization_to_customer(wb)
    fixed = clean_fleet(wb)
    wb.save(DST)
    print(f'Wrote {DST}')
    print(f'  • moved LONG MINH from NCC → KH: taxCode={moved["taxCode"]}, name={moved["name"]}')
    print(f'  • fleet fixes: {len(fixed)} change(s)')
    for kind, rn, note in fixed:
        print(f'      [{kind}] R{rn} {note or ""}')


if __name__ == '__main__':
    main()
