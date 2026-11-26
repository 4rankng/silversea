// SIL-1063 — /shipments phone card (≤999px): the Bill/Booking code is ONE
// token (KB Ch.10 §10.8.1: "mã/biển số xe/số điện thoại giữ nguyên cụm").
// The generic `overflow-wrap: anywhere` on the card's fact cells offered
// breaks INSIDE the token, so "W4A-K313-01" shattered into "W4A-" /
// "K313-01" at 360px. The code keeps normal wrapping: it moves whole to its
// own line instead. Codes longer than the 16-char shape the half-cell admits
// carry `cus-documents-cell--wide-code` and take the whole card width — a
// nowrap token in a too-narrow track paints over the neighbouring cell (the
// SIL-1059 fixed-grid warning), so the track grows instead. The desktop
// table keeps its own SIL-794 column ladder untouched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CusShipmentRow } from './CusShipmentRow';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

function mediaBody(query: string): string {
  const match = css.match(new RegExp(`@media \\(max-width:\\s*${query}px\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  expect(match, `expected the (max-width: ${query}px) band`).toBeTruthy();
  return match![1];
}

const access = (mode: string) => ({ mode, reason: `reason:${mode}` });

function makeItem(billOrBookNumber: string | null): ShipmentCusWorkspaceListItem {
  return {
    id: 7,
    version: 3,
    bucket: 'NEW',
    bucketLabel: 'Mới',
    cargoMode: 'LCL',
    direction: 'IMPORT',
    customerName: 'LONG MINH',
    routeName: 'Vân Trung, Bắc Ninh',
    deliveryLocation: null,
    effectiveFactoryNames: [],
    factoryName: 'Factory A',
    isAdHoc: false,
    billOrBookNumber,
    declarationNumber: null,
    declarationNumbers: [],
    shippingLineName: null,
    isCombined: false,
    containerSummary: '',
    weightKg: '1200',
    volumeCbm: null,
    packageCount: 12,
    packageType: 'Pallet',
    customerNotes: null,
    operationalNotes: null,
    appointmentGroups: [],
    transportDate: null,
    closingAt: null,
    plannedReturnAt: null,
    derivedScheduleAt: null,
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
      scheduleReadiness: 'READY',
      vehicleReadiness: 'READY',
      totalContainers: 0,
      assignedContainers: 0,
      externalContainers: 0,
      plateAssignedContainers: 0,
      missingCarrierContainers: 0,
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
  // Thin-cast fixture precedent (CusShipmentRow.cus-cards.test.tsx): the
  // row reads a handful of fields; the shared list type carries many more.
  } as unknown as ShipmentCusWorkspaceListItem;
}

function renderRow(item: ShipmentCusWorkspaceListItem) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <CusShipmentRow
            item={item}
            dateFrom=""
            dateTo=""
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

describe('SIL-1063 — the phone card never breaks the Bill/Booking token', () => {
  it('keeps the mono code token whole inside the ≤999px card band', () => {
    const band = mediaBody('999');
    const rule = band.match(
      /\.cus-dashboard-table \.cus-multiline-cell--mono strong\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(rule, 'card mono code rule exists').not.toBe('');
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/overflow-wrap:\s*normal/);
    expect(rule).toMatch(/word-break:\s*normal/);
    // The no-truncation doctrine (§10.8.1, SIL-1059 pin) bans clip/ellipsis.
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).not.toMatch(/overflow:\s*hidden/);
  });

  it('gives flagged wide codes the whole card width, inside the card band only', () => {
    const band = mediaBody('999');
    const rule = band.match(
      /\.cus-dashboard-table tbody > tr > td\.cus-documents-cell--wide-code\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(rule, 'wide-code span rule exists').not.toBe('');
    expect(rule).toMatch(/grid-column:\s*1 \/ -1/);
    // The flag exists exactly once — inside the ≤999px band, never as a
    // desktop-band rule (the SIL-794 percentage ladder stays untouched).
    const everywhere = [...css.matchAll(/td\.cus-documents-cell--wide-code/g)];
    expect(everywhere).toHaveLength(1);
    expect(css).toMatch(/col\.cus-dashboard-col--documents \{ width: 13\.35%; \}/);
  });

  it.each([
    { code: 'W4A-K313-01', wide: false, why: 'the ticket token stays a half-cell fact' },
    { code: 'EGLV149607019409', wide: false, why: 'exactly the 16-char shape the cell admits' },
    { code: 'MSCU851REPRO002-UIR4', wide: true, why: '21-char code would overflow the half-cell' },
    { code: null, wide: false, why: 'the placeholder text is not a code' },
  ])('code $code → wide-code flag $wide ($why)', ({ code, wide }) => {
    const { container } = renderRow(makeItem(code));
    const cell = container.querySelector('td[data-label="Chứng từ"]')!;
    expect(cell.className.includes('cus-documents-cell--wide-code')).toBe(wide);
  });
});
