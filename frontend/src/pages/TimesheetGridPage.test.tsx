// FB-101 (card 141026230780) — chấm công không bị ẩn với kế toán: mở lưới
// xem được cho ACCOUNTANT nhưng ô read-only và KHÔNG có nút "Lưu lưới" (backend
// chặn ghi lưới ngoài dispatcherOrAbove); Điều vận vẫn nhập bình thường.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { TimesheetDayCell, TimesheetDriverRow, TimesheetMonth } from '../api/timesheetClient';

const { listDrivers, listMonths, saveDays, createMonth, currentUser } = vi.hoisted(() => ({
  listDrivers: vi.fn(),
  listMonths: vi.fn(),
  saveDays: vi.fn(),
  createMonth: vi.fn(),
  currentUser: { userId: 1, role: 'DISPATCHER' as string },
}));

vi.mock('../api/timesheetClient', () => ({
  listTimesheetDrivers: (...args: unknown[]) => listDrivers(...args),
  listTimesheetMonths: (...args: unknown[]) => listMonths(...args),
  saveTimesheetDays: (...args: unknown[]) => saveDays(...args),
  createTimesheetMonth: (...args: unknown[]) => createMonth(...args),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock('../design-system/hooks/useMonthRoute', () => ({
  useMonthRoute: () => ({ month: 10, year: 2026, goPrev: vi.fn(), goNext: vi.fn() }),
}));
vi.mock('../components/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

import TimesheetGridPage from './TimesheetGridPage';

const day = (workDate: string, overrides: Partial<TimesheetDayCell> = {}): TimesheetDayCell => ({
  id: 1, workDate, symbol: null, trips: 0, isSunday: false, tripAdjustment: 0,
  note: null, source: 'MANUAL', enteredBy: null, enteredAt: null, adjustedBy: null, adjustedAt: null,
  ...overrides,
});

const driver: TimesheetDriverRow = {
  id: 1, name: 'Tài xế A', status: 'ACTIVE', plateNumber: '29H-12345', vehicleClass: 'Đầu kéo',
  monthId: 5, salaryMode: 'PER_TRIP', monthStatus: 'OPEN', defaultSalaryMode: 'PER_TRIP',
};

const month: TimesheetMonth = {
  id: 5, driverId: 1, driverName: 'Tài xế A', year: 2026, month: 10,
  salaryMode: 'PER_TRIP', dailyBase: null, flatAmount: null,
  status: 'OPEN', reconciledBy: null, reconciledAt: null, reconcileNote: null,
  days: [day('2026-10-05'), day('2026-10-06', { symbol: 'K', trips: 1 })],
  salary: {
    trips: 1, workdays: 1, standardDays: 2, paidSalaryDays: 2,
    symbolCounts: { K: 1, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 },
    symbolDays: { K: 1, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 },
    bonusTrips: 0, perTripPay: 300000, extraTripBonus: 0, dailyBasePay: 0,
    salaryTotal: 300000, mode: 'PER_TRIP',
  },
  warnings: [],
};

function page() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TimesheetGridPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listDrivers.mockReset().mockResolvedValue([driver]);
  listMonths.mockReset().mockResolvedValue([month]);
  saveDays.mockReset();
  createMonth.mockReset().mockResolvedValue(month);
  currentUser.role = Role.DISPATCHER;
});

describe('TimesheetGridPage role surface (FB-101)', () => {
  it('Điều vận nhập được lưới và có nút Lưu lưới', async () => {
    page();
    expect(await screen.findByRole('button', { name: /Lưu lưới/ })).toBeVisible();
    const cells = await screen.findAllByRole('textbox');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).not.toHaveAttribute('readonly');
  });

  it('kế toán xem được lưới (ô read-only) nhưng không có nút Lưu lưới', async () => {
    currentUser.role = Role.ACCOUNTANT;
    page();
    await screen.findAllByRole('textbox');
    expect(screen.queryByRole('button', { name: /Lưu lưới/ })).toBeNull();
    for (const cell of screen.getAllByRole('textbox')) expect(cell).toHaveAttribute('readonly');
  });

  it('Vận hành (OPS — hoangnh, SIL-862) nhập được lưới và có nút Lưu lưới', async () => {
    currentUser.role = Role.OPS;
    page();
    expect(await screen.findByRole('button', { name: /Lưu lưới/ })).toBeVisible();
    const cells = await screen.findAllByRole('textbox');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).not.toHaveAttribute('readonly');
  });

  it('seat legacy FORWARDER vẫn là ghế OPS (SIL-862): nhập được lưới', async () => {
    currentUser.role = 'FORWARDER';
    page();
    expect(await screen.findByRole('button', { name: /Lưu lưới/ })).toBeVisible();
    for (const cell of await screen.findAllByRole('textbox')) expect(cell).not.toHaveAttribute('readonly');
  });
});

describe('mở bảng chấm công (FB-102/FB-103 — card 141026230790/230800)', () => {
  it('tháng chưa có bảng: kế toán mở bảng với hình thức lương mặc định Lương theo chuyến', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Mở bảng/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({
      driverId: 1, year: 2026, month: 10, salaryMode: 'PER_TRIP', dailyBase: null,
    }));
  });

  it('chọn Lương theo tháng (trốn vé) + lương tháng cố định khi mở bảng', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Hình thức lương/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lương theo tháng (trốn vé)' }));
    fireEvent.change(within(dialog).getByLabelText('Lương tháng cố định (VND)'), { target: { value: '10000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Mở bảng$/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({
      driverId: 1, year: 2026, month: 10, salaryMode: 'FLAT_MONTHLY', flatAmount: 10000000,
    }));
  });

  it('OPS (SIL-862) mở bảng chấm công được khi tháng chưa có bảng', async () => {
    currentUser.role = Role.OPS;
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  // FB-103 (ticket 171026215600) — modal mở với chế độ mặc định CỦA LÁI XE
  // (đặt trong dialog "Sửa lương cứng" / dialog sửa lái xe), không ép PER_TRIP.
  it('mở bảng với sẵn chế độ của lái xe khi lái xe đặt Lương theo tháng', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listDrivers.mockReset().mockResolvedValue([{ ...driver, defaultSalaryMode: 'FLAT_MONTHLY' as const }]);
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    const dialog = await screen.findByRole('dialog');
    // Select hiển thị sẵn chế độ của lái xe — không cần chọn lại.
    const modeTrigger = within(dialog).getByRole('button', { name: /Hình thức lương/ });
    expect(modeTrigger.textContent).toContain('Lương theo tháng (trốn vé)');
    fireEvent.change(within(dialog).getByLabelText('Lương tháng cố định (VND)'), { target: { value: '9000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Mở bảng$/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({
      driverId: 1, year: 2026, month: 10, salaryMode: 'FLAT_MONTHLY', flatAmount: 9000000,
    }));
  });
});

// SIL-842 (CR-008 Task 2.2, KH 15/11) — Điều vận (dungnv) mở /timesheet bị kẹt
// ở "Kế toán mở bảng trước": tháng chưa có bảng thì vai trò thao tác lưới TỰ
// khởi tạo khi mở trang (POST /months không gửi salaryMode — service lấy chế độ
// mặc định của lái xe). Kế toán giữ nguyên đường mở chủ động qua dialog.
describe('SIL-842 — tự khởi tạo lưới chấm công cho vai trò thao tác', () => {
  it('Điều vận mở trang là bảng tháng tự mở — không đợi Kế toán, không dialog', async () => {
    listDrivers.mockReset().mockResolvedValue([{ ...driver, monthId: null }]);
    listMonths.mockReset().mockResolvedValue([]);
    page();
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({ driverId: 1, year: 2026, month: 10 }));
    // Không gửi salaryMode — service chốt theo chế độ mặc định của lái xe.
    expect(createMonth.mock.calls[0][0]).not.toHaveProperty('salaryMode');
    expect(createMonth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('MANAGER (vai trò thao tác lưới) cũng được tự khởi tạo', async () => {
    currentUser.role = Role.MANAGER;
    listDrivers.mockReset().mockResolvedValue([{ ...driver, monthId: null }]);
    listMonths.mockReset().mockResolvedValue([]);
    page();
    await waitFor(() => expect(createMonth).toHaveBeenCalledWith({ driverId: 1, year: 2026, month: 10 }));
  });

  it('Kế toán không bị tự mở — vẫn chủ động mở bảng qua dialog (FB-102/FB-103 giữ nguyên)', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listDrivers.mockReset().mockResolvedValue([{ ...driver, monthId: null }]);
    listMonths.mockReset().mockResolvedValue([]);
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Mở bảng chấm công/ }));
    await screen.findByRole('dialog');
    expect(createMonth).not.toHaveBeenCalled();
  });

  it('tự khởi tạo lỗi thì Điều vận vẫn mở bảng được bằng tay — không chết màn hình', async () => {
    listDrivers.mockReset().mockResolvedValue([{ ...driver, monthId: null }]);
    listMonths.mockReset().mockResolvedValue([]);
    createMonth.mockReset().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(month);
    page();
    await waitFor(() => expect(createMonth).toHaveBeenCalledTimes(1));
    const openBtn = await screen.findByRole('button', { name: /Mở bảng chấm công/ });
    fireEvent.click(openBtn);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Mở bảng$/ }));
    await waitFor(() => expect(createMonth).toHaveBeenCalledTimes(2));
  });
});

describe('SIL-649 — Driver timesheet empty-state redesign & stray stripe extermination', () => {
  it('renders centered empty-state card with dynamic month title and guidance text for dispatcher', async () => {
    currentUser.role = Role.DISPATCHER;
    listMonths.mockReset().mockResolvedValue([]);
    const { container } = page();

    // 1. Dynamic month title derived from useMonthRoute (10/2026)
    const title = await screen.findByRole('heading', { level: 3, name: 'Chưa có bảng chấm công tháng 10/2026' });
    expect(title).toBeVisible();

    // 2. SIL-842 — guidance bỏ luật "Kế toán mở bảng trước"; nút mở bảng là
    // hành động thật của mọi vai trò thao tác lưới (không còn dead button).
    expect(screen.getByText('Mở bảng chấm công để khởi tạo lưới cho lái xe trong tháng này.')).toBeVisible();
    expect(await screen.findByRole('button', { name: /Mở bảng chấm công/ })).toBeVisible();

    // 3. Centered empty card container
    const emptyCard = container.querySelector('.ts-empty-card');
    expect(emptyCard).not.toBeNull();
    expect(emptyCard?.querySelector('.ds-empty-state')).not.toBeNull();

    // 4. Month navigation inside containerized toolbar
    const toolbar = container.querySelector('.ts-toolbar');
    expect(toolbar).not.toBeNull();
    const monthPicker = toolbar?.querySelector('.ts-month-picker');
    expect(monthPicker).not.toBeNull();
    expect(monthPicker?.querySelector('.ts-period')?.textContent).toBe('Tháng 10/2026');
  });

  it('renders primary CTA Mở bảng chấm công inside empty card for accountant', async () => {
    currentUser.role = Role.ACCOUNTANT;
    listMonths.mockReset().mockResolvedValue([]);
    const { container } = page();

    const emptyCard = container.querySelector('.ts-empty-card');
    expect(emptyCard).not.toBeNull();

    const openBtn = await screen.findByRole('button', { name: /Mở bảng chấm công/ });
    expect(openBtn).toBeVisible();
    expect(emptyCard?.contains(openBtn)).toBe(true);
  });

  it('exterminates stray stripe artifact when driver list is empty or populated', async () => {
    // When no drivers exist: .ts-driver-select is completely absent from DOM (no 0-width ghost container)
    listDrivers.mockReset().mockResolvedValue([]);
    listMonths.mockReset().mockResolvedValue([]);
    const { container: emptyContainer } = page();

    await screen.findByText('Chưa có bảng chấm công tháng 10/2026');
    expect(emptyContainer.querySelector('.ts-driver-select')).toBeNull();

    // When drivers exist: .ts-driver-select is rendered with proper driver option without collapse
    listDrivers.mockReset().mockResolvedValue([driver]);
    const { container: populatedContainer } = page();

    const driverSelect = await waitFor(() => {
      const el = populatedContainer.querySelector('.ts-driver-select');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(driverSelect).toBeVisible();
    expect(within(driverSelect as HTMLElement).getByRole('button', { name: /Chọn lái xe/ })).toBeVisible();
  });
});

describe('SIL-737 — marker nguồn ô lưới', () => {
  it('ô tự ghi mang data-source AUTO; ô Điều vận gõ tay vào thì đổi sang MANUAL', async () => {
    listMonths.mockReset().mockResolvedValue([{
      ...month,
      days: [day('2026-10-05', { symbol: 'Đ', trips: 1, source: 'AUTO' })],
    }]);
    page();
    const cells = await screen.findAllByRole('textbox');
    expect(cells[0]).toHaveAttribute('data-source', 'AUTO');

    // Điều vận gõ tay vào ô tự ghi → ô đó thuộc của người, không còn là ô tự ghi.
    fireEvent.keyDown(cells[0], { key: 'q' });
    await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('data-source', 'MANUAL'));
  });
});

// SIL-802 (KB Rev2 Epic 4 / SIL-781 AC): Q (Quay đầu) renders BLUE text — the
// customer's paper-grid convention. The teal `--info-text` (#25574F) QA measured
// on staging was the 2026-11-10 defect; this pin holds the blue at the source.
describe('SIL-802 — Q cell reads blue', () => {
  const gridCss = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetGridPage.css'), 'utf8');
  const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

  it('paints [data-symbol=Q] text with the house blue token', () => {
    expect(gridCss).toMatch(
      /:is\(#root, body\) \.ts-grid \.ts-cell\[data-symbol='Q'\]\s*\{[^}]*color:\s*var\(--chip-open-text\);/,
    );
    // The token the rule references exists at the token layer (drift ratchet:
    // raw hex lives in tokens.css, consumers reference var() only).
    expect(tokens).toMatch(/--chip-open-text:\s*#175CD3;/);
  });

  it('never paints Q with the teal info-text the ticket rejected', () => {
    const qRule = gridCss.match(/\.ts-cell\[data-symbol='Q'\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(qRule).not.toContain('--info-text');
  });

  // QA FAIL 1ae5afcb (5049): the LEGEND Q on /timesheet measured rgb(96,103,105)
  // — the legend spans carried no symbol rule at all, so the letter fell back
  // to default ink. The legend letter reads the same blue as the cells.
  it('the legend Q letter carries the blue rule on both DOM and stylesheet', async () => {
    page();
    const legendQ = await screen.findByText('Q', { selector: 'b.ts-legend-sym--q' });
    expect(legendQ.textContent).toBe('Q');
    expect(gridCss).toMatch(
      /\.ts-legend \.ts-legend-sym--q\s*\{[^}]*color:\s*var\(--chip-open-text\);/,
    );
  });

  // QA FAIL 1ae5afcb (5049): the FLEET grid (/timesheet/bao-cao) painted Q with
  // var(--info-text) — the teal the ticket rejected — via ts-report__sym--q in
  // TimesheetMonthlyReportPage.css. That stylesheet is a separate surface from
  // the one pinned above, so it gets its own never-regress pin.
  it('the fleet report symbol rule uses the blue token, never the teal', () => {
    const reportCss = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetMonthlyReportPage.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const qRule = reportCss.match(/\.ts-report \.ts-report__sym--q\s*\{[^}]*\}/)?.[0] ?? '';
    expect(qRule).toContain('var(--chip-open-text)');
    expect(qRule).not.toContain('--info-text');
  });
});

// SIL-841 (QA fail fd0f7f14) — legend mang chú thích NGÀY CÔNG: L/P '+ngày
// công' dù 0 chuyến, N '−1 ngày phép (sau ngày đầu)' (miễn trừ max(0, N−1)).
describe('SIL-841 — legend workday annotations', () => {
  it('L/P ghi +ngày công và N ghi −1 ngày phép trên chú thích', async () => {
    page();
    await screen.findAllByRole('textbox');
    expect(screen.getAllByText(/· \+ngày công/).length).toBe(2);
    expect(screen.getAllByText(/· −1 ngày phép \(sau ngày đầu\)/).length).toBe(1);
    // K/Q/Đ không mang chú thích ngày công (chuyến tự nói lên ngày công).
    expect(screen.queryByText(/Kẹp 2 cont .*ngày công/)).toBeNull();
  });

  // SIL-841 round (QA FAIL 16/11 23:12, build dd198999) — the Chủ nhật rule
  // was tooltip-only on /timesheet; QA expects it as a legend LINE like the
  // monthly report's ('Chủ nhật — nền vàng, ghi chuyến, không tính ngày công').
  it('the legend carries the Chủ nhật rule as its own line', async () => {
    page();
    await screen.findAllByRole('textbox');
    expect(screen.getByText('Chủ nhật — nền vàng, ghi chuyến, không tính ngày công')).toBeTruthy();
  });
});

// SIL-968 (staging df7b2a73, KB Ch.2 §2.2.5 / K2.49) — QA đo computed style
// trên /timesheet: ô L đọc mực xám rgb(77,88,82) (= --ink-2 của rule Chủ
// nhật cũ) và cột Chủ nhật trong suốt rgba(0,0,0,0) ở cả 6 tuần (tầng td
// chưa từng có nền) — trong khi legend vẫn hứa 'nền vàng'. Pin cả hai luật
// tại nguồn như SIL-802 đã làm cho chữ xanh Q.
describe('SIL-968 — ký hiệu L chữ cam & cột Chủ nhật nền vàng', () => {
  const gridCss = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetGridPage.css'), 'utf8');
  const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

  it('ô L (Lưu ca) đọc CHỮ CAM = var(--warning-text) — cùng bảng màu ô L báo cáo tháng', () => {
    expect(gridCss).toMatch(
      /:is\(#root, body\) \.ts-grid \.ts-cell\[data-symbol='L'\]\s*\{[^}]*color:\s*var\(--warning-text\);/,
    );
    // Token cam tồn tại ở tầng token (drift ratchet: hex raw chỉ ở tokens.css).
    expect(tokens).toMatch(/--warning-text:\s*#6F3C10;/);
  });

  it('cột Chủ nhật mang nền vàng --ts-sunday-bg ở tầng td (cả ô đệm) và tầng ô nhập', () => {
    expect(gridCss).toMatch(/--ts-sunday-bg:\s*#FBEFC7;/);
    expect(gridCss).toMatch(
      /\.ts-grid td\[data-sunday-col='true'\]\s*\{[^}]*background:\s*var\(--ts-sunday-bg\);/,
    );
    const sundayRule = gridCss.match(/:is\(#root, body\) \.ts-grid \.ts-cell\[data-sunday='true'\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(sundayRule).toContain('background: var(--ts-sunday-bg)');
    expect(sundayRule).toContain('color: var(--ink)');
    // Bảng màu xám cũ (QA đo rgb(77,88,82) + nền trong suốt) không được quay lại.
    expect(sundayRule).not.toContain('--surface-2');
    expect(sundayRule).not.toContain('--ink-2');
    // Anchor #root: paint readonly (1,0,0) của base.css phải thua trên lưới
    // chỉ-đọc của kế toán (FB-101), đúng chính sách của rule Q/N/P.
    expect(sundayRule.startsWith(':is(#root, body)')).toBe(true);
  });

  // Tháng 10/2026: 5 tuần — Chủ nhật 04/10 là ô thật tuần 1, tuần 5 kết thúc
  // bằng Ô ĐỆM ở cột CN; nền vàng phải phủ cả hai loại ô qua mọi tuần.
  it('mỗi tuần đánh dấu đúng một td[data-sunday-col] ở cột CN — ô thật lẫn ô đệm', async () => {
    const octoberDays = Array.from({ length: 31 }, (_, index) =>
      day(`2026-10-${String(index + 1).padStart(2, '0')}`, { isSunday: [3, 10, 17, 24].includes(index) }));
    listMonths.mockReset().mockResolvedValue([{ ...month, days: octoberDays }]);
    const { container } = page();
    await screen.findAllByRole('textbox');
    const rows = container.querySelectorAll('.ts-grid tbody tr');
    expect(rows.length).toBe(5);
    for (const row of rows) {
      const sundayTds = row.querySelectorAll('td[data-sunday-col="true"]');
      expect(sundayTds.length).toBe(1);
      // Cột CN là cột ngày CUỐI — ô tổng Chuyến (.num) đứng ngay sau.
      expect(sundayTds[0].nextElementSibling?.className).toContain('num');
    }
    expect(rows[0].querySelector('td[data-sunday-col="true"]')?.getAttribute('data-label')).toBe('2026-10-04');
    expect(rows[4].querySelector('td[data-sunday-col="true"]')?.getAttribute('data-label')).toBeNull();
  });

  // Legend đã hứa 'nền vàng' từ SIL-841 — sau khi lưới thực hiện đúng, dòng
  // chú thích phải khớp thực tế (không còn nói vàng mà lưới trắng).
  it('legend Chủ nhật khớp lưới sau khi cột vàng có thật', async () => {
    page();
    await screen.findAllByRole('textbox');
    expect(screen.getByText('Chủ nhật — nền vàng, ghi chuyến, không tính ngày công')).toBeTruthy();
  });
});
