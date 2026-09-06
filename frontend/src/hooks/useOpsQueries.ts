/**
 * React-query hooks for the Ops portal (docs/prd/OpsVanHanh.md). Local key
 * factory keeps the ops surface self-contained; mutations invalidate the
 * wallet + lists so the optimistic patches reconcile against the server.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  opsClient,
  type OpsExpensePhoto,
  type OpsExpenseRow,
  type OpsExpenseStatus,
  type OpsFleetTruck,
  type OpsOrderItem,
  type OpsSettlementDetail,
  type OpsSettlementListItem,
  type OpsWalletSummary,
} from '../api/opsClient';

export const opsKeys = {
  orders: (date: string, q?: string) => ['ops', 'orders', date, q ?? ''] as const,
  expenseTypes: () => ['ops', 'expense-types'] as const,
  walletSummary: () => ['ops', 'wallet-summary'] as const,
  walletExpenses: (status?: OpsExpenseStatus) => ['ops', 'wallet-expenses', status ?? 'all'] as const,
  expensePhotos: (id: number) => ['ops', 'expense-photos', id] as const,
  fleet: () => ['ops', 'fleet'] as const,
  settlements: (status?: string) => ['ops', 'settlements', status ?? 'all'] as const,
  settlement: (id: number) => ['ops', 'settlement', id] as const,
  adminExpenses: (status?: OpsExpenseStatus, opsUserId?: number) =>
    ['ops', 'admin-expenses', status ?? 'all', opsUserId ?? 0] as const,
  adminSettlements: (status?: string) => ['ops', 'admin-settlements', status ?? 'all'] as const,
};

function useInvalidateOps() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['ops'] });
  };
}

// ── Kế hoạch làm hàng ────────────────────────────────────────────────────────

export function useOpsOrders(date: string, q?: string) {
  return useQuery<{ date: string; items: OpsOrderItem[] }>({
    queryKey: opsKeys.orders(date, q),
    queryFn: () => opsClient.getOrders(date, q),
  });
}

export function useToggleShipmentPin(date: string, q?: string) {
  const invalidateOrders = useInvalidateOps();
  return useMutation({
    mutationFn: (shipmentId: number) => opsClient.togglePin(shipmentId),
    onSettled: () => invalidateOrders(),
  });
}

// ── Danh mục + khoản chi ─────────────────────────────────────────────────────

export function useOpsExpenseTypes() {
  return useQuery({
    queryKey: opsKeys.expenseTypes(),
    queryFn: () => opsClient.getExpenseTypes(),
    staleTime: 5 * 60_000,
  });
}

export function useOpsWalletSummary() {
  return useQuery<OpsWalletSummary>({
    queryKey: opsKeys.walletSummary(),
    queryFn: () => opsClient.getWalletSummary(),
  });
}

export function useOpsWalletExpenses(status?: OpsExpenseStatus) {
  return useQuery<{ items: OpsExpenseRow[] }>({
    queryKey: opsKeys.walletExpenses(status),
    queryFn: () => opsClient.getWalletExpenses(status),
  });
}

export function useCreateOpsExpense() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: opsClient.createExpense,
    onSettled: () => invalidate(),
  });
}

export function useUpdateOpsExpense() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      opsClient.updateExpense(id, body),
    onSettled: () => invalidate(),
  });
}

export function useDeleteOpsExpense() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: (id: number) => opsClient.deleteExpense(id),
    onSettled: () => invalidate(),
  });
}

export function useResendOpsExpense() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: (id: number) => opsClient.resendExpense(id),
    onSettled: () => invalidate(),
  });
}

export function useOpsExpensePhotos(expenseId: number | null) {
  return useQuery<{ items: OpsExpensePhoto[] }>({
    queryKey: opsKeys.expensePhotos(expenseId ?? -1),
    queryFn: () => opsClient.getExpensePhotos(expenseId!),
    enabled: expenseId != null,
  });
}

export function useAttachOpsExpensePhoto() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: ({ expenseId, storageKey }: { expenseId: number; storageKey: string }) =>
      opsClient.attachExpensePhoto(expenseId, storageKey),
    onSettled: () => invalidate(),
  });
}

export function useDeleteOpsExpensePhoto() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: (photoId: number) => opsClient.deleteExpensePhoto(photoId),
    onSettled: () => invalidate(),
  });
}

export function useCreateOpsAdvanceRequest() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: (body: { amount: number; reason: string }) =>
      opsClient.createAdvanceRequest(body),
    onSettled: () => invalidate(),
  });
}

// ── Fleet ───────────────────────────────────────────────────────────────────

/** Read-only 30s polling per PRD §4. */
export function useOpsFleet() {
  return useQuery<{ items: OpsFleetTruck[] }>({
    queryKey: opsKeys.fleet(),
    queryFn: () => opsClient.getFleet(),
    refetchInterval: 30_000,
  });
}

// ── Đề nghị thanh toán ───────────────────────────────────────────────────────

export function useOpsSettlements(status?: string) {
  return useQuery<{ items: OpsSettlementListItem[] }>({
    queryKey: opsKeys.settlements(status),
    queryFn: () => opsClient.getSettlements(status),
  });
}

export function useOpsSettlement(id: number | null) {
  return useQuery<OpsSettlementDetail>({
    queryKey: opsKeys.settlement(id ?? -1),
    queryFn: () => opsClient.getSettlement(id!),
    enabled: id != null,
  });
}

export function useCreateOpsSettlement() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: (note?: string) => opsClient.createSettlement(note),
    onSettled: () => invalidate(),
  });
}

// ── Duyệt (kế toán / quản lý) ────────────────────────────────────────────────

export function useAdminOpsExpenses(status?: OpsExpenseStatus, opsUserId?: number) {
  return useQuery<{ items: OpsExpenseRow[] }>({
    queryKey: opsKeys.adminExpenses(status, opsUserId),
    queryFn: () => opsClient.getAdminExpenses({ status, opsUserId }),
  });
}

export function useDecideOpsExpense() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: ({ id, decision, reason }: {
      id: number;
      decision: 'approve' | 'reject';
      reason?: string;
    }) =>
      decision === 'approve'
        ? opsClient.approveExpense(id)
        : opsClient.rejectExpense(id, reason ?? ''),
    onSettled: () => invalidate(),
  });
}

export function useAdminOpsSettlements(status?: string) {
  return useQuery<{ items: OpsSettlementListItem[] }>({
    queryKey: opsKeys.adminSettlements(status),
    queryFn: () => opsClient.getAdminSettlements(status),
  });
}

export function useAdminOpsSettlement(id: number | null) {
  return useQuery<OpsSettlementDetail>({
    queryKey: ['ops', 'admin-settlement', id ?? -1] as const,
    queryFn: () => opsClient.getAdminSettlement(id!),
    enabled: id != null,
  });
}

export function useDecideOpsSettlement() {
  const invalidate = useInvalidateOps();
  return useMutation({
    mutationFn: ({ id, decision, reason }: {
      id: number;
      decision: 'approve' | 'reject';
      reason?: string;
    }) =>
      decision === 'approve'
        ? opsClient.approveSettlement(id)
        : opsClient.rejectSettlement(id, reason ?? ''),
    onSettled: () => invalidate(),
  });
}
