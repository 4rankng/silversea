/**
 * SIL-478 (2026-10-25) — the phone board is the verdict's grouped list:
 * line 1 the customer, line 2 the meta segments (Bill · ngày giao · n cont),
 * right side the Doanh thu money + the lock status chip on one baseline, and
 * the row tap — no per-row button — opens the detail.
 *
 * The laws this suite keeps alive across the rebuild:
 * - card 161026204709 (BD-01/BD-03): on a rev-merge pair the "Cước vận tải
 *   (Auto)" fact renders on the expanded FACE — Lô 1 = 100% lane price,
 *   member = 0₫ + "Ghép cước cùng Bill X" note — never nested inside a
 *   collapsed disclosure.
 * - Owner redesign 23/10 (spec v2 (c)), amended 24/10: money states are
 *   number | '0' | BLANK pending; 'Chưa xác định' stays gone.
 * - Owner redesign 23/10: the ticks are always on for a managing user, none
 *   read-only.
 * - SIL-478 P0: the payload CAN carry a null customer (LEFT JOIN miss) — the
 *   identity line renders '—', never blank.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ShipmentDebitWorkspace', () => ({ ShipmentDebitWorkspace: () => <div data-testid="workspace" /> }));

import { ShipmentDebitRecords } from './ShipmentDebitRecords';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';

const originalMedia = window.matchMedia;
/** jsdom has no viewport media engine; this is the browser API polyfill. */
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

const factRow = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerId: 1,
  customerName: 'KH A',
  factoryName: null,
  factoryAddress: null,
  billOrBookNumber: 'BL-1',
  customsNumber: null,
  documentsSummary: null,
  freightAuto: null,
  chiHoTotal: null,
  receivableTotal: null,
  payableTotal: null,
  profit: null,
  lockStatus: 'OPEN',
  lockedAt: null,
  cargoMode: 'LCL',
  costGroupId: null,
  costGroupOrder: null,
  revGroupId: null,
  revGroupOrder: null,
  costGroupMemberCount: null,
  revGroupMemberCount: null,
  actualTruckNo: null,
  billingTruckNo: null,
  costVehicleClassCode: null,
  revVehicleClassCode: null,
  revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
  ...over,
});

interface RenderOver {
  canManage?: boolean;
  selectedIds?: Set<number>;
  expandedId?: number | null;
  onSelect?: (id: number, next: boolean) => void;
  onToggle?: (id: number) => void;
}

function renderOnPhone(rows: ShipmentDebitLotRow[], over: RenderOver = {}) {
  viewport(390);
  return render(
    <ShipmentDebitRecords
      rows={rows} canManage={over.canManage ?? false}
      selectedIds={over.selectedIds ?? new Set()} expandedId={over.expandedId ?? null}
      onSelect={over.onSelect ?? vi.fn()} onToggle={over.onToggle ?? vi.fn()} onSaved={vi.fn()}
    />,
  );
}

/** The row's tap-to-expand control (SIL-478 (b): the row IS the toggle). */
function rowToggle(record: HTMLElement) {
  return within(record).getByRole('button', { name: /^Chi tiết / });
}

/** The expanded fact line for a label — fails if the label sits inside a
 *  nested disclosure (the F-2 lane law bans that nesting). */
async function factLine(record: HTMLElement, label: string) {
  const fact = within(record).getByText(label).closest<HTMLElement>('.ledger-glist__fact');
  expect(fact).not.toBeNull();
  expect(fact!.closest('details')).toBeNull();
  return fact!;
}

describe('SIL-478 — the grouped row face', () => {
  it('line 1 is the customer, line 2 the meta segments Bill · ngày giao · n cont', async () => {
    renderOnPhone([factRow({
      customerName: 'CÔNG TY TNHH LONG MINH',
      billOrBookNumber: 'HANGE4769700',
      deliveryDate: '2026-10-06',
      containerCount: 2,
    })]);
    const record = await screen.findByRole('article', { name: 'HANGE4769700' });
    const name = within(record).getByText('Công Ty Tnhh Long Minh');
    expect(name.classList.contains('ledger-glist__name')).toBe(true);
    const meta = within(record).getByText('HANGE4769700 · 06/10/2026 · 2 cont');
    expect(meta.classList.contains('ledger-glist__meta')).toBe(true);
  });

  it('P0 binding: a null customer renders —, never an empty identity line', async () => {
    renderOnPhone([factRow({ customerName: null })]);
    const record = await screen.findByRole('article', { name: 'BL-1' });
    const name = within(record).getByText('—');
    expect(name.classList.contains('ledger-glist__name')).toBe(true);
  });

  it('P0 binding: meta drops the segments the wire lacks, never fabricates 0 cont', async () => {
    renderOnPhone([factRow({ deliveryDate: null, containerCount: null })]);
    const record = await screen.findByRole('article', { name: 'BL-1' });
    expect(within(record).getByText('BL-1')).toBeTruthy();
    expect(within(record).queryByText(/cont/)).toBeNull();
    expect(within(record).queryByText(/·/)).toBeNull();

    renderOnPhone([factRow({ shipmentId: 102, billOrBookNumber: 'BL-2', containerCount: 0 })]);
    const bare = await screen.findByRole('article', { name: 'BL-2' });
    expect(within(bare).queryByText(/cont/)).toBeNull();
  });

  it('the status chip carries the verdict tones — Đang mở blue, Đã khóa neutral', async () => {
    renderOnPhone([
      factRow({ shipmentId: 111, billOrBookNumber: 'BL-OPEN' }),
      factRow({ shipmentId: 112, billOrBookNumber: 'BL-LOCKED', lockStatus: 'LOCKED' }),
    ]);
    const open = await screen.findByRole('article', { name: 'BL-OPEN' });
    const openChip = within(open).getByText('Đang mở');
    expect(openChip.getAttribute('data-tone')).toBe('open');
    const locked = await screen.findByRole('article', { name: 'BL-LOCKED' });
    const lockedChip = within(locked).getByText('Đã khóa');
    expect(lockedChip.getAttribute('data-tone')).toBe('neutral');
  });

  it('the Doanh thu money rides the row face with the board money states', async () => {
    renderOnPhone([factRow({ shipmentId: 204, billOrBookNumber: 'BL-N', receivableTotal: 4200000 })]);
    const record = await screen.findByRole('article', { name: 'BL-N' });
    const amount = record.querySelector('.ledger-glist__amount');
    expect(amount?.textContent).toContain('4.200.000');
    // Pending money renders BLANK (never a fabricated 0 / 'Chưa xác định').
    renderOnPhone([factRow({ shipmentId: 205, billOrBookNumber: 'BL-PENDING', receivableTotal: null })]);
    const pending = await screen.findByRole('article', { name: 'BL-PENDING' });
    expect(pending.querySelector('.ledger-glist__amount')?.textContent ?? '').toBe('');
    expect(screen.queryByText('Chưa xác định')).toBeNull();
  });

  it('the row tap opens the detail; a read-only tap shows facts, never the workspace', async () => {
    const onToggle = vi.fn();
    const first = renderOnPhone([factRow({ shipmentId: 301, billOrBookNumber: 'BL-TAP' })], { onToggle });
    const record = await screen.findByRole('article', { name: 'BL-TAP' });
    expect(screen.queryByTestId('workspace')).toBeNull();
    expect(within(record).queryByText('Tổng chi')).toBeNull();
    fireEvent.click(rowToggle(record));
    // The reader's expanded region is the remaining facts — no quyết toán lane.
    expect(within(record).getByText('Tổng chi')).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
    fireEvent.click(rowToggle(record));
    expect(within(record).queryByText('Tổng chi')).toBeNull();
    // Reader expansion is local — the manager lane stays untouched.
    expect(onToggle).not.toHaveBeenCalled();
    first.unmount();
  });

  it('the manager row tap drives the page-level expand lane', async () => {
    const onToggle = vi.fn();
    renderOnPhone([factRow({ shipmentId: 302, billOrBookNumber: 'BL-MGR' })], { canManage: true, onToggle });
    const record = await screen.findByRole('article', { name: 'BL-MGR' });
    fireEvent.click(rowToggle(record));
    expect(onToggle).toHaveBeenCalledWith(302);
    // …and the controlled expandedId mounts the detail + workspace.
    const second = renderOnPhone([factRow({ shipmentId: 303, billOrBookNumber: 'BL-MGR2' })], { canManage: true, onToggle, expandedId: 303 });
    const expanded = await screen.findByRole('article', { name: 'BL-MGR2' });
    expect(within(expanded).getByRole('button', { name: 'Chi tiết BL-MGR2' }).getAttribute('aria-expanded')).toBe('true');
    second.unmount();
  });
});

describe('BD-01 (161026204709) — the merged 100%/0₫ lane stays on the expanded face', () => {
  it('renders the principal lane price and the member 0₫ + reason, never nested in a disclosure', async () => {
    renderOnPhone([
      factRow({
        shipmentId: 201, billOrBookNumber: 'BL-P', code: 'SHP-26-0201',
        freightAuto: 3150000,
        revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2,
      }),
      factRow({
        shipmentId: 202, billOrBookNumber: 'BL-M', code: 'SHP-26-0202',
        freightAuto: 0,
        revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2,
        revGroupPrincipalRef: 'BL-P',
        freightOverrideReason: 'Ghép cước cùng Bill BL-P',
      }),
    ]);

    // Lô 1 = 100% lane price, no note (the un-marked principal carries none).
    const principal = await screen.findByRole('article', { name: 'BL-P' });
    fireEvent.click(rowToggle(principal));
    const principalLane = await factLine(principal, 'Cước vận tải (Auto)');
    expect(principalLane.textContent).toContain('3.150.000');
    expect(within(principal).queryByText('Ghép cước cùng Bill BL-P')).toBeNull();

    // Member = 0₫ + the spec §3.2 note under the money — both on the face.
    const member = await screen.findByRole('article', { name: 'BL-M' });
    fireEvent.click(rowToggle(member));
    const memberLane = await factLine(member, 'Cước vận tải (Auto)');
    expect(memberLane.textContent).toContain('0');
    const note = within(memberLane).getByText('Ghép cước cùng Bill BL-P');
    expect(note.tagName).toBe('SMALL');
    // GP-02 — the tag is one truncated line; its full text is the tooltip.
    expect(note.getAttribute('title')).toBe('Ghép cước cùng Bill BL-P');
    // Spec §3.2: the note rides BENEATH the money — never above it.
    expect(within(memberLane).getByText(/^0/).compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The rebuild removed the nested disclosure entirely — the lane can never
    // hide inside one again.
    expect(within(member).queryByText('Chi tiết')).toBeNull();
  });

  it('BD-03: a snapshot-channel row shows the money without any note', async () => {
    renderOnPhone([
      factRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203', freightAuto: 1234000 }),
    ]);
    const record = await screen.findByRole('article', { name: 'BL-S' });
    fireEvent.click(rowToggle(record));
    const lane = await factLine(record, 'Cước vận tải (Auto)');
    expect(lane.textContent).toContain('1.234.000');
    expect(within(record).queryByText(/Ghép cước/)).toBeNull();
  });

  // Owner redesign 23/10 — the ticks are ALWAYS on the phone rows for a
  // managing user (no on-demand mode left); a read-only user gets none.
  it('redesign 23/10: the row tick is always present for canManage, absent read-only', async () => {
    const rows = [factRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203' })];
    const onSelect = vi.fn();
    const first = renderOnPhone(rows, { onSelect });
    const record = await screen.findByRole('article', { name: 'BL-S' });
    expect(within(record).queryByRole('checkbox')).toBeNull();
    first.unmount();

    renderOnPhone(rows, { canManage: true, onSelect });
    const tick = await screen.findByRole('checkbox', { name: /Chọn BL-S/ });
    // Any lot is selectable: the ticks feed BOTH the merge and the Debit-Note
    // export (the old locked-only gate died with the always-on tick).
    fireEvent.click(tick);
    expect(onSelect).toHaveBeenCalledWith(203, true);
  });

  // The tick click must not ride the row tap (nested interactive law).
  it('SIL-478: ticking a row does not expand it', async () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    renderOnPhone([factRow({ shipmentId: 401, billOrBookNumber: 'BL-TICK' })], { canManage: true, onSelect, onToggle });
    const record = await screen.findByRole('article', { name: 'BL-TICK' });
    fireEvent.click(within(record).getByRole('checkbox', { name: 'Chọn BL-TICK' }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  // Owner redesign 23/10 (spec v2 (c)), amended 24/10 — the money facts carry
  // the board's states number | 0 | BLANK pending; 'Chưa xác định' stays gone.
  it('redesign 23/10 (c) + 24/10: money facts render number | 0 | blank — never "Chưa xác định"', async () => {
    renderOnPhone([
      factRow({ shipmentId: 204, billOrBookNumber: 'BL-N', code: 'SHP-26-0204', receivableTotal: 4200000, payableTotal: 0, profit: null }),
    ]);
    const record = await screen.findByRole('article', { name: 'BL-N' });
    // Doanh thu = the row face amount.
    expect(record.querySelector('.ledger-glist__amount')?.textContent).toContain('4.200.000');
    fireEvent.click(rowToggle(record));
    const payable = await factLine(record, 'Tổng chi');
    expect(within(payable).getByText('0')).toBeTruthy();
    expect(within(payable).getByText('0').getAttribute('title')).toBe('Phát sinh nhưng tổng bằng 0');
    const profit = await factLine(record, 'Lợi nhuận');
    expect(profit.querySelector('dd')?.textContent ?? '').toBe('');
    expect(screen.queryByText('Chờ số liệu')).toBeNull();
    expect(screen.queryByText('Chưa xác định')).toBeNull();
  });
});
