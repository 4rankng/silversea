// SIL-1132 — the "Xem / bổ sung chứng từ" panel is KIND-AWARE: the driver
// declares the saved row's document kind (Hóa đơn / Phiếu thu) and attaches
// its photo — never anonymous photos only. The declaration call must carry the
// cost id and the chosen kind; the pair only exists while the row is mutable.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
const { get, uploadProof, declare } = vi.hoisted(() => ({ get: vi.fn(), uploadProof: vi.fn(), declare: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { get, uploadProof } }));
vi.mock('../../api/driverClient', () => ({ driverClient: { declareIncidentalCostEvidenceKind: declare } }));
import { DriverSavedExpenseProofs } from './DriverSavedExpenseProofs';

function panel(props: Partial<React.ComponentProps<typeof DriverSavedExpenseProofs>> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DriverSavedExpenseProofs expenseId={5} onKindDeclared={vi.fn()} {...props} />
  </QueryClientProvider>);
}
function open() { fireEvent.click(screen.getByRole('button', { name: 'Xem / bổ sung chứng từ' })); }

beforeEach(() => {
  get.mockReset().mockResolvedValue({ sourceKind: 'DRIVER', sourceId: 5, version: 1, status: 'RECORDED', photoStorageKeys: [] });
  uploadProof.mockReset();
  declare.mockReset().mockResolvedValue({});
});

it('SIL-1132: the panel declares the kind — the call carries the cost id and the chosen kind', async () => {
  const onKindDeclared = vi.fn();
  panel({ evidenceKind: null, onKindDeclared });
  open();
  const kindGroup = await screen.findByRole('group', { name: 'Loại chứng từ' });
  expect(kindGroup).toBeTruthy();
  // Nothing declared yet — honest unclassified state: neither tick pressed.
  expect(screen.getByRole('button', { name: 'Hóa đơn' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Phiếu thu' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Hóa đơn' }));
  await waitFor(() => expect(declare).toHaveBeenCalledWith({ costId: 5, evidenceKind: 'INVOICE' }));
  expect(declare).toHaveBeenCalledTimes(1);
  // The caption re-read follows the successful declare.
  await waitFor(() => expect(onKindDeclared).toHaveBeenCalledTimes(1));
});

it('the pair preselects the row’s declared kind and a Phiếu thu flip sends RECEIPT', async () => {
  panel({ evidenceKind: 'INVOICE' });
  open();
  expect(await screen.findByRole('button', { name: 'Hóa đơn' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Phiếu thu' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Phiếu thu' }));
  await waitFor(() => expect(declare).toHaveBeenCalledWith({ costId: 5, evidenceKind: 'RECEIPT' }));
});

it('SIL-1035: a failed declaration keeps the panel open and maps offline to the Vietnamese sentence', async () => {
  declare.mockRejectedValueOnce(new TypeError('NetworkError when attempting to fetch resource.'));
  const onKindDeclared = vi.fn();
  panel({ evidenceKind: null, onKindDeclared });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Phiếu thu' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Mất kết nối. Vui lòng thử lại.');
  expect(alert.textContent).not.toContain('NetworkError');
  expect(onKindDeclared).not.toHaveBeenCalled();
  // The pair survives for a deliberate retry.
  expect(screen.getByRole('group', { name: 'Loại chứng từ' })).toBeTruthy();
});

it('without the declaration wiring the pair does not render (view-only surfaces keep the old panel)', async () => {
  panel({ evidenceKind: null, onKindDeclared: undefined });
  open();
  await screen.findByText('Chưa có ảnh chứng từ.');
  expect(screen.queryByRole('group', { name: 'Loại chứng từ' })).toBeNull();
});

it('a settled row keeps an honest STATIC kind line — never an actionable pair', async () => {
  get.mockReset().mockResolvedValue({ sourceKind: 'DRIVER', sourceId: 5, version: 1, status: 'RECORDED', confirmedAt: '2026-11-01T00:00:00Z', photoStorageKeys: [] });
  panel({ evidenceKind: 'INVOICE' });
  open();
  expect(await screen.findByText(/Loại chứng từ: Hóa đơn/)).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Loại chứng từ' })).toBeNull();
});
