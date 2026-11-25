/**
 * SIL-1038 (K5.11) — lưới Báo giá: (a) mô tả làm tròn phải khớp luật của khung
 * (chuỗi cứng "Làm tròn từng khoản: từ 5 lên" từng nói dối khi khung để
 * 'Không làm tròn'), mặc định khung mới là 'hàng chục nghìn'; (b) cột Hệ số
 * KHÔNG BAO GIỜ trống — giá trị dây lạ ('' , NaN, null, undefined) vẫn hiện
 * số (dữ liệu có hệ số thì màn hình phải hiện).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteBlock, roundingRuleLabel, heSoDisplay, type RouteBlockData } from './QuotationRouteBlock';
import fixture from './QuotationRouteBlock.state.fixture.json';

const base = fixture.frames[0] as unknown as RouteBlockData;

describe('SIL-1038 — mô tả làm tròn khớp luật khung', () => {
  it('renders the frame rounding rule in the route strip, never a hardcoded claim', () => {
    const none: RouteBlockData = { ...base, surchargeRoundingMode: 'NONE' };
    const { unmount } = render(<RouteBlock block={none} saving={false} onSaveHeSo={() => {}} />);
    expect(screen.getByText(/Làm tròn phụ phí: không làm tròn/)).toBeTruthy();
    expect(screen.queryByText(/từ 5 lên/)).toBeNull();
    unmount();

    const ten: RouteBlockData = { ...base, surchargeRoundingMode: 'TEN_THOUSAND' };
    render(<RouteBlock block={ten} saving={false} onSaveHeSo={() => {}} />);
    expect(screen.getByText(/Làm tròn phụ phí: đến hàng chục nghìn \(từ 5 lên\)/)).toBeTruthy();
    expect(screen.queryByText(/Làm tròn từng khoản/)).toBeNull();
  });

  it('maps every mode to its own label (K5.11: ROUND Excel, nửa ra xa số 0)', () => {
    expect(roundingRuleLabel('THOUSAND')).toBe('Làm tròn phụ phí: đến hàng nghìn (từ 5 lên)');
    expect(roundingRuleLabel('TEN_THOUSAND')).toBe('Làm tròn phụ phí: đến hàng chục nghìn (từ 5 lên)');
    expect(roundingRuleLabel('NONE')).toBe('Làm tròn phụ phí: không làm tròn');
  });
});

describe('SIL-1038 — cột Hệ số không bao giờ trống', () => {
  it('shows a value for every wire state — blank/NaN/null/undefined all fall back to 1', () => {
    expect(heSoDisplay(1)).toBe('1');
    expect(heSoDisplay(1.25)).toBe('1.25');
    expect(heSoDisplay('2.5')).toBe('2.5');
    expect(heSoDisplay('')).toBe('1');
    expect(heSoDisplay('   ')).toBe('1');
    expect(heSoDisplay(null)).toBe('1');
    expect(heSoDisplay(undefined)).toBe('1');
    expect(heSoDisplay(Number.NaN)).toBe('1');
    expect(heSoDisplay('not-a-number')).toBe('1');
    expect(heSoDisplay('1.0000')).toBe('1');
    // 0 là hệ số hợp lệ (tắt dòng phụ phí) — không bao giờ bị nuốt thành 1.
    expect(heSoDisplay(0)).toBe('0');
    expect(heSoDisplay('0')).toBe('0');
  });

  it('the grid input carries the cell value even when the wire sends a blankable heSo', () => {
    const block: RouteBlockData = {
      ...base,
      cells: base.cells.map((cell, index) => (index === 0 ? { ...cell, heSo: '' as unknown as number } : cell)),
    };
    render(<RouteBlock block={block} saving={false} onSaveHeSo={() => {}} />);
    expect(screen.getByLabelText(`Hệ số ${base.routeName} ${base.cells[0].vehicleSizeClassCode}`)).toHaveValue('1');
    expect(screen.getByLabelText(`Hệ số ${base.routeName} ${base.cells[1].vehicleSizeClassCode}`))
      .toHaveValue(String(base.cells[1].heSo));
  });
});
