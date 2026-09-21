import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PayablesTable } from './ShipmentDebitTables';
import type { ShipmentDebitDetail } from '../../../api/shipmentClient';

const detail = (rowOver: Record<string, unknown> = {}): ShipmentDebitDetail => ({
  freightRows: [{
    containerNumber: 'QATU1234569',
    containerTypeLabel: "20'DC",
    tripId: 601,
    rateKey: null,
    freightCharge: 45e5,
    fuelSurcharge: 0,
    customsFee: 250000,
    contractFreightTotal: null,
    psActual: null,
    psActualNote: null,
    ...rowOver,
  }],
  chiHoRows: [],
  payables: { chiHoTotal: null },
  thuKhachTotal: null,
});

describe('PayablesTable (Bảng 2.3) reads the wire', () => {
  it('renders the per-container HQGS fee instead of a hardcoded unknown', () => {
    render(<PayablesTable detail={detail()} />);
    const row = screen.getByText('QATU1234569').closest('tr');
    // The HQGS cell reads the wire; cells without data keep the honest null
    // render — the bug was the whole row hardcoding the unknown string.
    expect(row?.textContent).toContain('250.000');
  });

  it('renders per-container payable freight and phat-sinh fee from the wire', () => {
    render(<PayablesTable detail={detail({ payableFreight: 8e6, phatSinhFee: 90000 })} />);
    const row = screen.getByText('QATU1234569').closest('tr');
    expect(row?.textContent).toContain('8.000.000');
    expect(row?.textContent).toContain('90.000');
  });

  it('keeps Chưa xác định when the container has no data', () => {
    render(<PayablesTable detail={detail({
      customsFee: null,
      payableFreight: null,
      phatSinhFee: null,
    })} />);
    const row = screen.getByText('QATU1234569').closest('tr');
    expect(row?.textContent).toContain('Chưa xác định');
  });
});
