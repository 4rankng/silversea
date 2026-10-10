import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { invalidateAllCatalogs } from '../api/keys';
import { useToast } from '../components/shared/Toast';
import { actionErrorMessage } from '../lib/api/action-error';

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
      // Card 101026163020 (FB-051): feedback for a committed write fires at
      // commit time; the cache refresh that follows may reject (a raced
      // refetch aborts; a failed reload surfaces through the page's own
      // query-error alert) and must never swallow or contradict the success.
      handleMutationSuccess('create');
      await refreshAll().catch(() => undefined);
    } catch (e: unknown) {
      const message = actionErrorMessage('thêm cấu hình', e, 'Lỗi lưu');
      if (message !== null) {
        setError(message);
        // Card _11: a failed mutation must never be silent — the in-modal
        // alert alone disappears with the dialog; the toast survives it.
        toast({ kind: 'error', message });
      }
    } finally { setSaving(false); }
  }, [apiPath, handleMutationSuccess, refreshAll, toast]);

  // KP-135: Each mutation carries the caller-bound version token from the
  // snapshot the user loaded, not the ApiClient's generic updatedAtByPath
  // cache which may have been refreshed by a more recent GET.
  const doUpdate = useCallback(async (id: number, body: Record<string, unknown>, expectedUpdatedAt?: string) => {
    setSaving(true);
    try {
      await api.put(`${apiPath}/${id}`, body, expectedUpdatedAt ? { expectedUpdatedAt } : undefined);
      setEditingId(null);
      // Card 101026163020 (FB-051): same law as create — the success toast
      // belongs to the committed write, not to the refresh after it.
      handleMutationSuccess('update');
      await refreshAll().catch(() => undefined);
    } catch (e: unknown) {
      const message = actionErrorMessage('cập nhật cấu hình', e, 'Lỗi cập nhật');
      if (message !== null) {
        setError(message);
        toast({ kind: 'error', message });
      }
    } finally { setSaving(false); }
  }, [apiPath, handleMutationSuccess, refreshAll, toast]);

  const doDelete = useCallback(async (id: number, expectedUpdatedAt?: string) => {
    setDeleting(id);
    try {
      await api.delete(`${apiPath}/${id}`, expectedUpdatedAt ? { expectedUpdatedAt } : undefined);
      // Card 101026163020 (FB-051): same law as create/update.
      handleMutationSuccess('delete');
      await refreshAll().catch(() => undefined);
    } catch (e: unknown) {
      const message = actionErrorMessage('xóa cấu hình', e, 'Lỗi xóa');
      if (message !== null) {
        setError(message);
        toast({ kind: 'error', message });
      }
    } finally { setDeleting(null); }
  }, [apiPath, handleMutationSuccess, refreshAll, toast]);

  const cancelForm = useCallback(() => { setShowAddForm(false); setEditingId(null); }, []);

  return {
    editingId, showAddForm, saving, deleting, error, setError,
    setEditingId, setShowAddForm,
    doCreate, doUpdate, doDelete, cancelForm,
  };
}
