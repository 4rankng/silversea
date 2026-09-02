import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForwarderExpenseRow } from './forwarder-trip-detail-sections';

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tripId: 10,
    forwarderId: 4,
    expenseType: 'LIFTING',
    buyAmount: '1450000',
    sellAmount: '1450000',
    settlementMethod: 'FORWARDER_ADVANCE',
    supplierId: null,
    supplierName: null,
    containerNumber: 'MSBU1245657',
    tripContainerId: 7,
    activeSettlementId: null,
    canEdit: true,
    expenseDate: '2026-08-04',
    payeeName: 'Cảng Tân Vũ',
    invoiceNumber: 'HD-134584',
    invoiceDate: '2026-08-04',
    declarationNumber: null,
    approvalStatus: 'PENDING',
    note: null,
    noInvoiceEvidenceTypes: [],
    noInvoicePolicySnapshot: null,
    returnForEvidenceReason: null,
    returnedForEvidenceAt: null,
    createdAt: '2026-08-04T10:00:00Z',
    updatedAt: '2026-08-04T10:00:00Z',
    forwarderName: 'Nguyễn Văn Giao',
    ...overrides,
  };
}

function renderRow(overrides: Record<string, unknown> = {}) {
  return render(<ForwarderExpenseRow
    exp={expense(overrides) as never}
    expenseTypeOptions={[]}
    uploadingExpenseId={null}
    onUpload={vi.fn()}
    onEdit={vi.fn()}
    onDelete={vi.fn()}
    deletePending={false}
    onLoadPhotos={vi.fn()}
  />);
}

describe('ForwarderExpenseRow bill ledger metadata', () => {
  it('shows container, full amount, advance settlement method, and invoice facts', () => {
    renderRow();
    expect(screen.getByText('MSBU1245657')).toBeTruthy();
    expect(screen.getByText('1.450.000 ₫')).toBeTruthy();
    expect(screen.getByText('Chi hộ tạm ứng')).toBeTruthy();
    expect(screen.getByText('HD-134584')).toBeTruthy();
    expect(screen.getByText('4/8/2026')).toBeTruthy();
  });

  it('labels company-direct and no-invoice records explicitly', () => {
    renderRow({ settlementMethod: 'COMPANY_DIRECT', invoiceNumber: null, invoiceDate: null });
    expect(screen.getByText('Công ty trả trực tiếp')).toBeTruthy();
    expect(screen.getByText('Không có hóa đơn')).toBeTruthy();
  });
});
