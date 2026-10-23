/**
 * card 161026204709 — phone record law for the F-2 lane (read-helper commit
 * b859d0b8): on a rev-merge pair the "Cước vận tải (Auto)" fact renders on
 * the CARD FACE — Lô 1 = 100% lane price, member = 0₫ + "Ghép cước cùng
 * Bill X" note — never inside the collapsed 'Chi tiết' disclosure.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ShipmentDebitWorkspace', () => ({ ShipmentDebitWorkspace: () => null }));

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

/** The card-face fact for a label — fails if the label only exists in 'Chi tiết'. */
function laneFact(record: HTMLElement, label: string) {
  const fact = within(record).getByText(label).closest<HTMLElement>('.ledger-record__fact');
  expect(fact).not.toBeNull();
  expect(fact!.closest('details')).toBeNull();
  return fact!;
}

function renderOnPhone(rows: ShipmentDebitLotRow[], over: Partial<Parameters<typeof ShipmentDebitRecords>[0]> = {}) {
  viewport(390);
  return render(
    <ShipmentDebitRecords
      rows={rows} canManage={false} mergeMode={false} selectedIds={new Set()} expandedId={null}
      onSelect={vi.fn()} onToggle={vi.fn()} onSaved={vi.fn()}
      {...over}
    />,
  );
}

describe('BD-01 (161026204709) — the merged 100%/0₫ lane stays on the card face', () => {
  it('renders the principal lane price and the member 0₫ + reason outside the Chi tiết disclosure', async () => {
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
    const principalLane = laneFact(principal, 'Cước vận tải (Auto)');
    expect(principalLane.textContent).toContain('3.150.000');
    expect(within(principal).queryByText('Ghép cước cùng Bill BL-P')).toBeNull();

    // Member = 0₫ + the spec §3.2 note under the money — both on the face.
    const member = await screen.findByRole('article', { name: 'BL-M' });
    const memberLane = laneFact(member, 'Cước vận tải (Auto)');
    expect(memberLane.textContent).toContain('0');
    const note = within(memberLane).getByText('Ghép cước cùng Bill BL-P');
    expect(note.tagName).toBe('SMALL');
    // Spec §3.2: the note rides BENEATH the money — never above it.
    expect(within(memberLane).getByText(/^0/).compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.closest('details')).toBeNull();

    // The disclosure still exists for the sibling facts — but the lane is
    // never inside it.
    const details = within(member).getByText('Chi tiết').closest('details');
    expect(details).not.toBeNull();
    expect(within(details!).queryByText('Cước vận tải (Auto)')).toBeNull();
    expect(within(details!).queryByText('Ghép cước cùng Bill BL-P')).toBeNull();
  });

  it('BD-03: a snapshot-channel row shows the money without any note', async () => {
    renderOnPhone([
      factRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203', freightAuto: 1234000 }),
    ]);
    const record = await screen.findByRole('article', { name: 'BL-S' });
    const lane = laneFact(record, 'Cước vận tải (Auto)');
    expect(lane.textContent).toContain('1.234.000');
    expect(within(record).queryByText(/Ghép cước/)).toBeNull();
  });

  // Spec 23/10 (261023110000 §2) — the phone cards read the on-demand law
  // too: no tick while the mode is off, every lot tickable once it's on.
  it('spec 23/10 §2: the card tick exists only while the [📦 Gộp hàng] mode is on', async () => {
    const rows = [factRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203' })];
    const onSelect = vi.fn();
    const first = renderOnPhone(rows, { canManage: true, onSelect });
    const record = await screen.findByRole('article', { name: 'BL-S' });
    expect(within(record).queryByRole('checkbox')).toBeNull();
    first.unmount();

    renderOnPhone(rows, { canManage: true, mergeMode: true, onSelect });
    const tick = await screen.findByRole('checkbox', { name: /Chọn BL-S/ });
    // Any lot is selectable once the mode is on: the ticks feed BOTH the
    // merge and the Debit-Note export (the old locked-only gate died with
    // the always-on tick).
    fireEvent.click(tick);
    expect(onSelect).toHaveBeenCalledWith(203, true);
  });
});
