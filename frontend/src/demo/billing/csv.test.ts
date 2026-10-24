/**
 * SIL-160: the bảng kê CSV builders produce a real, Excel-readable file
 * body — CRLF, quoted fields, totals row, exact fixture numbers.
 */
import { describe, expect, it } from 'vitest';
import { apSheetFor, arSheetFor } from './aggregations';
import { buildApCsv, buildArCsv } from './csv';

describe('demo billing — AR CSV', () => {
  it('renders header, one line per chuyến and a totals row', () => {
    const csv = buildArCsv(arSheetFor('SAM', '2026-10'));
    const lines = csv.split('\r\n').filter(Boolean);

    expect(lines).toHaveLength(5); // header + 3 chuyến + tổng
    expect(lines[0]).toBe(
      '"Ngày","Số Booking","Số Bill","Số Container","Loại cont","Tuyến (NM–Cảng)","Cước (VND)"',
    );
    expect(lines[1]).toContain('"23/10/2026","MSKU3091775"');
    expect(lines[1]).toContain('"4800000"');
    expect(lines.at(-1)).toBe(
      '"TỔNG CỘNG (3 chuyến)","","","","","","14100000"',
    );
  });

  it('escapes quotes and keeps empty bill cells empty', () => {
    const sheet = arSheetFor('SAM', '2026-10');
    const withQuote = { ...sheet, rows: [{ ...sheet.rows[0], routeText: 'Cát Lái "kẹp" Cát Lái' }] };
    const csv = buildArCsv(withQuote);
    expect(csv).toContain('"Cát Lái ""kẹp"" Cát Lái"');
    // T-2301 has no bill → empty cell between booking and cont.
    expect(csv.split('\r\n')[1]).toContain('"MSKU3091775","","MSKU 3091775"');
  });
});

describe('demo billing — AP CSV', () => {
  it('renders cước / UNC chi hộ / thực trả per chuyến and totals', () => {
    const csv = buildApCsv(apSheetFor('VND-01', '2026-10'));
    const lines = csv.split('\r\n').filter(Boolean);

    expect(lines).toHaveLength(4); // header + 2 chuyến + tổng
    expect(lines[0]).toBe(
      '"Ngày","Chuyến","Số Container","Cước phải trả (VND)","UNC công ty chi hộ (VND)","Thực trả (VND)"',
    );
    expect(lines[1]).toContain('"CH-2410-14","OOLU 6103307","4500000","4000000","500000"');
    expect(lines.at(-1)).toBe('"TỔNG CỘNG (2 chuyến)","","","8100000","5250000","2850000"');
  });
});
