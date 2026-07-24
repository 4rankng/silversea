import type { ContainerFormRow, SealFormRow } from '../../hooks/useTripFormState';
import { normalizeContainerNumber, validateContainerFormat, validateCheckDigit, suggestCorrections } from '@tingting/shared';

export type ContainerRow = ContainerFormRow;
export interface ServerContainer { id: number; containerTypeId?: number | null; containerNumber?: string | null; sealNumber?: string | null; cargoWeightKg?: string | number | null; notes?: string | null; seals?: Array<{ id: number; sealNumber: string; sealType?: string | null; notes?: string | null }>; photos?: Array<{ id: number; type: 'CONTAINER' | 'SEAL'; storageKey: string; uploadedAt: string }>; }
export function rowKey() { return Math.random().toString(36).slice(2, 9); }
export function emptyRow(containerTypeId: number | '' = ''): ContainerRow { return { _key: rowKey(), containerTypeId, containerNumber: '', sealNumber: '', cargoWeightKg: '', notes: '', seals: [], photoKeys: { cont: [], seal: [] } }; }
export function hasEditableContainerData(row: ContainerRow): boolean { return Boolean(row.containerNumber.trim() || row.containerTypeId || row.cargoWeightKg || row.notes.trim() || row.seals.some(sl => sl.sealNumber.trim() || sl.sealType.trim() || sl.notes.trim()) || row.photoKeys.cont.length || row.photoKeys.seal.length); }
export function sealKey() { return Math.random().toString(36).slice(2, 9); }
export function emptySeal(): SealFormRow { return { _key: sealKey(), sealNumber: '', sealType: '', notes: '' }; }
export function photoStorageKey(value: string): string { const [path] = value.split('?'); const marker = '/api/photos/'; return path.startsWith(marker) ? decodeURIComponent(path.slice(marker.length)) : path; }
export function checkContainerNumber(cn: string): { warning: string | null; suggestion: string | null } { const trimmed = cn.trim(); if (!trimmed) return { warning: null, suggestion: null }; const norm = normalizeContainerNumber(trimmed); if (!validateContainerFormat(norm)) return { warning: 'Số cont sai định dạng (4 chữ cái + 7 số).', suggestion: null }; if (validateCheckDigit(norm)) return { warning: null, suggestion: null }; return { warning: 'Số cont sai chữ số kiểm tra — kiểm tra lại.', suggestion: suggestCorrections(norm, 1)[0] ?? null }; }
