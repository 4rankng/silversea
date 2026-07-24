import { useState, useCallback } from 'react';
import { Role } from '@tingting/shared';
import { userClient } from '../../../api/userClient';
import { useToast } from '../../../components/shared/Toast';
import { useConfirm } from '../../../components/UI';
import type { CreateData, EditData } from '../utils';

/** Normalize driver-profile fields: empty strings become undefined (omitted from API payload). */
function driverPayload(data: CreateData | EditData) {
  return data.role === Role.DRIVER ? {
    baseSalary: data.baseSalary !== undefined && data.baseSalary !== '' ? data.baseSalary : undefined,
    socialInsurance: data.socialInsurance !== undefined && data.socialInsurance !== '' ? data.socialInsurance : undefined,
    assignedTruckId: data.assignedTruckId ?? null,
  } : {};
}

export function useUserMutations(refetch: () => void) {
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toast: showToast } = useToast();

  const doCreate = useCallback(async (data: CreateData) => {
    if (!data.password || (!data.username && !data.email && !data.phone)) {
      setPanelError('Cần ít nhất username/email/SĐT và mật khẩu');
      return;
    }
    setSaving(true);
    setPanelError(null);
    try {
      await userClient.createUser({
        username: data.username || undefined,
        email:    data.email    || undefined,
        phone:    data.phone    || undefined,
        fullName: data.fullName || undefined,
        password: data.password,
        role:     data.role,
        ...driverPayload(data),
      });
      refetch();
      showToast({ kind: 'success', message: 'Tạo tài khoản thành công' });
      return true;
    } catch (e: unknown) {
      setPanelError(e instanceof Error ? e.message : 'Lỗi khi tạo tài khoản');
      return false;
    } finally {
      setSaving(false);
    }
  }, [refetch, showToast]);

  const doUpdate = useCallback(async (id: number, data: EditData) => {
    setSaving(true);
    setPanelError(null);
    try {
      const body: Record<string, unknown> = {
        role:     data.role,
        status:   data.status,
        username: data.username || undefined,
        fullName: data.fullName,
        email:    data.email,
        phone:    data.phone,
        ...driverPayload(data),
      };
      if (data.password) body.password = data.password;
      await userClient.updateUser(id, body);
      refetch();
      showToast({ kind: 'success', message: 'Cập nhật tài khoản thành công' });
      return true;
    } catch (e: unknown) {
      setPanelError(e instanceof Error ? e.message : 'Lỗi khi cập nhật');
      return false;
    } finally {
      setSaving(false);
    }
  }, [refetch, showToast]);

  const doDelete = useCallback(async (id: number) => {
    if (!await confirm('Xóa tài khoản này? Thao tác không thể hoàn tác.', { variant: 'danger', confirmLabel: 'Xóa' })) return;
    setDeleting(id);
    try {
      await userClient.deleteUser(id);
      refetch();
    } catch (e: unknown) {
      showToast({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi khi xóa' });
    } finally {
      setDeleting(null);
    }
  }, [refetch, confirm, showToast]);

  const clearPanelError = useCallback(() => setPanelError(null), []);

  return {
    saving,
    panelError,
    deleting,
    confirmDialog,
    doCreate,
    doUpdate,
    doDelete,
    clearPanelError,
  };
}
