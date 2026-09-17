import { usePageLeaveGuard } from '../../hooks/usePageLeaveGuard';

export function useTemplateLeaveGuard(options: Omit<Parameters<typeof usePageLeaveGuard>[0], 'message'>) {
  return usePageLeaveGuard({ ...options, message: 'Mẫu có thay đổi chưa lưu. Bỏ thay đổi và rời trang?' });
}
