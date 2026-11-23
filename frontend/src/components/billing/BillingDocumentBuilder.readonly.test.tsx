import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingDocument, BillingDocumentLine } from '@tingting/shared';
import BillingDocumentBuilder from './BillingDocumentBuilder';

const { getBlob, updateBillingDocument, saveBillingDocument, getDebitNoteTemplates } = vi.hoisted(() => ({
  getBlob: vi.fn(),
  updateBillingDocument: vi.fn(),
  saveBillingDocument: vi.fn(),
  getDebitNoteTemplates: vi.fn(),
}));
vi.mock('../../api/configClient', () => ({ configClient: { getDebitNoteTemplates } }));
vi.mock('../../api/financialClient', () => ({
  financialClient: {
    updateBillingDocument,
    saveBillingDocument,
    issueBillingDocument: vi.fn(),
    getBillingDocumentExportUrl: (id: number, templateId?: number | null) =>
      `/api/finance/billing-documents/${id}/export${templateId ? `?templateId=${templateId}` : ''}`,
  },
}));
vi.mock('../../lib/api', () => ({ api: { getBlob } }));
vi.mock('../shared/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const freightLine = {
  id: 1,
  documentId: 27,
  sourceType: 'TRIP',
  sourceId: 9001,
  lineType: 'FREIGHT',
  typeLabel: 'Cước vận chuyển',
  unit: 'cont',
  description: 'Cước vận chuyển',
  routeName: 'HP-HCM',
  containerNumbers: ['TSTU1234567'],
  baseAmount: 8536320,
  amountOverride: null,
  excluded: false,
  sortOrder: 0,
  vatTreatment: 'STANDARD',
  vatRate: 0,
  netAmount: 8536320,
  taxAmount: 0,
  grossAmount: 8536320,
} as BillingDocumentLine;

const issuedDoc = {
  id: 27,
  version: 2,
  type: 'DEBIT_NOTE',
  entityType: 'CUSTOMER',
  entityId: 1,
  entityName: 'Khách A',
  rangeFrom: '2026-11-01',
  rangeTo: '2026-11-15',
  note: null,
  totalInclVat: 8536320,
  debitNoteStatus: 'SENT',
  issuedAt: '2026-11-21T02:00:00.000Z',
  createdAt: '2026-11-20T03:00:00.000Z',
  updatedAt: '2026-11-21T02:00:00.000Z',
  lines: [freightLine],
} as BillingDocument;

function setup(initialDoc: BillingDocument) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BillingDocumentBuilder
        isOpen
        onClose={() => {}}
        type="DEBIT_NOTE"
        entityType="CUSTOMER"
        entityId={1}
        entityName="Khách A"
        initialDoc={initialDoc}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getDebitNoteTemplates.mockResolvedValue([]);
  getBlob.mockResolvedValue(new Blob(['x']));
  window.URL.createObjectURL = vi.fn(() => 'blob:mock');
  window.URL.revokeObjectURL = vi.fn();
});

describe('Giấy báo nợ editor', () => {
  it('shows the note number and lifecycle status on the editor title', () => {
    setup(issuedDoc);
    const docNum = screen.getByText('#27');
    const heading = docNum.closest('h2');
    expect(heading?.textContent).toContain('Giấy báo nợ #27');
    expect(screen.getByText('Đã phát hành')).toBeTruthy();
  });

  it('exports an issued note as read-only — never persists against it', async () => {
    setup(issuedDoc);
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    await waitFor(() => expect(getBlob).toHaveBeenCalledWith('/api/finance/billing-documents/27/export'));
    expect(updateBillingDocument).not.toHaveBeenCalled();
    expect(saveBillingDocument).not.toHaveBeenCalled();
  });

  it('renders the read-only view header: eyebrow, issue date, and cumulative-debt line', () => {
    setup({ ...issuedDoc, arBalanceBefore: 103067000, arBalanceAfter: 103067000 });
    expect(screen.getByText('Xem tài liệu — chỉ đọc')).toBeTruthy();
    expect(screen.getByText('Phát hành ngày 21/11/2026')).toBeTruthy();
    expect(screen.getByText(/Công nợ cộng dồn 103\.067\.000 ₫ → 103\.067\.000 ₫ \(0 ₫\)/)).toBeTruthy();
  });

  it('renders the cancel date on a canceled note and no issue wording', () => {
    setup({ ...issuedDoc, debitNoteStatus: 'CANCELED', updatedAt: '2026-11-23T04:30:00.000Z' });
    expect(screen.getByText('Hủy ngày 23/11/2026')).toBeTruthy();
    expect(screen.queryByText(/Phát hành ngày/)).toBeNull();
  });

  it('disables every mutating control on a locked note and hides the issue section', () => {
    setup(issuedDoc);
    expect(screen.getByRole('button', { name: /Lọc lại/ }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Ghi chú' }) as HTMLTextAreaElement).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Phát hành' })).toBeNull();
  });
});
