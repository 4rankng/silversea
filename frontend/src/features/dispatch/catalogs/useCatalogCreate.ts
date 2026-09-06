/**
 * CRUD mutation hook for the dispatcher resource catalogs. Supports
 * create, update, and delete for DISPATCHER-owned catalog entities
 * (trucks, drivers, suppliers).
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { invalidateAllCatalogs } from '../../../api/keys';

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Không thể lưu bản ghi.';
}

export function useCatalogCreate(path: string) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showForm = useCallback(() => {
    setError(null);
    setEditingId(null);
    setOpen(true);
  }, []);

  const showEdit = useCallback((id: number) => {
    setError(null);
    setEditingId(id);
    setOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setOpen(false);
    setEditingId(null);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    await invalidateAllCatalogs(queryClient);
  }, [queryClient]);

  const create = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await api.post(path, body);
      setOpen(false);
      setEditingId(null);
      await refresh();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [path, refresh]);

  const update = useCallback(async (id: number, body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`${path}/${id}`, body);
      setOpen(false);
      setEditingId(null);
      await refresh();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [path, refresh]);

  const remove = useCallback(async (id: number) => {
    setDeleting(id);
    setError(null);
    try {
      await api.delete(`${path}/${id}`);
      setOpen(false);
      setEditingId(null);
      await refresh();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  }, [path, refresh]);

  return { open, editingId, saving, deleting, error, showForm, showEdit, closeForm, create, update, remove };
}
