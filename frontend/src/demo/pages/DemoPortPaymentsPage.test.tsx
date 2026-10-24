/**
 * SIL-159 scoped tests — /demo/port-payments (spec 2026.10.24_Demo_layout
 * §PHÂN HỆ 2; consult 24/10: pill ⏳→✅, checkbox w-10, spinner chặn
 * double-click). Pins:
 *  - TC-SIL159-01 queue contents: chỉ phí lift/drop UNC của ngày chọn
 *  - TC-SIL159-02 filters cảng / trạng thái / ngày
 *  - TC-SIL159-03 duyệt từng dòng: spinner → ✅, dòng mờ, double-click blocked
 *  - TC-SIL159-04 duyệt lô ≥2 cùng cảng; trộn cảng → disabled
 *  - TC-SIL159-05 thẻ tài xế sort desc + click lọc (xe ngoài không có thẻ)
 *  - TC-SIL159-06 bảng chi tiết hoàn ứng + trạng thái consult pill
 *  - TC-SIL159-07 shell contract (H1 heading) — demo-shell.routes.test.tsx
 * Xem testplan/2026-10-24-sil159-port-payments.md.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DemoPortPaymentsPage from './DemoPortPaymentsPage';
import { demoTrips } from '../data';

function renderPage() {
  return render(
    <MemoryRouter>
      <DemoPortPaymentsPage />
    </MemoryRouter>,
  );
}

/** Tất cả dòng UNC đang render (không phụ thuộc filter). */
const uncRows = () => screen.getAllByTestId('unc-row');

/** Đếm pill trạng thái — selector span loại option của select lọc trạng thái. */
const pendingPills = () => screen.getAllByText('⏳ Chờ UNC', { selector: 'span' });
const paidPills = () => screen.getAllByText('✅ Đã UNC', { selector: 'span' });

describe('DemoPortPaymentsPage — Tab 2.1 UNC queue (SIL-159)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-01 renders heading + both tabs; queue shows only lift/drop UNC fees of the day', () => {
    renderPage();

    // Shell contract: heading from nav (routes test pins the shell itself).
    expect(screen.getByRole('heading', { level: 1, name: 'Duyệt Chi Cảng & Hoàn Ứng' })).toBeInTheDocument();

    // Tabs exist, UNC tab selected by default.
    expect(screen.getByRole('tab', { name: 'Hàng đợi Duyệt UNC' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sổ hoàn ứng lái xe' })).toHaveAttribute('aria-selected', 'false');

    // Ngày demo mặc định 2026-10-24: 19 dòng lift/drop UNC. Phí surcharge UNC
    // (F-2401c) và phí lái xe chi tiền mặt (F-2402a) KHÔNG được vào hàng đợi.
    const rows = uncRows();
    expect(rows).toHaveLength(19);
    const feeIds = rows.map((r) => r.dataset.feeId);
    expect(feeIds).not.toContain('F-2401c');
    expect(feeIds).not.toContain('F-2402a');
    expect(feeIds).toContain('F-2401a');

    // Trạng thái seed: 11 dòng chờ (pill ⏳ + nút duyệt), 8 dòng đã UNC (pill ✅).
    expect(pendingPills()).toHaveLength(11);
    expect(paidPills()).toHaveLength(8);
    expect(screen.getAllByRole('button', { name: /^Xác nhận Đã UNC/ })).toHaveLength(11);
  });

  it('TC-02 port + status + date filters narrow the queue', () => {
    renderPage();

    // Cảng Cát Lái: 11 dòng, tất cả đều CL (T-2401×2, T-2403×2, T-2404×2,
    // T-2407×2, T-2413×1, T-2414×2).
    fireEvent.click(screen.getByRole('button', { name: /Cảng \/ Bãi/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Cảng Cát Lái' }));
    expect(uncRows()).toHaveLength(11);
    expect(uncRows().every((r) => r.textContent?.includes('Cát Lái'))).toBe(true);

    // Trạng thái Đã UNC tại CL: 4 dòng paid, không còn pill ⏳.
    fireEvent.click(screen.getByRole('button', { name: /Trạng thái/ }));
    fireEvent.click(screen.getByRole('option', { name: '✅ Đã UNC' }));
    expect(uncRows()).toHaveLength(4);
    expect(screen.queryByText('⏳ Chờ UNC', { selector: 'span' })).toBeNull();

    // Ngày mai 25/10 (bỏ lọc cảng/trạng thái): hàng đợi T-2501 (CL ×1) + T-2502 (VICT ×2).
    fireEvent.click(screen.getByRole('button', { name: /Cảng \/ Bãi/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Tất cả cảng / bãi' }));
    fireEvent.click(screen.getByRole('button', { name: /Trạng thái/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Tất cả' }));
    fireEvent.click(screen.getByRole('button', { name: /Ngày thực hiện/ }));
    fireEvent.click(screen.getByRole('option', { name: /Ngày mai · 25\/10\/2026/ }));
    expect(uncRows()).toHaveLength(3);
    expect(pendingPills()).toHaveLength(3);
  });

  it('TC-03 single approve: mini spinner first, then ✅ pill, row dims, double-click blocked', () => {
    renderPage();

    // Dòng drop CL của T-2401 (F-2401b) đang chờ.
    const row = uncRows().find((r) => r.dataset.feeId === 'F-2401b')!;
    const approveBtn = within(row).getByRole('button', { name: /Xác nhận Đã UNC/ });

    // Double-click: cú thứ 2 rơi lúc spinner đang chạy — phải no-op.
    fireEvent.click(approveBtn);
    fireEvent.click(approveBtn);

    // Ô trạng thái: mini spinner TRƯỚC khi badge xanh xuất hiện; nút biến mất.
    expect(within(row).getByTestId('unc-spinner')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Xác nhận Đã UNC/ })).toBeNull();
    expect(within(row).queryByText('✅ Đã UNC')).toBeNull();

    // Sau APPROVE_MS: pill ✅, dòng mờ (opacity-60), đúng MỘT chuyển trạng thái.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(within(row).getByText('✅ Đã UNC')).toBeInTheDocument();
    expect(row.className).toContain('pp-row--paid');
    expect(pendingPills()).toHaveLength(10);
    expect(paidPills()).toHaveLength(9);

    // Dòng đã UNC không còn checkbox / nút duyệt.
    expect(within(row).queryByRole('checkbox')).toBeNull();

    // N-7 review: override "đã duyệt trong phiên" nhân với filter trạng thái —
    // lọc "✅ Đã UNC" phải HIỆN dòng vừa duyệt (F-2401b seed là pending).
    fireEvent.click(screen.getByRole('button', { name: /Trạng thái/ }));
    fireEvent.click(screen.getByRole('option', { name: '✅ Đã UNC' }));
    const paidNow = uncRows().map((r) => r.dataset.feeId);
    expect(paidNow).toContain('F-2401b'); // vừa duyệt
    expect(paidNow).not.toContain('F-2407a'); // seed pending, chưa duyệt
    expect(paidNow).toHaveLength(9); // 8 seed paid + 1 override
  });

  it('TC-04 bulk approve: ≥2 same-port rows enable Duyệt lô; mixed ports disabled with hint', () => {
    renderPage();

    // Chưa chọn gì: không có bulk bar.
    expect(screen.queryByTestId('unc-bulk-bar')).toBeNull();

    // Tick 2 phí CL đang chờ (F-2401b drop T-2401 + F-2403b drop T-2403).
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn phí PHÍ HẠ MSKU 7648291/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn phí PHÍ HẠ TCLU 5583027/ }));

    const bar = screen.getByTestId('unc-bulk-bar');
    expect(bar.textContent).toContain('Đã chọn 2 phí');
    expect(bar.textContent).toContain('Cát Lái');
    expect(within(bar).getByRole('button', { name: 'Duyệt lô (2)' })).not.toBeDisabled();

    // Thêm 1 phí CM (F-2410a lift T-2410 SEGU 6073841) → trộn cảng: disabled + hint.
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn phí PHÍ NÂNG SEGU 6073841/ }));
    expect(within(bar).getByRole('button', { name: 'Duyệt lô (3)' })).toBeDisabled();
    expect(bar.textContent).toContain('UNC gộp chỉ áp dụng cùng một cảng / bãi');

    // Bỏ chọn dòng CM → duyệt lô 2 dòng CL: cả lô ✅, bulk bar tự ẩn.
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn phí PHÍ NÂNG SEGU 6073841/ }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Duyệt lô (2)' }));

    act(() => { vi.advanceTimersByTime(1000); });
    const row2401 = uncRows().find((r) => r.dataset.feeId === 'F-2401b')!;
    const row2403 = uncRows().find((r) => r.dataset.feeId === 'F-2403b')!;
    expect(row2401.textContent).toContain('✅ Đã UNC');
    expect(row2403.textContent).toContain('✅ Đã UNC');
    expect(screen.queryByTestId('unc-bulk-bar')).toBeNull();
  });
});

describe('DemoPortPaymentsPage — Tab 2.2 driver ledger (SIL-159)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-05 driver balance cards sorted desc; click filters detail table; vendor cash excluded', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Sổ hoàn ứng lái xe' }));

    // Thẻ per tài xế đội xe nhà, sort tổng chờ hoàn desc.
    const cards = screen.getAllByTestId('driver-balance-card');
    expect(cards).toHaveLength(5);
    expect(cards[0]!.textContent).toContain('Nguyễn Văn Tâm'); // 1.430.000 ₫ chờ
    expect(cards[0]!.textContent).toContain('1.430.000 ₫');
    expect(cards[0]!.textContent).toContain('51C-138.65');
    expect(cards[1]!.textContent).toContain('Võ Thành Lộc'); // 1.250.000 ₫
    expect(cards[2]!.textContent).toContain('Phạm Quốc Dũng'); // 200.000 ₫
    expect(cards[3]!.textContent).toContain('Đặng Văn Bảy'); // 150.000 ₫
    expect(cards[4]!.textContent).toContain('Trần Văn Hậu'); // 0 ₫ chờ — 1 khoản đã hoàn
    // Xe ngoài (T-2416 HTD Vận Tải, chi tiền mặt) không có thẻ.
    expect(cards.map((c) => c.textContent).join('\n')).not.toContain('HTD');
    expect(screen.getByText(/Tổng đang chờ hoàn:/).textContent).toContain('3.030.000 ₫');

    // Bảng chi tiết: 8 khoản chi hộ của tài xế nhà (kể cả 23/10); xe ngoài loại.
    const allRows = screen.getAllByTestId('ledger-row');
    expect(allRows).toHaveLength(8);
    expect(allRows.map((r) => r.textContent).join('\n')).not.toContain('GSLU 8840236');

    // Click thẻ Tâm → chỉ 2 dòng của Tâm + chip đang lọc.
    fireEvent.click(cards[0]!);
    const filtered = screen.getAllByTestId('ledger-row');
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.textContent?.includes('Nguyễn Văn Tâm'))).toBe(true);
    expect(screen.getByText('Đang lọc:')).toBeInTheDocument();

    // Click lại thẻ → bỏ lọc.
    fireEvent.click(screen.getAllByTestId('driver-balance-card')[0]!);
    expect(screen.getAllByTestId('ledger-row')).toHaveLength(8);
  });

  it('TC-06 detail table columns: date, cont, fee kind badge, amount, receipt thumb, status pill', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Sổ hoàn ứng lái xe' }));

    // Trạng thái theo seed: 5 chờ duyệt + 3 đã hoàn.
    expect(screen.getAllByText('⏳ Chờ duyệt')).toHaveLength(5);
    expect(screen.getAllByText('✅ Đã hoàn')).toHaveLength(3);

    // Loại phí ứng đủ 3 nhãn; mỗi dòng có thumb chứng từ + ngày dd/MM/yyyy.
    expect(screen.getAllByText('PHÍ NÂNG').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PHÍ HẠ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PHỤ PHÍ').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Chứng từ chi hộ/)).toHaveLength(8);
    expect(screen.getAllByText('24/10/2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText('23/10/2026')).toHaveLength(1);
  });
});

describe('DemoPortPaymentsPage — fixture coherence (SIL-159)', () => {
  it('seed dates cover the demo day bar (assumption shared with the queue date filter)', () => {
    const dates = new Set(demoTrips.map((t) => t.date));
    expect(dates.has('2026-10-24')).toBe(true);
    expect(dates.has('2026-10-23')).toBe(true);
    expect(dates.has('2026-10-25')).toBe(true);
  });
});
