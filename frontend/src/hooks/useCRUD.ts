import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { invalidateAllCatalogs } from '../api/keys';
import { useToast } from '../components/shared/Toast';

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

type CrudMutationKind = 'create' | 'update' | 'delete';

function directSuccessMessage(kind: CrudMutationKind): string {
  switch (kind) {
    case 'create':
      return 'Đã thêm cấu hình.';
    case 'update':
      return 'Đã cập nhật cấu hình.';
    case 'delete':
      return 'Đã xóa cấu hình.';
  }
}

/**
 * @deprecated Prefer `useCreateMutation` / `useUpdateMutation` /
 * `useDeleteMutation` from `api/mutations.ts` which integrate with
 * `useQueryClient` directly and remove the need for an `onRefresh`
 * callback. This hook is kept for the 18 config pages still wired to
 * `<CrudTable>` and will be removed once the CrudTable factory migration
 * lands.
 */
export function useCRUD(apiPath: string, onRefresh: () => Promise<void>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Invalidate every catalog-shaped key so dependent pages (dispatch,
  // trip form, search dropdowns) all refresh in one shot. Replaces the
  // previous `['catalogs']`-only invalidation which left the
  // `['trucks-drivers']`, `['routes-dropdown']`, etc. caches stale.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      onRefresh(),
      invalidateAllCatalogs(queryClient),
    ]);
  }, [onRefresh, queryClient]);

  const handleMutationSuccess = useCallback((kind: CrudMutationKind) => {
    setError(null);
    toast({
      kind: 'success',
      message: directSuccessMessage(kind),
    });
  }, [toast]);

  const doCreate = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.post(apiPath, body);
      setShowAddForm(false);
      await refreshAll();
      handleMutationSuccess('create');
    } catch (e: unknown) {
      const message = getErrorMessage(e) || 'Lỗi lưu';
      setError(message);
      // Card _11: a failed mutation must never be silent — the in-modal
      // alert alone disappears with the dialog; the toast survives it.
      toast({ kind: 'error', message });
    } finally { setSaving(false); }
  }, [apiPath, handleMutationSuccess, refreshAll]);

  // KP-135: Each mutation carries the caller-bound version token from the
  // snapshot the user loaded, not the ApiClient's generic updatedAtByPath
  // cache which may have been refreshed by a more recent GET.
  const doUpdate = useCallback(async (id: number, body: Record<string, unknown>, expectedUpdatedAt?: string) => {
    setSaving(true);
    try {
      await api.put(`${apiPath}/${id}`, body, expectedUpdatedAt ? { expectedUpdatedAt } : undefined);
      setEditingId(null);
      await refreshAll();
      handleMutationSuccess('update');
    } catch (e: unknown) {
      const message = getErrorMessage(e) || 'Lỗi cập nhật';
      setError(message);
      toast({ kind: 'error', message });
    } finally { setSaving(false); }
  }, [apiPath, handleMutationSuccess, refreshAll]);

  const doDelete = useCallback(async (id: number, expectedUpdatedAt?: string) => {
    setDeleting(id);
    try {
      await api.delete(`${apiPath}/${id}`, expectedUpdatedAt ? { expectedUpdatedAt } : undefined);
      await refreshAll();
      handleMutationSuccess('delete');
    } catch (e: unknown) {
      const message = getErrorMessage(e) || 'Lỗi xóa';
      setError(message);
      toast({ kind: 'error', message });
    } finally { setDeleting(null); }
  }, [apiPath, handleMutationSuccess, refreshAll]);

  const cancelForm = useCallback(() => { setShowAddForm(false); setEditingId(null); }, []);

  return {
    editingId, showAddForm, saving, deleting, error, setError,
    setEditingId, setShowAddForm,
    doCreate, doUpdate, doDelete, cancelForm,
  };
}
