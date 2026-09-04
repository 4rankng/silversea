import { api } from '../lib/api';

export type MasterImportClassification = 'ACCEPTED' | 'BLOCKED' | 'TEMPLATE' | 'EXAMPLE';

export interface MasterImportRow {
  id: number;
  sheetName: string;
  rowNumber: number;
  entityType: string;
  classification: MasterImportClassification;
  reasonCode: string | null;
  redactedReason: string | null;
  appliedEntityType: string | null;
  appliedEntityId: number | null;
}

export interface MasterImportBatch {
  id: number;
  sourceFileName: string;
  sourceFileHash: string;
  parserVersion: string;
  status: 'ANALYZED' | 'APPLIED' | 'REJECTED';
  summary: Record<string, number>;
  warningCodes: string[];
  version: number;
  analyzedAt: string;
  appliedAt: string | null;
  rows: MasterImportRow[];
}

export async function analyzeMasterData(files: { file?: File; dataForm?: File; userRole?: File }) {
  const form = new FormData();
  if (files.file) form.append('file', files.file);
  if (files.dataForm) form.append('dataForm', files.dataForm);
  if (files.userRole) form.append('userRole', files.userRole);
  return api.postForm<{ batch: MasterImportBatch; replayed: boolean }>(
    '/config/master-data-imports/analyze',
    form,
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  );
}

export function applyMasterData(batch: MasterImportBatch) {
  return api.post<{ batch: MasterImportBatch; appliedCounts: Record<string, number>; replayed: boolean }>(
    `/config/master-data-imports/${batch.id}/apply`,
    { expectedVersion: batch.version },
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  );
}

export function rejectMasterData(batch: MasterImportBatch, reason: string) {
  return api.post<{ batch: MasterImportBatch; replayed: boolean }>(
    `/config/master-data-imports/${batch.id}/reject`,
    { expectedVersion: batch.version, reason },
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  );
}
