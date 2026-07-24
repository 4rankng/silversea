import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { SYSTEM } from '@tingting/shared';
import type { AuditLog, PaginatedResponse } from '@tingting/shared';

export const systemClient = {
  getAuditLogs: (params?: Record<string, string>) =>
    api.get<PaginatedResponse<AuditLog>>(`${SYSTEM.AUDIT_LOGS}${toQuery(params)}`),

  uploadFile: (formData: FormData) => api.upload(SYSTEM.UPLOAD, formData),
};
