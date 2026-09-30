import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsx = readFileSync(resolve(process.cwd(), 'src/pages/PayableDetailPage.tsx'), 'utf8');

describe('payable detail filter strip (card 20260927_152)', () => {
  it('renders the shared bar with the boxed ledger-type group and the period plane', () => {
    expect(tsx).toContain('<FilterBar');
    expect(tsx).toMatch(/<Tabs\s+variant="boxed" ariaLabel="Lọc loại giao dịch"/);
    expect(tsx).toContain('<PeriodFilter');
  });

  it('drops the page-local chip row and its classes', () => {
    // The `.dd-filters` flex row and its `.dd-filter-chip` buttons were the
    // page-local filter plane: they are replaced by the shared boxed `Tabs`
    // (operator ruling 2026-09-27), so neither class may return here.
    expect(tsx).not.toContain('className="dd-filters"');
    expect(tsx).not.toContain('dd-filter-chip');
  });

  it('keeps every ledger-type label and the sort reset on switch', () => {
    for (const label of ['Tất cả', 'Ghi nhận chi phí', 'Thanh toán công nợ', 'Chi phí nhiên liệu', 'Cước thuê ngoài', 'Điều chỉnh']) {
      expect(tsx).toContain(`label: '${label}'`);
    }
    // Switching the view still resets the column sort (each view has its own
    // header set).
    expect(tsx).toContain('changeLedgerFilter(id as LedgerFilter)');
  });
});
