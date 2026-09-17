import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForwarderContainersSection, ForwarderExpenseRow } from './forwarder-trip-detail-sections';

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

  it('shows a linked settlement as an existing record without implying pending approval', () => {
    renderRow({ activeSettlementId: 12, approvalStatus: 'RECORDED', settlementMethod: 'OPS_ADVANCE' });
    expect(screen.getByText('Đã lập phiếu')).toBeVisible();
    expect(screen.queryByText('Đã gửi kế toán')).not.toBeInTheDocument();
    expect(screen.getByText('Chi hộ tạm ứng')).toBeVisible();
  });

  it('labels company-direct and no-invoice records explicitly', () => {
    renderRow({ settlementMethod: 'COMPANY_DIRECT', invoiceNumber: null, invoiceDate: null });
    expect(screen.getByText('Công ty trả trực tiếp')).toBeTruthy();
    expect(screen.getByText('Không có hóa đơn')).toBeTruthy();
  });
});

describe('ForwarderContainersSection — add-form validation feedback', () => {
  const baseProps = {
    containers: [],
    show: true,
    setShow: () => {},
    form: { containerNumber: 'TCKU1234567', sealNumber: '', notes: '' },
    setForm: () => {},
    onAdd: vi.fn(),
    pending: false,
    selectedContainerId: '',
    onSelectContainer: () => {},
  };

  it('renders the check-digit error with the one-tap suggestion and preserves the input', () => {
    const onApplySuggestion = vi.fn();
    const { container } = render(
      <ForwarderContainersSection
        {...baseProps}
        error={{ message: 'Số cont sai chữ số kiểm tra — kiểm tra lại.', suggestion: 'TCKU1234560' }}
        onApplySuggestion={onApplySuggestion}
      />,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('chữ số kiểm tra');
    // The typed number stays in the input for correction.
    expect((container.querySelector('input.input') as HTMLInputElement).value).toBe('TCKU1234567');
    const suggestion = Array.from(container.querySelectorAll('button'))
      .find((button) => (button.textContent || '').includes('Dùng'));
    expect(suggestion?.textContent).toContain('TCKU1234560');
    fireEvent.click(suggestion!);
    expect(onApplySuggestion).toHaveBeenCalledTimes(1);
  });

  it('renders no alert when the controller reports no error', () => {
    const { container } = render(<ForwarderContainersSection {...baseProps} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
