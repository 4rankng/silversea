// Cards 191026181942 (cus-tongquan-*): the Tổng quan row's cargo wording,
// CBM suppression, muted zero-allocation signal, and the shared NameCell.
// Thin-cast fixture precedent: cusQuickEditModel.test.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CusShipmentRow } from './CusShipmentRow';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

const access = (mode: string) => ({ mode, reason: `reason:${mode}` });

function makeItem(overrides: {
  cargoMode?: 'FCL' | 'LCL';
  direction?: 'IMPORT' | 'EXPORT';
  containerSummary?: string | null;
  weightKg?: string | null;
  volumeCbm?: string | null;
  vehicleReadiness?: string;
  missingCarrierContainers?: number;
  totalContainers?: number;
  customerName?: string | null;
  routeName?: string | null;
  billOrBookNumber?: string | null;
  declarationNumber?: string | null;
  declarationNumbers?: string[];
  transportDate?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  derivedScheduleAt?: string | null;
  scheduleReadiness?: string;
} = {}): ShipmentCusWorkspaceListItem {
  const {
    cargoMode = 'LCL',
    direction = 'IMPORT',
    containerSummary = '',
    weightKg = '1200',
    volumeCbm = null,
    vehicleReadiness = 'READY',
    missingCarrierContainers = 0,
    totalContainers = 0,
    customerName = 'LONG MINH',
    routeName = 'Vân Trung, Bắc Ninh',
    billOrBookNumber = null,
    declarationNumber = null,
    declarationNumbers = [],
    transportDate = null,
    closingAt = null,
    plannedReturnAt = null,
    derivedScheduleAt = null,
    scheduleReadiness = 'READY',
  } = overrides;
  return {
    id: 7,
    version: 3,
    bucket: 'NEW',
    bucketLabel: 'Mới',
    cargoMode,
    direction,
    customerName,
    routeName,
    deliveryLocation: null,
    effectiveFactoryNames: [],
    factoryName: 'Factory A',
    isAdHoc: false,
    billOrBookNumber,
    declarationNumber,
    declarationNumbers,
    shippingLineName: null,
    isCombined: false,
    containerSummary,
    weightKg,
    volumeCbm,
    packageCount: 12,
    packageType: 'Pallet',
    customerNotes: null,
    operationalNotes: null,
    appointmentGroups: [],
    transportDate,
    closingAt,
    plannedReturnAt,
    derivedScheduleAt,
    raw: { isAdHoc: false },
    fieldAccess: {
      factoryName: access('EDITABLE'),
      blNumber: access('EDITABLE'),
      bookingRef: access('EDITABLE'),
      declarationNumber: access('EDITABLE'),
      tradeDirection: access('EDITABLE'),
      shippingLineName: access('EDITABLE'),
      packageCount: access('EDITABLE'),
      packageType: access('EDITABLE'),
      cargoWeightKg: access('EDITABLE'),
      cargoVolumeCbm: access('EDITABLE'),
      customerNotes: access('EDITABLE'),
      operationalNotes: access('EDITABLE'),
    },
    operational: {
      scheduleReadiness,
      vehicleReadiness,
      totalContainers,
      assignedContainers: 0,
      externalContainers: 0,
      plateAssignedContainers: 0,
      missingCarrierContainers,
      missingPlateContainers: 0,
      orderIssuedContainers: 0,
      transportDateEditable: true,
      deletable: true,
    },
    finance: { isLoss: false, hasPendingRecovery: false },
    documentCustody: { status: 'CUSTOMER' },
    accountingConfirmation: { status: 'PENDING' },
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

function renderRow(item: ShipmentCusWorkspaceListItem, dateFilter: { from?: string; to?: string } = {}) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <CusShipmentRow
            item={item}
            dateFrom={dateFilter.from ?? ''}
            dateTo={dateFilter.to ?? ''}
            editing={false}
            quickEditOpen={false}
            savingQuickEdit={false}
            onStartQuickEdit={vi.fn()}
            onOpenDetail={vi.fn()}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

describe('CusShipmentRow — card 191026181942 (tổng quan hàng lẻ)', () => {
  // Card 261022213755c (TiepVu 22/10-2): the direction badge itself names
  // the cargo mode for LCL lots — "Nhập lẻ"/"Xuất lẻ" in the same
  // cus-direction-badge pill, FCL rows keep the plain "Nhập"/"Xuất".
  it.each([
    { cargoMode: 'LCL', direction: 'IMPORT', expected: 'Nhập lẻ' },
    { cargoMode: 'LCL', direction: 'EXPORT', expected: 'Xuất lẻ' },
    { cargoMode: 'FCL', direction: 'IMPORT', expected: 'Nhập' },
    { cargoMode: 'FCL', direction: 'EXPORT', expected: 'Xuất' },
  ] as const)('direction badge reads "$expected" for $cargoMode $direction', ({ cargoMode, direction, expected }) => {
    const { container } = renderRow(makeItem({ cargoMode, direction }));
    const badge = container.querySelector('.cus-direction-badge')!;
    expect(badge.textContent).toBe(expected);
  });

  it('R3 names the LCL lot cargo object in the day-filter empty state (SIL-504: one-line label)', () => {
    renderRow(makeItem({ cargoMode: 'LCL', containerSummary: null }), { from: '2026-10-19', to: '2026-10-19' });
    expect(screen.getByText('Chưa chọn hàng lẻ')).toBeTruthy();
    expect(screen.queryByText('Không có cont chạy ngày đã chọn')).toBeNull();
  });

  it('R3 keeps the cont wording for a container lot', () => {
    renderRow(makeItem({ cargoMode: 'FCL', containerSummary: null, weightKg: null }), { from: '2026-10-19', to: '2026-10-19' });
    expect(screen.getByText('Không có cont chạy ngày đã chọn')).toBeTruthy();
  });

  it('R4a suppresses the CBM segment when the lot carries no volume — no "— CBM"', () => {
    const { container } = renderRow(makeItem({ cargoMode: 'LCL', volumeCbm: null }));
    const metrics = container.querySelector('.cus-cargo-summary__weight')!;
    expect(metrics.textContent).toBe('1,2 tấn');
    expect(metrics.textContent).not.toContain('CBM');
  });

  it('R4a keeps the CBM segment when a volume exists', () => {
    const { container } = renderRow(makeItem({ cargoMode: 'LCL', volumeCbm: '3.5' }));
    expect(container.querySelector('.cus-cargo-summary__weight')!.textContent).toBe('1,2 tấn · 3,5 CBM');
  });

  it('R4b renders the muted "Chưa phân xe" signal for an unallocated containerless lot', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      vehicleReadiness: 'WAITING_CARRIER',
      missingCarrierContainers: 0,
    }));
    const signal = container.querySelector('.cus-row-actions__signal')!;
    expect(signal.textContent).toBe('Chưa phân xe');
    expect(signal.className).toContain('cus-attention-label--info');
    expect(screen.queryByText('Thiếu nhà xe 0 cont')).toBeNull();
  });

  it('R5 customer and route names ride the shared NameCell (accessible full name)', () => {
    renderRow(makeItem({ customerName: 'LONG MINH', routeName: 'Vân Trung, Bắc Ninh' }));
    const customer = screen.getByText('LONG MINH');
    expect(customer.className).toContain('name-cell');
    expect(customer.getAttribute('title')).toBe('LONG MINH');
    expect(customer.getAttribute('aria-label')).toBe('LONG MINH');
    const route = screen.getByText('Vân Trung, Bắc Ninh');
    expect(route.className).toContain('name-cell');
    expect(route.getAttribute('aria-label')).toBe('Vân Trung, Bắc Ninh');
  });

  it('SIL-586: renders delivery datetime in ICT (GMT+7) for LCL lot with plannedReturnAt', () => {
    // 02:30 UTC = 09:30 ICT (+7)
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      customerName: 'YUANFANG',
      billOrBookNumber: 'K2K45235345634',
      plannedReturnAt: '2026-10-29T02:30:00.000Z',
      direction: 'IMPORT',
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).toContain('09:30 29/10/2026');
  });

  it('SIL-586: renders delivery datetime in ICT for LCL lot with closingAt', () => {
    // 07:00 UTC = 14:00 ICT (+7)
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      customerName: 'LONG MINH',
      billOrBookNumber: 'K2K32143352',
      closingAt: '2026-10-29T07:00:00.000Z',
      direction: 'EXPORT',
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).toContain('14:00 29/10/2026');
  });

  it('SIL-586: renders date-only for LCL lot when only transportDate is present', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      customerName: 'LONG MINH',
      transportDate: '2026-10-29',
      closingAt: null,
      plannedReturnAt: null,
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).toContain('29/10/2026');
  });
});

// SIL-586 (id 686, khách 29/10 — b_d. Phạm Trung Kiên): hàng lẻ phải hiển thị
// ngày giờ trên "Tổng quan lô hàng" như dòng FCL. LCL không có container nên
// appointmentGroups luôn rỗng — ô lịch đọc schedule-level của lô: instant
// đóng/trả đúng hướng (như quick-edit), và lô cũ chỉ có EDD thì hiển thị
// ngày không kèm giờ bịa.
describe('CusShipmentRow — SIL-586: LCL schedule datetime trên Tổng quan', () => {
  it('C1: LCL IMPORT có plannedReturnAt (instant Z) hiển thị giờ VN ICT — 17:00Z = 00:00 29/10', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      direction: 'IMPORT',
      plannedReturnAt: '2026-10-28T17:00:00.000Z',
      transportDate: '2026-10-29',
    }));
    const fallback = container.querySelector('.cus-schedule-lot-fallback')!;
    expect(fallback.textContent).toBe('00:00 29/10/2026');
  });

  it('C1b: LCL EXPORT có closingAt (+07:00) giữ nguyên giờ VN', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      direction: 'EXPORT',
      closingAt: '2026-10-29T14:30:00+07:00',
      transportDate: '2026-10-29',
    }));
    expect(container.querySelector('.cus-schedule-lot-fallback')!.textContent).toBe('14:30 29/10/2026');
  });

  it('C2: lô lẻ cũ chỉ có EDD hiển thị ngày DD/MM/YYYY — không giờ bịa 00:00', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      direction: 'IMPORT',
      transportDate: '2026-10-22',
    }));
    const fallback = container.querySelector('.cus-schedule-lot-fallback')!;
    expect(fallback.textContent).toBe('22/10/2026');
    expect(fallback.textContent).not.toContain(':');
  });

  it('C2b: ngày EDD đọc trực tiếp từ chuỗi date-only — miễn dịch lệch múi giờ máy', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      direction: 'EXPORT',
      transportDate: '2026-10-22',
    }));
    // formatISODate reads YYYY-MM-DD by string surgery; a GMT-5 or GMT+8 host
    // cannot shift the printed day.
    expect(container.querySelector('.cus-schedule-lot-fallback')!.textContent).toBe('22/10/2026');
  });

  it('C3: lô lẻ không có gì giữ "Chưa chốt ngày", không crash, không in "—"', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      scheduleReadiness: 'WAITING_DATE',
      transportDate: null,
    }));
    expect(screen.getByText('Chưa chốt ngày')).toBeTruthy();
    expect(container.querySelector('.cus-schedule-lot-fallback')).toBeNull();
  });

  it('FCL không áp fallback ngày EDD — luật FCL giữ nguyên (chỉ instant lot-level)', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'FCL',
      direction: 'EXPORT',
      transportDate: '2026-10-22',
      totalContainers: 2,
    }));
    expect(container.querySelector('.cus-schedule-lot-fallback')).toBeNull();
  });
});

// SIL-502 (spec comment 1886): a lot created WITH tờ khai must never read
// "Chưa có tờ khai" on the Tổng quan — the Chứng từ cell joins the union
// list (container rows + declaration entities, card 20260921_3) and falls
// back through declarationNumbers → declarationNumber → the quiet label.
describe('CusShipmentRow — Chứng từ cell (SIL-502 regression)', () => {
  const documentsCell = (container: HTMLElement): HTMLElement =>
    container.querySelector('td[data-label="Chứng từ"]')!;

  it('renders every declaration number as its own line (SIL-532)', () => {
    const { container } = renderRow(makeItem({
      declarationNumber: '502UI-1',
      declarationNumbers: ['502UI-1', '502UI-2', '502UI-3'],
    }));
    // Each number is a separate element (its own grid row) — never one
    // joined run that a narrow column could break mid-number.
    expect(screen.getByText('502UI-1')).toBeTruthy();
    expect(screen.getByText('502UI-2')).toBeTruthy();
    expect(screen.getByText('502UI-3')).toBeTruthy();
    const cell = documentsCell(container);
    const numberLines = [...cell.querySelectorAll('span')].filter((el) => /^502UI-\d$/.test(el.textContent ?? ''));
    expect(numberLines).toHaveLength(3);
    expect(cell.textContent).not.toContain('Chưa có tờ khai');
  });

  it('still names the missing field when the lot carries no number', () => {
    const { container } = renderRow(makeItem({}));
    expect(documentsCell(container).textContent).toContain('Chưa có tờ khai');
  });

  it('falls back to declarationNumber when the union list is absent', () => {
    const item = makeItem({ declarationNumber: '502-TK-LEGACY' });
    // Simulate an older wire snapshot: the optional union key missing.
    delete (item as { declarationNumbers?: string[] }).declarationNumbers;
    const { container } = renderRow(item);
    expect(documentsCell(container).textContent).toContain('502-TK-LEGACY');
    expect(documentsCell(container).textContent).not.toContain('Chưa có tờ khai');
  });
});

// SIL-603 (id 706, owner 30/10): the schedule cell's facts stack one per line
// — the datetime keeps its own line, the factory name drops to the next line
// IN FULL — instead of the single `·`-packed run the FB-043 ellipsis law cut
// into "21:20 28/10/2026 · NEWEB…" on the workboard (SIL-515 wrap law).
describe('CusShipmentRow — SIL-603: lịch trình wrap tên nhà máy, cấm truncate', () => {
  const LONG_FACTORY = 'NEWEB - KHO 1 CÔNG TY TNHH NEWEB VIỆT NAM, Lô đất CN01, KCN Đồng Văn III';

  function itemWithGroup(factoryName: string | null) {
    const item = makeItem({ cargoMode: 'FCL', totalContainers: 2 });
    return {
      ...item,
      // 14:20Z = 21:20 ICT (+7) — the exact instant from the ticket screenshot.
      appointmentGroups: [{
        at: '2026-10-28T14:20:00.000Z',
        localDate: '2026-10-28',
        factoryName,
        containerSummary: '2x40HC',
      }],
    } as ShipmentCusWorkspaceListItem;
  }

  it('keeps the full long factory name in the DOM on its own line — nothing cut', () => {
    const { container } = renderRow(itemWithGroup(LONG_FACTORY));
    const cell = container.querySelector('td[data-label*="Lịch trình"]')!;
    // Every fact is fully present — the long name survives verbatim, never
    // clipped to "NEWEB…".
    expect(cell.textContent).toContain('21:20 28/10/2026');
    expect(cell.textContent).toContain(LONG_FACTORY);
    expect(cell.textContent).toContain('2x40HC');
    // One fact per line: the datetime and the factory are SEPARATE elements
    // (their own grid rows), so the wrap point exists before the name starts.
    expect(screen.getByText('21:20 28/10/2026').className).toBe('cus-schedule-group__when');
    expect(screen.getByText(LONG_FACTORY).className).toBe('cus-schedule-group__factory');
    expect(screen.getByText('2x40HC').className).toBe('cus-schedule-group__containers');
    // Hover keeps the joined line reachable.
    const group = container.querySelector('.cus-schedule-group')!;
    expect(group.getAttribute('title')).toBe(`21:20 28/10/2026 · ${LONG_FACTORY} · 2x40HC`);
  });

  it('renders no `·` separator between the facts in the cell DOM', () => {
    // SIL-517: a separator only exists to pack facts onto one line — the
    // packed line is the mechanism that truncated. The DOM (and with it copy/
    // screen-reader text) carries the facts back to back, no dot.
    const { container } = renderRow(itemWithGroup(LONG_FACTORY));
    const cell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(cell.textContent).not.toContain('·');
  });

  it('keeps the lot-fallback instant as its own uncut line', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      plannedReturnAt: '2026-10-28T17:00:00.000Z',
      transportDate: '2026-10-29',
    }));
    const fallback = container.querySelector('.cus-schedule-lot-fallback')!;
    expect(fallback.textContent).toBe('00:00 29/10/2026');
  });

  it('CSS pin: the schedule cell lines wrap — the FB-043 ellipsis law is revoked (SIL-515/SIL-603)', () => {
    const triggerRule = css.match(/td\[data-label='Lịch trình & điều xe'\] \.cus-inline-trigger > \*\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(triggerRule, 'the schedule trigger-child rule must exist').not.toBe('');
    expect(triggerRule).toContain('white-space: normal');
    expect(triggerRule).toContain('overflow-wrap: anywhere');
    expect(triggerRule).not.toContain('nowrap');
    expect(triggerRule).not.toContain('ellipsis');
    expect(triggerRule).not.toContain('overflow: hidden');
    // The group is the per-fact grid; its value spans clip at nothing.
    expect(css).toMatch(/\.cus-schedule-group\s*\{[^}]*display:\s*grid;/);
    const valueRule = css.match(/\.cus-schedule-group > span\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(valueRule, 'the schedule value-span rule must exist').not.toBe('');
    expect(valueRule).toContain('white-space: normal');
    expect(valueRule).toContain('overflow-wrap: anywhere');
    expect(valueRule).toContain('overflow: visible');
    expect(valueRule).not.toContain('nowrap');
    expect(valueRule).not.toContain('ellipsis');
    // Mobile keeps the per-fact grid even as the trigger's first child.
    expect(css).toMatch(/@media \(max-width: 999px\)\s*\{[\s\S]*?\.cus-dashboard-table \.cus-inline-trigger > \.cus-schedule-group\s*\{[^}]*display:\s*grid;/);
  });

  it('CSS pin: the workboard renders edge-to-edge — no shell gutter, no 1800px cap (owner 30/10)', () => {
    // The shell drops its inline gutter for this page…
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body:has\(> \.shipments-page--worksheet\)\s*\{[^}]*padding-inline:\s*0;/);
    // …the page re-owns the gutter for its controls and drops the ledger cap…
    const pageRule = css.match(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(pageRule, 'the worksheet page rule must exist').not.toBe('');
    expect(pageRule).toContain('max-width: none');
    expect(pageRule).toContain('padding-inline: max(var(--app-body-pad-x)');
    // …and the board (pagination included) bleeds past the gutter to both
    // screen edges — one level deeper than the page, on the chrome-free
    // worksheet wrapper.
    const bleedRule = css.match(/\.shipments-page--worksheet \.cus-workspace--worksheet\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bleedRule, 'the worksheet bleed rule must exist').not.toBe('');
    expect(bleedRule).toContain('margin-inline: calc(-1 * max(var(--app-body-pad-x)');
  });
});

// SIL-610 (id 713, owner 30/10): lô lẻ cũ (trước trường SIL-587) chỉ có
// expectedDeliveryDate nên tổng quan render date-only. Giờ thật duy nhất lô
// có là trên chuyến của lô — BE derive `derivedScheduleAt` (plannedStartAt
// "Giờ chạy", cùng ngày ICT với EDD). Ô lịch đọc nó trước ngày thuần; instant
// đã lưu vẫn thắng; FCL giữ luật đọc nghiêm (không bao giờ đọc derived).
describe('CusShipmentRow — SIL-610 (lô lẻ cũ có giờ từ dữ liệu chuyến)', () => {
  it('SIL-610-C4: renders the trip-derived datetime in ICT for a legacy LCL lot', () => {
    // 02:30Z = 09:30 ICT on 29/10.
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      customerName: 'YUANFANG',
      billOrBookNumber: 'K2K45235345634',
      transportDate: '2026-10-29',
      derivedScheduleAt: '2026-10-29T02:30:00.000Z',
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).toContain('09:30 29/10/2026');
    // No fabricated midnight: the cell never renders a bare "00:00" time.
    expect(scheduleCell.textContent).not.toContain('00:00');
  });

  it('SIL-610-C5: a stored instant still wins over the derived one', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      direction: 'IMPORT',
      transportDate: '2026-10-29',
      plannedReturnAt: '2026-10-29T08:45:00.000Z',
      derivedScheduleAt: '2026-10-29T02:30:00.000Z',
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).toContain('15:45 29/10/2026');
    expect(scheduleCell.textContent).not.toContain('09:30');
  });

  it('SIL-610-C5: legacy lot without a derived instant keeps the date-only day', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      transportDate: '2026-10-29',
      derivedScheduleAt: null,
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).toContain('29/10/2026');
    expect(/\d{2}:\d{2}/.test(scheduleCell.textContent)).toBe(false);
  });

  it('SIL-610-C5: FCL ignores the derived instant (strict per-container law holds)', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'FCL',
      direction: 'IMPORT',
      transportDate: '2026-10-29',
      derivedScheduleAt: '2026-10-29T02:30:00.000Z',
    }));
    const scheduleCell = container.querySelector('td[data-label*="Lịch trình"]')!;
    expect(scheduleCell.textContent).not.toContain('09:30');
  });
});
