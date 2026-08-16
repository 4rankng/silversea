/**
 * Create-only mutation for the dispatcher resource catalogs. DISPATCHER's
 * Casbin allowance covers exactly POST /trucks|/drivers|/suppliers — the
 * views reuse the admin form modals but expose no edit/delete surface.
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showForm = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const create = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await api.post(path, body);
      setOpen(false);
      await invalidateAllCatalogs(queryClient);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [path, queryClient]);

  return { open, saving, error, showForm, closeForm, create };
}
