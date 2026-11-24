import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPhoiPhieuReport = vi.hoisted(() => vi.fn());
const getPhoiPhieuPartyLots = vi.hoisted(() => vi.fn());
const createPhoiPhieuVoucher = vi.hoisted(() => vi.fn());
const listPhoiPhieuStk = vi.hoisted(() => vi.fn());
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuReport, getPhoiPhieuPartyLots, createPhoiPhieuVoucher, listPhoiPhieuStk }));

import { PhoiPhieuReportSection } from './PhoiPhieuControlPage.reports';
import type { PhoiPhieuPartyLot, PhoiPhieuReportRow } from '../../api/phoiPhieuClient';
import { businessDateISO } from '../../lib/format';

const row: PhoiPhieuReportRow = { party: 'KH Alpha', tienNang: 1000, tienHa: 2000, psKhac: 0, tongPhaiThuTra: 3000, daThuTra: 1000, conLai: 2000, ghiChu: '', soLuong: 1, phaiThu: 1000, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null };
const grand: PhoiPhieuReportRow = { party: 'TỔNG CỘNG', tienNang: 1000, tienHa: 2000, psKhac: 0, tongPhaiThuTra: 3000, daThuTra: 1000, conLai: 2000, ghiChu: '', soLuong: 1, phaiThu: 1000, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null };

const lot = (over: Partial<PhoiPhieuPartyLot>): PhoiPhieuPartyLot => ({
  tripId: 1, shipmentId: 11, billOrBooking: 'YMLU1', containerNumber: 'CONT-1', departureDate: '2026-10-05',
  tienNang: 1000, tienHa: 500, psKhac: 0, total: 1500, daThuTra: 0, conLai: 1500,
  entries: [{ sourceId: 7, expectedVersion: 3, amount: 1500, bucket: 'nang' }],
  ...over,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PhoiPhieuReportSection />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPhoiPhieuReport.mockResolvedValue({ rows: [row], grand });
  getPhoiPhieuPartyLots.mockResolvedValue({ items: [] });
  createPhoiPhieuVoucher.mockResolvedValue({ voucherId: 1, code: 'PT-1', total: 1500, entries: 1 });
  listPhoiPhieuStk.mockResolvedValue({ items: [{ id: 5, code: 'ACB', name: 'TK công ty' }] });
});

// Card 191026160000 — "Báo cáo tháng" becomes the Báo cáo thu / trả phơi
// section: its own date range, a PHẢI THU / PHẢI TRẢ tab pair (one table at a
// time), and a party row that drills into the unpaid lots.
describe('Báo cáo thu / trả phơi section', () => {
  it('renders the section title, its own range, and the THU tab first', async () => {
    renderSection();
    // Spec 19/10 (2.2): the heading carries the window — "… — Ngày … – …".
    // KB §10.8.4 (24/11): the house date law — DD/MM/YYYY, never the raw ISO pair.
    expect(screen.getByRole('heading', { name: /^Báo cáo thu \/ trả phơi — Ngày \d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}$/ })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: 'Tổng' })).toBeInTheDocument();
    // Default window = the running month (the surface it replaced was monthly).
    // Derive the expected bounds exactly like the component does — the Vietnam
    // business date — not a UTC `toISOString()` day, which lags it by a day
    // between 00:00 and 07:00 Vietnam time and made this test red every morning.
    const today = businessDateISO();
    const monthStart = `${today.slice(0, 7)}-01`;
    expect(getPhoiPhieuReport).toHaveBeenCalledWith('THU', expect.objectContaining({ dateFrom: monthStart, dateTo: today, scope: undefined }));
    // One direction per surface: the THU table is up, the TRA header is not.
    expect(screen.getByRole('columnheader', { name: 'Phải thu' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Phải trả' })).not.toBeInTheDocument();
  });

  it('switching to PHẢI TRẢ refetches with kind TRA and the nhóm header follows', async () => {
    renderSection();
    await screen.findByRole('columnheader', { name: 'Tổng' });
    fireEvent.click(screen.getByRole('tab', { name: 'Phải trả' }));
    expect(await screen.findByRole('columnheader', { name: 'Phải trả' })).toBeInTheDocument();
    await waitFor(() => expect(getPhoiPhieuReport).toHaveBeenLastCalledWith('TRA', expect.anything()));
    expect(screen.queryByRole('columnheader', { name: 'Phải thu' })).not.toBeInTheDocument();
  });

  it('clicking the party opens the drill-down of its not-yet-paid lots', async () => {
    getPhoiPhieuPartyLots.mockResolvedValue({ items: [
      lot({}),
      lot({ tripId: 2, shipmentId: 12, billOrBooking: 'YMLU2', containerNumber: 'CONT-2', total: 700, conLai: 700, tienNang: 700, tienHa: 0, entries: [{ sourceId: 8, expectedVersion: 1, amount: 700, bucket: 'nang' }] }),
    ] });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'KH Alpha' }));
    expect(await screen.findByRole('dialog', { name: /Lô chưa thanh toán — KH Alpha/ })).toBeInTheDocument();
    expect(getPhoiPhieuPartyLots).toHaveBeenCalledWith('THU', 'KH Alpha', expect.objectContaining({ scope: undefined }));
    // The lot breakdown rides the summary's own families.
    expect(await screen.findByText('YMLU1')).toBeInTheDocument();
    expect(screen.getByText('YMLU2')).toBeInTheDocument();
  });

  it('SIL-878: the labeled Lô chưa thanh toán trigger on the party row opens the same drawer', async () => {
    // QA fail build 32e22c12 — the unlabeled party drill was undiscoverable
    // (page text search 'chưa thanh toán' = 0 matches). The row now carries
    // the drawer's own identity as a visible trigger.
    getPhoiPhieuPartyLots.mockResolvedValue({ items: [lot({})] });
    renderSection();
    const trigger = await screen.findByRole('button', { name: 'Lô chưa thanh toán' });
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: /Lô chưa thanh toán — KH Alpha/ })).toBeInTheDocument();
    expect(getPhoiPhieuPartyLots).toHaveBeenCalledWith('THU', 'KH Alpha', expect.objectContaining({ scope: undefined }));
  });

  it('the drill-down batch bar ticks rows, totals the phiếu, and issues one batch voucher', async () => {
    getPhoiPhieuPartyLots.mockResolvedValue({ items: [
      lot({}),
      lot({ tripId: 2, shipmentId: 12, billOrBooking: 'YMLU2', containerNumber: 'CONT-2', total: 700, conLai: 700, tienNang: 700, tienHa: 0, entries: [{ sourceId: 8, expectedVersion: 1, amount: 700, bucket: 'nang' }] }),
    ] });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'KH Alpha' }));
    const drawer = await screen.findByRole('dialog', { name: /Lô chưa thanh toán — KH Alpha/ });
    // Wait for the lots to land before touching the bar.
    await within(drawer).findByText('YMLU1');
    // The bar starts empty and explains the gate.
    expect(within(drawer).getByRole('region', { name: 'Thanh hành động lập phiếu hàng loạt' })).toHaveTextContent('Chưa chọn lô nào');
    // Tick one row via its selection checkbox → the bar totals THAT phiếu.
    // (react-aria has no Vietnamese strings yet: the fallback label is English.)
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /Select 1|Chọn 1/ }));
    const bar = within(drawer).getByRole('region', { name: 'Thanh hành động lập phiếu hàng loạt' });
    expect(bar).toHaveTextContent('Đã chọn 1 lô');
    expect(bar).toHaveTextContent('1.500');
    // Select-all adds the second lot.
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /Select All|Chọn tất cả/ }));
    expect(bar).toHaveTextContent('Đã chọn 2 lô');
    expect(bar).toHaveTextContent('2.200');
    // Without an STK the phiếu button stays dark, with a reason.
    const issue = within(bar).getByRole('button', { name: /Lập phiếu thu \(2\)/ });
    expect(issue).toBeDisabled();
    fireEvent.click(within(bar).getByRole('button', { name: 'Số tài khoản quỹ (STK)' }));
    fireEvent.click(await screen.findByRole('option', { name: 'ACB - TK công ty' }));
    expect(issue).toBeEnabled();
    fireEvent.click(issue);
    await waitFor(() => expect(createPhoiPhieuVoucher).toHaveBeenCalledTimes(1));
    expect(createPhoiPhieuVoucher).toHaveBeenCalledWith({
      tripIds: [1, 2], direction: 'IN', treasuryAccountId: 5,
    });
    // The drawer stays open and names the issued phiếu.
    expect(await screen.findByText(/Đã lập phiếu PT-1/)).toHaveTextContent('1 khoản, tổng 1.500');
  });
});

// SIL-916 (KB §6.1/§6.2) — the report carries BOTH "Lập phiếu thu" and
// "Lập phiếu chi": the accountant raises a voucher in either direction
// straight from the report. Each button turns the report to the direction it
// names and opens the unpaid-lots worklist for the WHOLE window (every
// party) — the batch variant of the drill-down.
describe('SIL-916 — Lập phiếu thu / Lập phiếu chi ở Báo cáo thu / trả phơi', () => {
  it('offers both directions and opens the batch worklist for the one it names', async () => {
    getPhoiPhieuPartyLots.mockResolvedValue({ items: [
      lot({ tripId: 1, party: 'KH Alpha' }),
      lot({ tripId: 2, shipmentId: 12, billOrBooking: 'YMLU2', containerNumber: 'CONT-2', total: 700, conLai: 700, tienNang: 700, tienHa: 0, party: 'KH Beta', entries: [{ sourceId: 8, expectedVersion: 1, amount: 700, bucket: 'nang' }] }),
    ] });
    renderSection();
    // The visible label is the KB's "Lập phiếu thu" / "Lập phiếu chi"; the
    // accessible name adds the section, because the board strip above carries
    // its own "Lập phiếu chi" (a different action on a different scope).
    expect(screen.getByRole('button', { name: 'Lập phiếu thu — báo cáo thu / trả phơi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lập phiếu chi — báo cáo thu / trả phơi' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lập phiếu thu — báo cáo thu / trả phơi' }));
    const drawer = await screen.findByRole('dialog', { name: /Lô chưa thanh toán — tất cả đối tác/ });
    // The worklist crosses parties, so every row names whose money it is.
    expect(await within(drawer).findByRole('columnheader', { name: 'Đối tác' })).toBeTruthy();
    expect(within(drawer).getByText('KH Alpha')).toBeTruthy();
    expect(within(drawer).getByText('KH Beta')).toBeTruthy();
    // The batch read asks for NO party — every party in the window.
    await waitFor(() => expect(getPhoiPhieuPartyLots).toHaveBeenCalledWith('THU', null, expect.objectContaining({ scope: undefined })));
  });

  it('turns the report to the direction the button names', async () => {
    renderSection();
    await screen.findByRole('columnheader', { name: 'Phải thu' });
    fireEvent.click(screen.getByRole('button', { name: 'Lập phiếu chi — báo cáo thu / trả phơi' }));
    // The table and the worklist never disagree: the TRA table is up.
    expect(await screen.findByRole('columnheader', { name: 'Phải trả' })).toBeInTheDocument();
    await waitFor(() => expect(getPhoiPhieuPartyLots).toHaveBeenCalledWith('TRA', null, expect.objectContaining({ scope: undefined })));
  });

  it('keeps the per-party drill-down: clicking a party still opens ITS drawer', async () => {
    getPhoiPhieuPartyLots.mockResolvedValue({ items: [lot({ tripId: 1, party: 'KH Alpha' })] });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'KH Alpha' }));
    const drawer = await screen.findByRole('dialog', { name: /Lô chưa thanh toán — KH Alpha/ });
    // The per-party drawer knows its party from its title — no party column.
    expect(within(drawer).queryByRole('columnheader', { name: 'Đối tác' })).toBeNull();
    await waitFor(() => expect(getPhoiPhieuPartyLots).toHaveBeenCalledWith('THU', 'KH Alpha', expect.objectContaining({ scope: undefined })));
  });
});
