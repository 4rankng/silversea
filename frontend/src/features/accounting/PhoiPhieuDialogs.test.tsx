import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { PhoiPhieuChiHoDialog } from './PhoiPhieuChiHoDialog';
import { PhoiPhieuTienDuongDialog } from './PhoiPhieuTienDuongDialog';
import PhoiPhieuControlPage from '../../pages/accounting/PhoiPhieuControlPage';
// Card 20260928_171 — the tiền-đường dialog edits amounts, so the tests assert
// the exact payload the house client sends and the money strings the board and
// the detail must agree on.
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { confirmPhoiPhieuTienDuong, getPhoiPhieuTienDuong } from '../../api/phoiPhieuClient';


vi.mock('../../api/phoiPhieuClient', () => ({
  correctPhoiPhieuRow: vi.fn(),
  confirmPhoiPhieuTienDuong: vi.fn(),
  getPhoiPhieuChiHo: vi.fn().mockResolvedValue({
    tripCode: 'ST-2609-0001',
    ngayLayPhoi: null,
    trangThaiLay: null,
    rows: [
      {
        entryId: 1, sourceId: 11, feeName: 'Phí nâng hạ', invoiceNumber: null,
        amountThu: 1_350_000, amountTra: 1_350_000, payerName: 'Khách', confirmed: false, version: 3,
      },
    ],
  }),
  getPhoiPhieuTienDuong: vi.fn().mockResolvedValue({
    tripCode: 'ST-2609-0001',
    // Card 20260928_171 — a SELF-CONSISTENT fixture: one approved row (2.000.000)
    // and one unapproved (50.000). The board row ST-2609-0102 carries the same
    // 2.000.000 in its Tiền đường cell, so a test can compare the board cell
    // with the detail's approved total as one number, and prove the all-rows
    // figure (2.050.000) is labelled as the gross, never as the board number.
    totals: { total: 2_050_000, confirmed: 2_000_000 },
    rows: [
      {
        sourceId: 21, version: 1, costType: 'FUEL', feeName: 'Xăng đường',
        occurredAt: '2026-09-22', driverName: 'Tuấn', driverEnteredAmount: 1_900_000,
        amount: 2_000_000, confirmed: true,
      },
      {
        sourceId: 22, version: 4, costType: 'OTHER', feeName: 'Cầu đường',
        occurredAt: '2026-09-23', driverName: 'Tuấn', driverEnteredAmount: 50_000,
        amount: 50_000, confirmed: false,
      },
    ],
  }),
  updatePhoiPhieuMeta: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
  voidPhoiPhieuRow: vi.fn(),
  // Card 20260923_8 group B — board-row tests render the whole control page,
  // so the shared client mock also covers the page-level read endpoints.
  listPhoiPhieuRows: vi.fn().mockResolvedValue({ items: [
    {
      tripId: 101, tripCode: 'ST-2609-0101', shipmentId: 9001, shipmentCode: 'SHP-9001',
      billOrBooking: 'BILL-001', customerName: 'Khách A', routeName: 'HP - HN',
      containerNumber: 'ABCZ1234567', containerTypeLabel: '40HC', cargoWeightKg: 24000, containerPayloadKg: 26500,
      liftSite: 'Đình Vũ', dropSite: 'Bắc Giang', plateNumber: '29K-123.45', driverName: 'Tuấn',
      departureDate: '2026-09-22T00:00:00.000Z', transportDate: '2026-09-22', tripStatus: 'IN_TRANSIT',
      chiHoThu: null, chiHoTra: null, tienDuong: null,
      eligibleIn: 0, eligibleOut: 2,
      cusDispatchNotes: [], driverNote: null, confirmable: true,
    },
    {
      tripId: 102, tripCode: 'ST-2609-0102', shipmentId: 9002, shipmentCode: 'SHP-9002',
      billOrBooking: 'BILL-002', customerName: 'Khách B', routeName: 'HP - QN',
      containerNumber: 'DEFZ7654321', containerTypeLabel: '20GP', cargoWeightKg: 18000, containerPayloadKg: 28200,
      liftSite: 'Đình Vũ', dropSite: 'Quảng Ninh', plateNumber: '29K-678.90', driverName: 'Thắng',
      departureDate: '2026-09-22T00:00:00.000Z', transportDate: '2026-09-22', tripStatus: 'COMPLETED',
      chiHoThu: 1_350_000, chiHoTra: 1_350_000, tienDuong: 2_000_000,
      eligibleIn: 1, eligibleOut: 0,
      cusDispatchNotes: [], driverNote: null, confirmable: true,
    },
    {
      tripId: 103, tripCode: 'ST-2609-0103', shipmentId: 9003, shipmentCode: 'SHP-9003',
      billOrBooking: null, customerName: 'ADC P 1790089547534-zcain7', routeName: 'ADC route P 1790089547534-zcain7',
      containerNumber: 'GHIZ0001111', containerTypeLabel: '40HC', cargoWeightKg: null, containerPayloadKg: 26500,
      liftSite: 'Đình Vũ', dropSite: 'Hải Phòng', plateNumber: '30K-111.22', driverName: 'card6 driver 1790004852053-9kzgw8-26',
      departureDate: '2026-09-23T00:00:00.000Z', transportDate: '2026-09-23', tripStatus: 'CREATED',
      chiHoThu: null, chiHoTra: null, tienDuong: null,
      cusDispatchNotes: [], driverNote: null, confirmable: false,
    },
  ] }),
  listPhoiPhieuStk: vi.fn().mockResolvedValue({ items: [] }),
  listPhoiPhieuTruckAssignments: vi.fn().mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] }),
  assignPhoiPhieuTruckAccountant: vi.fn(),
  createPhoiPhieuVoucher: vi.fn(),
  getPhoiPhieuReport: vi.fn().mockResolvedValue({ rows: [], grand: null }),
}));

vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: {
    catalog: vi.fn().mockResolvedValue({ feeCategories: [], employees: [] }),
    update: vi.fn().mockResolvedValue({}),
    correct: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  },
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  document.body.style.overflow = '';
});

describe('phôi phiếu detail dialogs render in the house modal shell (card 20260922_67)', () => {
  it('Chi hộ dialog portals into document.body inside the fixed backdrop — not the page flow', async () => {
    render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    // Portal proof: the backdrop div is a DIRECT child of document.body, so
    // the dialog's on-screen position can never inherit the 100+-row board's
    // scroll offset (the 21,588px defect).
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('modal');
    await waitFor(() => expect(screen.getByText('Chi tiết chi hộ Chưa có số Bill/Booking')).toBeInTheDocument());
  });

  it('Chi hộ dialog: ✕ and Escape both dismiss; body scroll locks while open and restores after', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PhoiPhieuChiHoDialog tripId={7} onClose={onClose} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Chi tiết chi hộ' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Chi hộ dialog: focus returns to the opener after unmount', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('Tiền đường dialog portals into document.body and ✕ dismisses', async () => {
    const onClose = vi.fn();
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={onClose} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('modal');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('both dialog sources ride the design-system modal — no cross-feature ops CSS (card 20260930_227)', () => {
    for (const file of ['PhoiPhieuChiHoDialog.tsx', 'PhoiPhieuTienDuongDialog.tsx']) {
      const source = readFileSync(resolve(process.cwd(), `src/features/accounting/${file}`), 'utf8');
      expect(source).not.toContain("ops/ops-modal.css");
      expect(source).not.toContain('OpsModalBackdrop');
      expect(source).toMatch(/import \{[^}]*\bModal\b[^}]*\} from '\.\.\/\.\.\/design-system';/);
    }
  });
});

// Card 20260923_8 group B — board-row composition of the control page.
// RED-first notes: at HEAD the board renders TWO identical "Xem chi tiết"
// buttons per row, the chi hộ cell has no atomic line structure, and the date
// cell carries no nowrap column class — all three asserts below fail at HEAD.
describe('phôi phiếu board row composition (card 20260923_8 group B)', () => {
  function renderBoard() {
    return render(<PhoiPhieuControlPage />, { wrapper: makeWrapper() });
  }

  async function findRow(tripCode: string) {
    await screen.findByText(tripCode);
    const row = screen.getAllByRole('row').find((candidate) => candidate.textContent?.includes(tripCode));
    expect(row).toBeDefined();
    return row!;
  }

  it('renders exactly ONE "Xem chi tiết" button per row — the two identical buttons are deduped (D1 ruling)', async () => {
    renderBoard();
    for (const tripCode of ['BILL-001', 'BILL-002']) {
      const row = await findRow(tripCode);
      expect(within(row).getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(1);
    }
  });

  it('keeps chi hộ detail reachable via a distinct icon-only affordance named "Chi tiết chi hộ" (no workflow orphaned)', async () => {
    renderBoard();
    const row = await findRow('BILL-001');
    const chiHo = within(row).getByRole('button', { name: /Chi tiết chi hộ/ });
    expect(chiHo.textContent.trim()).toBe('');
  });

  it('renders chi hộ phải thu / phải trả as atomic lines (no ragged mid-token wrap)', async () => {
    renderBoard();
    const row = await findRow('BILL-001');
    const lines = within(row).getAllByText((content, element) => element?.classList.contains('ppc-line') ?? false);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(within(row).getByText(/Phải thu:/)).toBeTruthy();
    expect(within(row).getByText(/Phải trả:/)).toBeTruthy();
  });

  it('date cells carry the atomic nowrap column class (no mid-number fracture like 22/09/202 6)', async () => {
    renderBoard();
    await findRow('BILL-002');
    for (const cell of screen.getAllByText('22/09/2026')) {
      expect(cell.closest('td')?.className).toContain('ppc-col--date');
    }
  });

  // Card 20260923_11 — the board holds BOTH detail surfaces' state. The rule is
  // absolute ("chỉ 1 surface active tại một thời điểm"), so a request for one
  // surface must retire the other rather than stacking on it.
  it('retires the open detail surface when another is requested — never two board dialogs at once', async () => {
    renderBoard();
    const row = await findRow('BILL-001');
    fireEvent.click(within(row).getByRole('button', { name: 'Xem chi tiết' }));
    expect(await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: /Chi tiết chi hộ/ }));
    expect(await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Chi tiết tiền đường' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  // Case QA-2026-09-24-01 (director ruling): names are data — the fix lives
  // in the seeder + a strip migration, and the render layer must NEVER
  // launder them (an interim sanitiser was deleted; this fence keeps it
  // deleted, so display-layer stripping cannot ossify or mask regressions).
  it('render layer never launders display names (case QA-2026-09-24-01)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.tsx'), 'utf8');
    expect(source).not.toContain('business-label');
    expect(source).not.toContain('businessName(');
  });
  it('board rows render stored names verbatim (names are data)', async () => {
    renderBoard();
    const row = await findRow('Chưa có số Bill/Booking');
    expect(row.textContent).toContain('ADC P 1790089547534-zcain7');
    expect(row.textContent).toContain('card6 driver');
  });

  // Case QA-2026-09-24-01: with nothing checked the toolbar read "(0 dòng)"
  // while approved entries existed in the modal — a false zero that reads as
  // "nothing approved". PHOI10 keeps the short action while its title and
  // adjacent scope guidance explain selection; counts appear after selection.
  it('PHOI10 zero state retains concise direction actions and truthful selection guidance (case QA-2026-09-24-01)', async () => {
    renderBoard();
    expect(await findRow('BILL-001')).toBeTruthy();
    await screen.findByText('BILL-002');
    const button = screen.getByRole('button', { name: 'Lập phiếu chi' });
    expect(button.textContent).not.toContain('(0 dòng)');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Chọn ít nhất một dòng đã đối chiếu để lập phiếu');
    expect(screen.getByText('Bấm vào một dòng để chọn · 2 dòng lập được phiếu trong kết quả')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn cả trang này (2)' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Loại phiếu/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Phiếu thu' }));
    const receiveButton = screen.getByRole('button', { name: 'Lập phiếu thu' });
    expect(receiveButton).toBeDisabled();
    expect(receiveButton).toHaveAttribute('title', 'Chọn ít nhất một dòng đã đối chiếu để lập phiếu');
    expect(screen.getByText('Bấm vào một dòng để chọn · 2 dòng lập được phiếu trong kết quả')).toBeInTheDocument();
    // The next case still pins the selected-state eligible khoản count.
  });

  // Case QA-2026-09-24-01: the toolbar counter previews the voucher's
  // eligible set (approved ∧ remaining>0), in khoản units, per direction —
  // the button says exactly what pressing it will issue.
  it('toolbar counter previews the eligible set per direction (case QA-2026-09-24-01)', async () => {
    renderBoard();
    const row = await findRow('BILL-001');
    await screen.findByText('BILL-002');
    // Card 20260929_207: the row is the control now — the checkbox column is
    // gone app-wide, so the same intent (pick this row, then read what the
    // voucher would issue) is driven by clicking the row itself.
    fireEvent.click(within(row).getByText('BILL-001'));
    const button = screen.getByRole('button', { name: /Lập phiếu/ });
    expect(button.textContent).toContain('(2 khoản)');
    expect(button.textContent).not.toContain('dòng');
  });
});

// Card 20260928_171 — "Xem chi tiết tiền đường" must (AC1) total the same money
// as the board's Tiền đường column, (AC2) let the accountant fix a wrong amount
// — including on a row the driver entered — and (AC3) add a row, following the
// chi hộ dialog's existing pattern instead of a second one.
//
// AC1 definition, decided here and recorded on the card: the AUTHORITATIVE sum
// is the APPROVED one, because that is what the chi phiếu for the driver posts
// (phoi-phieu-control.service.ts:230-247 sums confirmed driver rows into the
// board cell). The dialog therefore names its approved figure as the number
// matching the outer column and keeps the all-rows figure under its own label,
// so no money is hidden and no reader has to guess which total is which.
describe('card 20260928_171 — chi tiết tiền đường: sửa số tiền, thêm dòng, tổng khớp cột ngoài', () => {
  const EDIT_REASON = 'Kế toán sửa số tiền trong xem chi tiết tiền đường';

  // The client mock is file-scoped, so each test starts from a clean call log —
  // otherwise a sibling test's save leaks into a `not.toHaveBeenCalled()` here.
  beforeEach(() => {
    vi.mocked(expenseAccountingClient.update).mockClear();
    vi.mocked(expenseAccountingClient.correct).mockClear();
  });

  async function findBoardRow(tripCode: string) {
    await screen.findByText(tripCode);
    const row = screen.getAllByRole('row').find((candidate) => candidate.textContent?.includes(tripCode));
    expect(row).toBeDefined();
    return row!;
  }

  it('AC1: cột Tiền đường của bảng và con số "đã duyệt" trong màn hình chi tiết là MỘT con số', async () => {
    render(<PhoiPhieuControlPage />, { wrapper: makeWrapper() });
    const row = await findBoardRow('BILL-002');
    const boardMoney = row.querySelector('.ppc-col--money .money')!;
    expect(boardMoney.querySelector('.money__num')?.textContent).toBe('2.000.000');
    expect(boardMoney.querySelector('.money__unit')?.textContent).toBe('₫');

    fireEvent.click(within(row).getByRole('button', { name: 'Xem chi tiết' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    await within(dialog).findByLabelText('Thực chi dòng 1');
    const footer = within(dialog).getByRole('region', { name: 'Tổng cộng' });
    // the same string the board cell shows, now inside the detail
    expect(within(footer).getByText('2.000.000')).toHaveClass('money__num');
    // the gross stays visible, but under the label that says it is the gross
    expect(within(footer).getByText('2.050.000')).toHaveClass('money__num');
    expect(within(footer).getByText('Tổng phát sinh')).toBeInTheDocument();
    expect(within(footer).getByText('Đã duyệt')).toBeInTheDocument();
    expect(within(dialog).getByText(/chỉ dòng đã duyệt mới được lập phiếu chi/)).toBeInTheDocument();
  });

  it('AC2: sửa số tiền dòng CHƯA duyệt lưu qua đường update của khoản chi lái xe, kèm version + lý do', async () => {
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    await screen.findByLabelText('Thực chi dòng 2');

    fireEvent.change(screen.getByLabelText('Thực chi dòng 2'), { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(vi.mocked(expenseAccountingClient.update)).toHaveBeenCalledWith(
      { sourceKind: 'DRIVER', sourceId: 22, expectedVersion: 4 },
      { expectedVersion: 4, reason: EDIT_REASON, amount: 70000 },
    ));
    expect(vi.mocked(expenseAccountingClient.correct)).not.toHaveBeenCalled();
  });

  it('AC2: sửa số tiền dòng ĐÃ duyệt (do lái xe nhập) đi đường điều chỉnh có lưu vết, không ghi đè', async () => {
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    await screen.findByLabelText('Thực chi dòng 1');

    fireEvent.change(screen.getByLabelText('Thực chi dòng 1'), { target: { value: '2100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(vi.mocked(expenseAccountingClient.correct)).toHaveBeenCalledWith(
      { sourceKind: 'DRIVER', sourceId: 21, expectedVersion: 1 },
      { expectedVersion: 1, reason: EDIT_REASON, amount: 2_100_000 },
    ));
    expect(vi.mocked(expenseAccountingClient.update)).not.toHaveBeenCalled();
  });

  it('AC3: "＋ Thêm dòng" mở đúng panel thêm khoản chi của nhà, nhóm Tiền đường, và chỉ một bề mặt hiện ra', async () => {
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    await screen.findByLabelText('Thực chi dòng 1');

    fireEvent.click(screen.getByRole('button', { name: '＋ Thêm dòng' }));
    const panel = await screen.findByRole('dialog', { name: 'Thêm khoản chi' });
    expect(panel).toBeInTheDocument();
    // Card 20260923_11 rule carried to this dialog: never two live surfaces.
    expect(screen.queryByRole('dialog', { name: 'Chi tiết tiền đường' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getAllByText('Tiền đường').length).toBeGreaterThan(0);
  });
});


describe('PHOI08 Tiền đường authoritative partial-save retry', () => {
  const initialRead = vi.mocked(getPhoiPhieuTienDuong).getMockImplementation()!;
  const initialUpdate = vi.mocked(expenseAccountingClient.update).getMockImplementation()!;
  const initialCorrect = vi.mocked(expenseAccountingClient.correct).getMockImplementation()!;
  function resetBoundary() {
    vi.mocked(confirmPhoiPhieuTienDuong).mockClear();
    vi.mocked(getPhoiPhieuTienDuong).mockReset().mockImplementation(initialRead);
    vi.mocked(expenseAccountingClient.update).mockReset().mockImplementation(initialUpdate);
    vi.mocked(expenseAccountingClient.correct).mockReset().mockImplementation(initialCorrect);
  }
  beforeEach(resetBoundary);
  afterEach(resetBoundary);

  it('rereads after later failure and retries only the remaining DRIVER source', async () => {
    const initial = await getPhoiPhieuTienDuong(7);
    let authoritative = initial.rows.map(row => ({ ...row }));
    const correct = vi.mocked(expenseAccountingClient.correct).getMockImplementation()!;
    const get = vi.mocked(getPhoiPhieuTienDuong);
    get.mockClear();
    get.mockResolvedValueOnce(initial).mockImplementationOnce(async () => ({ ...initial, rows: authoritative }));
    vi.mocked(expenseAccountingClient.correct).mockImplementationOnce(async (ref, body) => {
      authoritative = authoritative.map(row => row.sourceId === ref.sourceId ? { ...row, amount: body.amount!, version: row.version + 1 } : row);
      return correct(ref, body);
    });
    vi.mocked(expenseAccountingClient.update).mockRejectedValueOnce(new Error('Dòng tiền đường tiếp theo không lưu được'));
    const onClose = vi.fn(); const onSaved = vi.fn();
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={onClose} onSaved={onSaved} />, { wrapper: makeWrapper() });
    await screen.findByLabelText('Thực chi dòng 2');
    fireEvent.change(screen.getByLabelText('Thực chi dòng 1'), { target: { value: '2100000' } });
    fireEvent.change(screen.getByLabelText('Thực chi dòng 2'), { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dòng tiền đường tiếp theo không lưu được');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeEnabled());
    expect(screen.getByLabelText('Thực chi dòng 1')).toHaveValue('2.100.000');
    expect(screen.getByLabelText('Thực chi dòng 2')).toHaveValue('70.000');
    expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(expenseAccountingClient.correct).toHaveBeenCalledOnce();
    expect(expenseAccountingClient.correct).toHaveBeenCalledWith(
      { sourceKind: 'DRIVER', sourceId: 21, expectedVersion: 1 },
      expect.objectContaining({ expectedVersion: 1, amount: 2100000 }),
    );
    expect(expenseAccountingClient.update).toHaveBeenCalledTimes(2);
    expect(expenseAccountingClient.update).toHaveBeenLastCalledWith(
      { sourceKind: 'DRIVER', sourceId: 22, expectedVersion: 4 },
      expect.objectContaining({ expectedVersion: 4, amount: 70000 }),
    );
  });

  it('keeps Save blocked through failed reads and reloads before retrying the remaining source', async () => {
    const initial = await getPhoiPhieuTienDuong(7);
    let authoritative = initial.rows.map(row => ({ ...row }));
    const correct = vi.mocked(expenseAccountingClient.correct).getMockImplementation()!;
    const get = vi.mocked(getPhoiPhieuTienDuong);
    get.mockClear();
    get.mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('Không tải lại được tiền đường'))
      .mockRejectedValueOnce(new Error('Tiền đường vẫn chưa tải lại được'))
      .mockImplementationOnce(async () => ({ ...initial, rows: authoritative }));
    vi.mocked(expenseAccountingClient.correct).mockImplementationOnce(async (ref, body) => {
      authoritative = authoritative.map(row => row.sourceId === ref.sourceId ? { ...row, amount: body.amount!, version: row.version + 1 } : row);
      return correct(ref, body);
    });
    vi.mocked(expenseAccountingClient.update).mockRejectedValueOnce(new Error('Dòng tiền đường tiếp theo không lưu được'));
    const onClose = vi.fn(); const onSaved = vi.fn();
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={onClose} onSaved={onSaved} />, { wrapper: makeWrapper() });
    await screen.findByLabelText('Thực chi dòng 2');
    fireEvent.change(screen.getByLabelText('Thực chi dòng 1'), { target: { value: '2100000' } });
    fireEvent.change(screen.getByLabelText('Thực chi dòng 2'), { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dòng tiền đường tiếp theo không lưu được');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải lại được tiền đường');
    expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'Tích duyệt' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(confirmPhoiPhieuTienDuong).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(expenseAccountingClient.correct).toHaveBeenCalledOnce();
    expect(expenseAccountingClient.update).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert')).toHaveTextContent('Dòng tiền đường tiếp theo không lưu được');
    expect(screen.getByRole('alert')).toHaveTextContent('Tiền đường vẫn chưa tải lại được');
    expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tích duyệt' })).toBeDisabled();
    expect(confirmPhoiPhieuTienDuong).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Dòng tiền đường tiếp theo không lưu được');
    expect(screen.getByLabelText('Thực chi dòng 1')).toHaveValue('2.100.000');
    expect(screen.getByLabelText('Thực chi dòng 2')).toHaveValue('70.000');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(expenseAccountingClient.correct).toHaveBeenCalledOnce();
    expect(expenseAccountingClient.update).toHaveBeenCalledTimes(2);
    expect(expenseAccountingClient.update).toHaveBeenLastCalledWith(
      { sourceKind: 'DRIVER', sourceId: 22, expectedVersion: 4 },
      expect.objectContaining({ expectedVersion: 4, amount: 70000 }),
    );
  });
});

describe('PHOI13 Chi hộ dialog keeps its content readable (card 20261002_278)', () => {
  it('re-pins the table header to the dialog scrollport', async () => {
    render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const table = await screen.findByRole('table');

    // The page-level sticky offset (-24px) is tuned for `.app-body`; inside the
    // dialog the scrollport is `.modal__body`, so an inherited offset rides the
    // header ABOVE the scrollport edge and over row 1 — the "text edges cut
    // off" defect. The table overrides the token it actually consumes.
    expect(table.style.getPropertyValue('--sticky-thead-top')).toBe('0px');

    // The wrap must stay `overflow: visible` so `.modal__body` remains the
    // header's scrollport. Promoting it to a scroll container (the `--scroll`
    // modifier) collapses the vertical overflow the header pins inside and
    // would silently un-pin the header instead.
    expect(table.closest('.record-table-wrap--scroll')).toBeNull();
  });
});
