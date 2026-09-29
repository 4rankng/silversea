import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AccountingTransportRegisterRow } from '@tingting/shared';
import { AccountingTransportRegister } from './AccountingTransportRegister';

/** Card 20260929_207 — the checkbox column is gone; the row IS the control.
 *  These cases pin the behaviour that replaced it: what picks a trip, what must
 *  NOT pick it, which rows may be picked at all, and exactly which rows the
 *  batch draft consumes. */

const row = (over: Partial<AccountingTransportRegisterRow> = {}): AccountingTransportRegisterRow => ({
  financialPostingId: over.tripId ?? 1,
  financialPostingVersion: 1,
  financialPostingEffectiveAt: '2026-08-01T00:00:00.000Z',
  tripId: 1,
  tripCode: 'C-001',
  completionDate: '2026-08-01',
  customerId: 5,
  customerName: 'Silver Sea',
  carrierId: null,
  carrierName: null,
  ownership: 'OWN',
  shipmentId: 8,
  shipmentCode: 'S-008',
  routeId: 2,
  routeName: 'Cát Lái - Long An',
  factoryName: null,
  containerNumbers: ['TGHU1234567'],
  containerTypes: ['40HC'],
  plateNumber: '51D-123.45',
  revenue: '40000000',
  directCost: '25000000',
  carrierPayable: '0',
  profit: '15000000',
  readiness: {
    status: 'READY',
    acceptedPodSubmissionId: 11,
    acceptedPodVersion: 2,
    acceptedPodAt: '2026-08-01T00:00:00.000Z',
    profitabilitySnapshotId: 17,
    evidence: ['COMPLETED_TRIP'],
  },
  ...over,
});

const missingProfitability = {
  status: 'MISSING_PROFITABILITY_SNAPSHOT',
  acceptedPodSubmissionId: null,
  acceptedPodVersion: null,
  acceptedPodAt: null,
  profitabilitySnapshotId: null,
  evidence: [] as string[],
} as const;

function renderRegister(rows: AccountingTransportRegisterRow[]) {
  return render(
    <MemoryRouter>
      <AccountingTransportRegister
        rows={rows}
        total={rows.length}
        totalPages={1}
        fingerprint={'a'.repeat(64)}
        page={1}
        search=""
        customerId=""
        carrierId=""
        customers={[]}
        carriers={[]}
        ownership=""
        readiness=""
        selectionScopeKey="scope-1"
        loading={false}
        error={false}
        sort={null}
        onSortChange={() => {}}
        onSearchChange={() => {}}
        onFilterChange={() => {}}
        onSearch={() => {}}
        onPageChange={() => {}}
        onRetry={() => {}}
        onReset={() => {}}
        onResetSecondary={() => {}}
      />
    </MemoryRouter>,
  );
}

const bodyRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.accounting-register__table tbody tr')] as HTMLTableRowElement[];

const draftHref = () => decodeURIComponent(
  screen.getByRole('link', { name: 'Tạo bản nháp giấy báo nợ' }).getAttribute('href') ?? '',
);

describe('card 20260929_207 — row selection replaces the checkbox column', () => {
  it('ships no checkbox anywhere in the register', () => {
    const { container } = renderRegister([row()]);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('picks a trip on click and unpicks it on a second click', () => {
    const { container } = renderRegister([row()]);
    const [first] = bodyRows(container);

    expect(first).not.toHaveAttribute('data-selected');
    fireEvent.click(within(first).getByText('C-001'));
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Đã chọn 1 chuyến của Silver Sea')).toBeTruthy();

    fireEvent.click(within(first).getByText('C-001'));
    expect(first).not.toHaveAttribute('data-selected');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('link', { name: 'Tạo bản nháp giấy báo nợ' })).toBeNull();
  });

  it('picks the focused trip from the keyboard', () => {
    const { container } = renderRegister([row()]);
    const [first] = bodyRows(container);

    expect(first).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(first, { key: ' ' });
    expect(first).toHaveAttribute('data-selected', 'true');
  });

  // The row's own control must run THAT control: one press on `Công nợ` opens
  // the debt note and must not also queue the trip into a batch draft.
  it('does not pick the trip when the press lands on the row’s own link', () => {
    const { container } = renderRegister([row()]);
    const [first] = bodyRows(container);

    const debtLink = within(first).getByRole('link', { name: 'Công nợ' });
    expect(debtLink.getAttribute('href')).toBe('/debt/5');
    fireEvent.click(debtLink);
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('leaves a trip that is not financially ready inert', () => {
    const { container } = renderRegister([row({ readiness: missingProfitability })]);
    const [first] = bodyRows(container);

    expect(first).toHaveClass('accounting-register__row--locked');
    expect(first).not.toHaveAttribute('tabindex');
    expect(first).not.toHaveAttribute('aria-selected');
    fireEvent.click(within(first).getByText('C-001'));
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('picks every ready trip of the page scope from the strip, and only those', () => {
    const { container } = renderRegister([
      row({ tripId: 9, tripCode: 'C-009' }),
      row({ tripId: 11, tripCode: 'C-011' }),
      row({ tripId: 12, tripCode: 'C-012', readiness: missingProfitability }),
    ]);
    const [ready, alsoReady, locked] = bodyRows(container);

    fireEvent.click(screen.getByRole('button', { name: /Chọn cả trang này \(2 chuyến của Silver Sea\)/ }));

    expect(ready).toHaveAttribute('data-selected', 'true');
    expect(alsoReady).toHaveAttribute('data-selected', 'true');
    expect(locked).not.toHaveAttribute('data-selected');
    expect(screen.getByText('Đã chọn 2 chuyến của Silver Sea')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn dòng trang này' }));
    expect(bodyRows(container)[0]).not.toHaveAttribute('data-selected');
  });

  it('feeds the batch draft with exactly the picked trips', () => {
    const { container } = renderRegister([
      row({ tripId: 9, tripCode: 'C-009', completionDate: '2026-08-01' }),
      row({ tripId: 11, tripCode: 'C-011', completionDate: '2026-08-04' }),
    ]);
    const [first, second] = bodyRows(container);

    fireEvent.click(within(first).getByText('C-009'));
    fireEvent.click(within(second).getByText('C-011'));
    expect(draftHref()).toBe('/debt/5/billing/new?selectedTripIds=9,11&from=2026-08-01&to=2026-08-04');

    fireEvent.click(within(first).getByText('C-009'));
    expect(draftHref()).toBe('/debt/5/billing/new?selectedTripIds=11&from=2026-08-04&to=2026-08-04');
  });

  // A draft is raised against ONE customer, so picking a trip of another
  // customer replaces the selection instead of filing it under the wrong
  // customer's debt note.
  it('replaces the selection when the picked trip belongs to another customer', () => {
    const { container } = renderRegister([
      row({ tripId: 9, tripCode: 'C-009', customerId: 5, customerName: 'Silver Sea' }),
      row({ tripId: 21, tripCode: 'C-021', customerId: 6, customerName: 'Hải Bình' }),
    ]);
    const [first, second] = bodyRows(container);

    fireEvent.click(within(first).getByText('C-009'));
    fireEvent.click(within(second).getByText('C-021'));

    expect(first).not.toHaveAttribute('data-selected');
    expect(second).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Đã chọn 1 chuyến của Hải Bình')).toBeTruthy();
    expect(draftHref()).toContain('/debt/6/billing/new?selectedTripIds=21');
  });
});
