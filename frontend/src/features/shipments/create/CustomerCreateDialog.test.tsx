import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueries = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueries }),
  };
});

vi.mock('../../../api/configClient', () => ({
  configClient: {
    createCustomer: vi.fn().mockResolvedValue({ id: 7, name: 'Nhà xe A' }),
  },
}));

import { CustomerCreateDialog } from './CustomerCreateDialog';
import { qk } from '../../../api/keys';

// A just-created carrier/customer must be selectable in every catalog-fed
// dropdown (trip reassign, dispatch editor) immediately — the bootstrap
// blob never refreshes on in-session navigation otherwise.
describe('CustomerCreateDialog', () => {
  beforeEach(() => {
    invalidateQueries.mockClear();
  });

  it('refreshes the catalog dropdowns after creating a customer', async () => {
    const onCreated = vi.fn();
    render(<CustomerCreateDialog isOpen onClose={() => {}} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Tên khách hàng'), { target: { value: 'Nhà xe A' } });
    fireEvent.keyDown(document, { key: 'Enter' });

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.catalogs.all }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
  });

  it('does not create when the name is empty', async () => {
    render(<CustomerCreateDialog isOpen onClose={() => {}} onCreated={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(screen.getByText('Vui lòng nhập tên khách hàng.')).toBeTruthy();
  });
});
