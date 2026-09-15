import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useTemplateLeaveGuard } from './use-template-leave-guard';
import { requestAppNavigation } from '../../lib/app-navigation';
function Editor({ confirm, saving = false }: { confirm: (message: string) => Promise<boolean>; saving?: boolean }) {
  const back = useTemplateLeaveGuard({ dirty: true, saving, confirm, onBack: vi.fn() });
  const location = useLocation();
  const navigate = useNavigate();
  return <><input aria-label="Draft" defaultValue="Keep this column title" /><a href="/config/customers">Customers</a><button onClick={() => requestAppNavigation('/trips', () => navigate('/trips'))}>Sidebar trips</button><button onClick={() => void back()}>Back</button><output>{location.pathname}</output></>;
}
function setup(confirm: (message: string) => Promise<boolean>, saving = false) {
  return render(<MemoryRouter initialEntries={['/config/debit-note-templates/new']}><Editor confirm={confirm} saving={saving} /></MemoryRouter>);
}
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
describe('template draft navigation', () => {
  it('retains the draft when a link navigation is canceled and follows an explicitly accepted link', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    setup(confirm);
    fireEvent.click(screen.getByText('Customers'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue('Keep this column title')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('/config/debit-note-templates/new');
    fireEvent.click(screen.getByText('Customers'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/config/customers'));
  });
  it('guards the real sidebar button navigation contract before invoking its route callback', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    setup(confirm);
    fireEvent.click(screen.getByText('Sidebar trips'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('/config/debit-note-templates/new');
    fireEvent.click(screen.getByText('Sidebar trips'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/trips'));
  });
  it('prevents duplicate prompts and navigation during a save', async () => {
    const confirm = vi.fn();
    setup(confirm, true);
    fireEvent.click(screen.getByText('Customers'));
    fireEvent.click(screen.getByText('Back'));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('/config/debit-note-templates/new');
  });
  it('cancels browser Back before router listeners and restores the prior history index', () => {
    window.history.replaceState({ idx: 3 }, '', '/config/debit-note-templates/new');
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const router = vi.fn();
    setup(vi.fn());
    window.addEventListener('popstate', router);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 1 } }));
    expect(nativeConfirm).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(2);
    expect(router).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 3 } }));
    expect(router).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', router);
  });
});
