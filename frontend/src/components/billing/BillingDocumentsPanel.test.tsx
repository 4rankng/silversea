import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingDocument } from '@tingting/shared';
import BillingDocumentsPanel from './BillingDocumentsPanel';

const { listBillingDocuments, confirmFn } = vi.hoisted(() => ({
  listBillingDocuments: vi.fn(),
  confirmFn: vi.fn(),
}));
vi.mock('../../api/financialClient', () => ({
  financialClient: {
    listBillingDocuments,
    deleteBillingDocument: vi.fn(),
    getBillingDocumentExportUrl: (id: number) => `/api/finance/billing-documents/${id}/export`,
  },
}));
vi.mock('../../lib/api', () => ({ api: { getBlob: vi.fn() } }));
vi.mock('../shared/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../UI', () => ({ useConfirm: () => ({ confirm: confirmFn, dialog: null }) }));

function doc(overrides: Partial<BillingDocument>): BillingDocument {
  return {
    id: 25,
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: 1,
    entityName: 'Khách A',
    rangeFrom: '2026-11-01',
    rangeTo: '2026-11-15',
    note: null,
    totalInclVat: 8536320,
    originalDueDate: '2026-12-15',
    processingDueDate: '2026-12-16',
    createdAt: '2026-11-20T03:00:00.000Z',
    updatedAt: '2026-11-23T04:30:00.000Z',
    lines: [],
    ...overrides,
  } as BillingDocument;
}

const docs: BillingDocument[] = [
  doc({ id: 25, debitNoteStatus: null, issuedAt: null, updatedAt: '2026-11-20T03:00:00.000Z' }),
  doc({
    id: 26,
    debitNoteStatus: 'SENT',
    issuedAt: '2026-11-21T02:00:00.000Z',
    arBalanceBefore: 52040480,
    arBalanceAfter: 60576800,
  }),
  doc({
    id: 27,
    debitNoteStatus: 'CANCELED',
    issuedAt: '2026-11-21T02:00:00.000Z',
    arBalanceBefore: 60576800,
    arBalanceAfter: 52040480,
  }),
];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BillingDocumentsPanel
        type="DEBIT_NOTE"
        entityType="CUSTOMER"
        entityId={1}
        entityName="Khách A"
        buttonLabel="Tạo giấy báo nợ"
      />
    </QueryClientProvider>,
  );
}

function rowOf(noteNumber: string): HTMLElement {
  const cell = screen.getByText(noteNumber);
  const row = cell.closest('.billing-panel__row');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  listBillingDocuments.mockResolvedValue(docs);
});

describe('Giấy báo nợ history cards', () => {
  it('shows the note number, status label, and issue/cancel date on every card', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));

    const sent = within(rowOf('#26'));
    expect(sent.getByText('Đã phát hành')).toBeTruthy();
    expect(sent.getByText('Phát hành ngày 21/11/2026')).toBeTruthy();

    const canceled = within(rowOf('#27'));
    expect(canceled.getByText('Đã hủy')).toBeTruthy();
    expect(canceled.getByText('Hủy ngày 23/11/2026')).toBeTruthy();

    const draft = within(rowOf('#25'));
    expect(draft.getByText('Nháp')).toBeTruthy();
    expect(draft.queryByText(/Phát hành ngày/)).toBeNull();
  });

  it('shows the cumulative-debt change the note reconciled (before → after, +delta)', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));

    expect(within(rowOf('#26')).getByText(
      'Công nợ cộng dồn 52.040.480 ₫ → 60.576.800 ₫ (+8.536.320 ₫)',
    )).toBeTruthy();
    expect(within(rowOf('#27')).getByText(
      'Công nợ cộng dồn 60.576.800 ₫ → 52.040.480 ₫ (-8.536.320 ₫)',
    )).toBeTruthy();
    expect(within(rowOf('#25')).queryByText(/Công nợ cộng dồn/)).toBeNull();
  });

  it('blocks edit and delete on issued/canceled notes while drafts stay editable', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Xem lịch sử/ }));

    expect(within(rowOf('#25')).getByRole('button', { name: 'Sửa' })).toBeTruthy();
    expect(within(rowOf('#25')).getByRole('button', { name: 'Xóa' })).toBeTruthy();

    for (const issued of ['#26', '#27']) {
      const row = within(rowOf(issued));
      expect(row.queryByRole('button', { name: 'Sửa' })).toBeNull();
      expect(row.queryByRole('button', { name: 'Xóa' })).toBeNull();
      expect(row.getByText('Chỉ đọc')).toBeTruthy();
      expect(row.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy();
    }
  });
});
