import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const authRole = { role: 'OPS' as string };
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 7, role: authRole.role } }),
}));
vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
const list = vi.hoisted(() => vi.fn());
const catalog = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: { list, catalog },
}));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
vi.mock('../../features/shipment-finance/ShipmentFinancePanel', () => ({ ShipmentFinancePanel: () => null }));
vi.mock('./ExpenseEntryDrawer', () => ({ ExpenseEntryDrawer: () => null }));
import { ShipmentExpensePanel } from './ShipmentExpensePanel';

const qkList = { items: [], total: 0, page: 1, limit: 25, canViewPayments: true, unknownReceivableCount: 0, unknownPayableCount: 0,
  totals: { amount: 0, customerChargeAmount: 0, receivedAmount: 0, paidAmount: 0, outstandingReceivable: 0, outstandingPayable: 0 } };
const catalogData = {
  costGroups: [], driverCostSuggestions: [], opsFeeSuggestions: [],
  staff: [{ id: 1, name: 'Kế toán' }], accounts: [], accountants: [],
  opsUsers: [{ id: 7, name: 'Ops bổ trợ' }], advances: [],
  suppliers: [{ id: 3, name: 'Nhà xe A' }], carriers: [], expenseTypes: [],
  treasuryAccounts: [], truckAssignments: [], pendingAdvances: [],
};

function renderPanel() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ShipmentExpensePanel shipmentId={42} shipmentCode="BL7" />
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  authRole.role = 'OPS';
  list.mockResolvedValue(qkList);
  catalog.mockResolvedValue(catalogData);
});

// chiphispec §1 — the entry affordance is NOT hidden for OPS: an Ops opens the
// same drawer the accountant uses, with the payer list scoped to fellow Ops.
it('shows + Thêm khoản chi for OPS and opens the drawer scoped to Ops payers', async () => {
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: '+ Thêm khoản chi' }));
  fireEvent.click(await screen.findByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhân viên chi' }));
  fireEvent.click(screen.getByRole('button', { name: /Người thực chi/ }));
  expect(screen.queryByRole('option', { name: 'Kế toán' })).not.toBeInTheDocument();
  expect(await screen.findByRole('option', { name: 'Ops bổ trợ' })).toBeTruthy();
});

it('hides the affordance only when the panel is read-only', async () => {
  render(<QueryClientProvider client={new QueryClient()}>
    <ShipmentExpensePanel shipmentId={42} shipmentCode="BL7" readOnly />
  </QueryClientProvider>);
  await screen.findByText('Chưa có khoản chi cho lô này.');
  expect(screen.queryByRole('button', { name: '+ Thêm khoản chi' })).toBeNull();
});
