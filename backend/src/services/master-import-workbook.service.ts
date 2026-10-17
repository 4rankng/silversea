/**
 * Shared workbook-parsing utilities for the master-data import pipeline
 * (master-data-import.service.ts + master-data-import-sep2026.service.ts).
 * Extracted into a leaf module: both parents consumed these helpers from each
 * other, closing a runtime import cycle between the two import surfaces.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ApiError } from '../errors';
import type { AcceptedPayload, ParsedRow } from './master-data-import.service';

export const MASTER_IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const MASTER_IMPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MASTER_IMPORT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MASTER_IMPORT_MAX_ZIP_ENTRIES = 5_000;

export interface MasterWorkbookFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeLookup(value: string): string {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase();
}

export function normalizeIdentifier(value: string): string {
  return normalizeSpaces(value).toUpperCase().replace(/\s+/g, '');
}

export function stableCode(prefix: string, value: string, maxLength: number): string {
  const normalized = normalizeLookup(value)
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = sha256(value).slice(0, 8).toUpperCase();
  const available = Math.max(1, maxLength - prefix.length - hash.length - 1);
  const stem = (normalized || 'ITEM').slice(0, available);
  return `${prefix}${stem}-${hash}`;
}

export function cellValue(cell: ExcelJS.Cell): { text: string; formula: boolean } {
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) {
    return { text: '', formula: true };
  }
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), formula: false };
  if (value && typeof value === 'object' && 'richText' in value) {
    return {
      text: normalizeSpaces(value.richText.map((part) => part.text).join('')),
      formula: false,
    };
  }
  if (value && typeof value === 'object' && 'text' in value) {
    return { text: normalizeSpaces(String(value.text ?? '')), formula: false };
  }
  return { text: normalizeSpaces(cell.text || String(value ?? '')), formula: false };
}

export function cellsForRow(sheet: ExcelJS.Worksheet, rowNumber: number, columns: number[]): {
  values: string[];
  hasFormula: boolean;
} {
  const cells = columns.map((column) => cellValue(sheet.getCell(rowNumber, column)));
  return { values: cells.map((cell) => cell.text), hasFormula: cells.some((cell) => cell.formula) };
}

export function lastRelevantRow(sheet: ExcelJS.Worksheet, startRow: number, columns: number[]): number {
  for (let rowNumber = sheet.rowCount; rowNumber >= startRow; rowNumber -= 1) {
    if (columns.some((column) => cellValue(sheet.getCell(rowNumber, column)).text !== '')) {
      return rowNumber;
    }
  }
  return startRow;
}

export function classifiedRow(input: Omit<ParsedRow, 'naturalKey' | 'payload'> & {
  naturalKey?: string | null;
  payload?: AcceptedPayload | null;
}): ParsedRow {
  return {
    ...input,
    naturalKey: input.naturalKey ?? null,
    payload: input.payload ?? null,
  };
}

export function blockedRow(
  sheetName: string,
  rowNumber: number,
  entityType: string,
  reasonCode: string,
  redactedReason: string,
): ParsedRow {
  return classifiedRow({
    sheetName,
    rowNumber,
    entityType,
    classification: 'BLOCKED',
    reasonCode,
    redactedReason,
  });
}

export function templateRow(sheetName: string, rowNumber: number, entityType: string): ParsedRow {
  return classifiedRow({
    sheetName,
    rowNumber,
    entityType,
    classification: 'TEMPLATE',
    reasonCode: null,
    redactedReason: null,
  });
}

export function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function inspectXlsxArchive(buffer: Buffer): void {
  const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  let hasContentTypes = false;
  while (offset < buffer.length) {
    const entryOffset = buffer.indexOf(centralDirectorySignature, offset);
    if (entryOffset < 0) break;
    if (entryOffset + 46 > buffer.length) throw new ApiError(415, 'Cấu trúc tệp XLSX không hợp lệ.');
    const uncompressedBytes = buffer.readUInt32LE(entryOffset + 24);
    const fileNameLength = buffer.readUInt16LE(entryOffset + 28);
    const extraLength = buffer.readUInt16LE(entryOffset + 30);
    const commentLength = buffer.readUInt16LE(entryOffset + 32);
    const nameStart = entryOffset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) throw new ApiError(415, 'Cấu trúc tệp XLSX không hợp lệ.');
    const entryName = buffer.subarray(nameStart, nameEnd).toString('utf8').toLowerCase();
    entryCount += 1;
    totalUncompressedBytes += uncompressedBytes;
    if (entryName === '[content_types].xml') hasContentTypes = true;
    if (entryName.endsWith('vbaproject.bin')) throw new ApiError(415, 'Tệp có macro không được phép nhập.');
    if (entryCount > MASTER_IMPORT_MAX_ZIP_ENTRIES
      || totalUncompressedBytes > MASTER_IMPORT_MAX_UNCOMPRESSED_BYTES) {
      throw new ApiError(413, 'Dung lượng giải nén của tệp XLSX vượt quá giới hạn xử lý.');
    }
    offset = nameEnd + extraLength + commentLength;
  }
  if (entryCount === 0 || !hasContentTypes) throw new ApiError(415, 'Gói tệp không phải XLSX hợp lệ.');
}

export function validateWorkbookFile(file: MasterWorkbookFile): void {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new ApiError(400, 'Tệp XLSX là bắt buộc.');
  if (file.size < 1 || file.buffer.length < 4) throw new ApiError(400, 'Tệp XLSX trống.');
  if (file.size > MASTER_IMPORT_MAX_BYTES || file.buffer.length > MASTER_IMPORT_MAX_BYTES) {
    throw new ApiError(413, 'Tệp không được vượt quá 15 MB.');
  }
  if (path.extname(file.originalname).toLowerCase() !== '.xlsx') {
    throw new ApiError(415, 'Chỉ chấp nhận tệp .xlsx.');
  }
  if (file.mimetype !== MASTER_IMPORT_XLSX_MIME) {
    throw new ApiError(415, 'Kiểu tệp không hợp lệ; chỉ chấp nhận XLSX.');
  }
  if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    throw new ApiError(415, 'Chữ ký tệp không phải XLSX.');
  }
  inspectXlsxArchive(file.buffer);
}
