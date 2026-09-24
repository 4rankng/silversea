import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsExpenseRow } from '../../api/opsClient';
import { OpsExpenseEditModal } from './OpsExpenseEditModal';

// QA-2026-09-24-09 (O4/F2): delete affordances announce DB ids to assistive
// tech — internal ids are never user-facing (internal-ids law). The labels
// must carry the business key (mã lô / fee name / position), never a row id.
const editModalSource = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsExpenseEditModal.tsx'), 'utf8');
const historySource = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsExpenseHistory.tsx'), 'utf8');
const forwarderSource = readFileSync(resolve(process.cwd(), 'src/features/forwarder/forwarder-trip-detail-sections.tsx'), 'utf8');

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), updateExpense: vi.fn(), deleteExpensePhoto: vi.fn(), attachExpensePhoto: vi.fn(), uploadExpensePhoto: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));

const entry: OpsExpenseRow = { id: 7, shipmentId: 8, shipmentCode: 'SHP-20260924-0099', containerNumber: null, expenseTypeCode: 'HANDLING', expenseTypeName: 'Làm hàng', requiresInvoice: false, amount: '123000', paidAt: '2026-09-24', note: null, approvalStatus: 'RECORDED', rejectionReason: null, opsSettlementId: null, hasPhoto: true, paidById: 12, paidByName: 'Ops', createdAt: '2026-09-24T00:00:00Z', version: 1 };

const photoRow = { id: 55123, storageKey: 'ops-expense-photos/12/abc.jpg', url: '/api/photos/x', uploadedAt: '2026-09-24T00:00:00Z' };

function showEdit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OpsExpenseEditModal entry={entry} onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getExpenseTypes.mockResolvedValue({ items: [{ id: 1, code: 'HANDLING', name: 'Làm hàng', requiresInvoice: false }] });
  api.getExpensePhotos.mockResolvedValue({ items: [photoRow] });
  api.deleteExpensePhoto.mockResolvedValue(null);
});

describe('delete affordances announce business keys, never DB ids (QA-2026-09-24-09 O4/F2)', () => {
  it('O4: the ops edit-modal photo delete button names the lot and the photo position, not photo.id', async () => {
    showEdit();
    const button = await screen.findByRole('button', { name: 'Xóa ảnh biên lai SHP-20260924-0099 · ảnh 1' });
    expect(button).toBeTruthy();
  });

  it('O4: the edit modal source never interpolates photo.id into an aria-label', () => {
    expect(editModalSource).not.toContain('Xóa ảnh biên lai ${photo.id}');
  });

  it('O4 sibling: ops history action buttons fall back to business keys, never row.id', () => {
    expect(historySource).not.toMatch(/aria-label=\{`[^`]*\?\? row\.id/);
    expect(historySource).toContain('row.shipmentCode ?? row.expenseTypeName');
  });

  it('F2: the forwarder expense delete affordance carries an aria-label, not only title', () => {
    expect(forwarderSource).toMatch(/aria-label=\{`Xóa chi phí [^`]+`\}/);
  });
});
