import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { invalidateAllCatalogs } from '../api/keys';

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
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

  const doCreate = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.post(apiPath, body);
      setShowAddForm(false);
      await refreshAll();
    } catch (e: unknown) { setError(getErrorMessage(e) || 'Lỗi lưu'); } finally { setSaving(false); }
  }, [apiPath, refreshAll]);

  const doUpdate = useCallback(async (id: number, body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.put(`${apiPath}/${id}`, body);
      setEditingId(null);
      await refreshAll();
    } catch (e: unknown) { setError(getErrorMessage(e) || 'Lỗi cập nhật'); } finally { setSaving(false); }
  }, [apiPath, refreshAll]);

  const doDelete = useCallback(async (id: number) => {
    setDeleting(id);
    try {
      await api.delete(`${apiPath}/${id}`);
      await refreshAll();
    } catch (e: unknown) { setError(getErrorMessage(e) || 'Lỗi xóa'); } finally { setDeleting(null); }
  }, [apiPath, refreshAll]);

  const cancelForm = useCallback(() => { setShowAddForm(false); setEditingId(null); }, []);

  return {
    editingId, showAddForm, saving, deleting, error, setError,
    setEditingId, setShowAddForm,
    doCreate, doUpdate, doDelete, cancelForm,
  };
}
