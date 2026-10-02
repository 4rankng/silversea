import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '@tingting/shared';

const { getDebitNoteTemplates, authState } = vi.hoisted(() => ({
  getDebitNoteTemplates: vi.fn(),
  authState: { role: 'ACCOUNTANT' },
}));

vi.mock('../../api/configClient', () => ({
  configClient: { getDebitNoteTemplates },
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: authState.role } }),
}));

import { CustomerForm } from './CustomerForm';

function renderForm(item?: Customer) {
  const onsave = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <CustomerForm item={item} saving={false} onsave={onsave} oncancel={vi.fn()} />
  </QueryClientProvider>);
  return onsave;
}

describe('customer form template access', () => {
  beforeEach(() => {
    authState.role = 'ACCOUNTANT';
    getDebitNoteTemplates.mockReset().mockResolvedValue([{ id: 7, name: 'Mẫu kế toán', isDefault: false }]);
  });

  it.each(['CUS', 'DISPATCHER'])('does not read templates as %s and preserves an existing selection', async (role) => {
    authState.role = role;
    const onsave = renderForm({ id: 1, name: 'Khách hàng', debitNoteTemplateId: 7 } as Customer);
    expect(screen.getByText('Mẫu giấy báo nợ do bộ phận kế toán quản lý.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mẫu giấy báo nợ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ debitNoteTemplateId: 7 })));
    expect(getDebitNoteTemplates).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'MANAGER', 'ACCOUNTANT'])('loads template options for %s', async (role) => {
    authState.role = role;
    renderForm();
    await waitFor(() => expect(getDebitNoteTemplates).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Mẫu giấy báo nợ/ }));
    expect(await screen.findByRole('option', { name: 'Mẫu kế toán' })).toBeInTheDocument();
  });
});
