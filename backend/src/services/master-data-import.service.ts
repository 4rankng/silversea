import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { reassignTruckDriverInTx } from './truck-driver-assignment.service';
import type { AuthUser } from '../middleware/auth';
import {
  lockActiveCustomerIds,
  lockDriverRowForUpdate,
  lockTrailerRow,
  lockTruckRow,
} from './application-relationship.service';
import { storageService } from './storage.service';
import { runIdempotent } from './idempotency.service';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  enqueueStorageDelete,
  STORAGE_DELETE_MODE,
} from './durable-effect.service';
import {
  applyFleetSpecs,
  applyReferenceEntities,
  parseCustomersV2,
  parseDriversV2,
  parsePortsV2,
  parseRoutesV2,
  parseSitesV2,
  parseStaffUsers,
  parseTrailerSpecs,
  parseTruckSpecs,
  type CustomerPayload,
  type RoutePayload,
  type StaffUserPayload,
  type TrailerSpecPayload,
  type TruckSpecPayload,
} from './master-data-import-sep2026.service';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Classification = typeof s.masterImportRowClassificationEnum.enumValues[number];

export const MASTER_IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const MASTER_IMPORT_PARSER_VERSION = 'silversea-master-v3';
export const MASTER_IMPORT_APPLY_ENDPOINT = 'master-data-import.apply';
export const MASTER_IMPORT_REJECT_ENDPOINT = 'master-data-import.reject';
export const MASTER_IMPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MASTER_IMPORT_SOURCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MASTER_IMPORT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MASTER_IMPORT_MAX_ZIP_ENTRIES = 5_000;
const MASTER_IMPORT_MAX_SHEETS = 20;
const MASTER_IMPORT_MAX_ROWS_PER_SHEET = 5_000;
const MASTER_IMPORT_MAX_COLUMNS_PER_SHEET = 100;

export interface MasterWorkbookFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface SitePayload {
  kind: 'operational_site';
  customerCode: string;
  code: string;
  name: string;
  siteType: 'FACTORY' | 'WAREHOUSE';
  address: string;
  googleMapsUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  liftFeeInvoiceName: string | null;
  liftFeeInvoiceAddress: string | null;
  liftFeeTaxCode: string | null;
  strictRules: string | null;
  // Sep-2026 sheet ("Nhà máy & Kho") additions — null from the legacy parser.
  warehouseContactInfo: string | null;
  liftInfo: string | null;
  dropInfo: string | null;
  cleaningInfo: string | null;
}

export interface PortPayload {
  kind: 'port';
  code: string;
  name: string;
  address: string | null;
  webUrl: string | null;
  // Sep-2026 sheet ("Cảng & Bãi") additions — null from the legacy parser.
  classification: string | null;
  legalEntity: string | null;
  isLachHuyen: boolean;
  position: string | null;
}

export interface DriverPayload {
  kind: 'driver';
  name: string;
  phone: string | null;
  // Sep-2026 sheet ("Lái xe") additions — null from the legacy parser.
  code: string | null;
  idNumber: string | null;
  licenseNumber: string | null;
  licenseExpiryDate: string | null;
  bankName: string | null;
  bankAccount: string | null;
  salaryType: string | null;
}

interface FleetPayload {
  kind: 'fleet';
  plate: string;
  trailerPlate: string | null;
  trailerType: '20FT' | '40FT' | null;
  driverName: string | null;
}

type AcceptedPayload = SitePayload | PortPayload | DriverPayload | FleetPayload
  | CustomerPayload | RoutePayload | TruckSpecPayload | TrailerSpecPayload | StaffUserPayload;

export interface ParsedRow {
  sheetName: string;
  rowNumber: number;
  entityType: string;
  classification: Classification;
  naturalKey: string | null;
  payload: AcceptedPayload | null;
  reasonCode: string | null;
  redactedReason: string | null;
}

interface ParsedWorkbook {
  rows: ParsedRow[];
  summary: Record<string, number>;
  warningCodes: string[];
  customerTaxCodeByInternalCode: Map<string, string>;
}

export interface MasterImportRowDto {
  id: number;
  sheetName: string;
  rowNumber: number;
  entityType: string;
  classification: Classification;
  reasonCode: string | null;
  redactedReason: string | null;
  appliedEntityType: string | null;
  appliedEntityId: number | null;
}

export interface MasterImportBatchDto {
  id: number;
  sourceFileName: string;
  sourceFileHash: string;
  parserVersion: string;
  status: typeof s.masterImportStatusEnum.enumValues[number];
  summary: Record<string, number>;
  warningCodes: string[];
  version: number;
  analyzedBy: number;
  appliedBy: number | null;
  rejectedBy: number | null;
  analyzedAt: string;
  appliedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  rows: MasterImportRowDto[];
}

export interface AnalyzeMasterWorkbookResult {
  batch: MasterImportBatchDto;
  replayed: boolean;
}

export interface ApplyMasterImportResult {
  batch: MasterImportBatchDto;
  appliedCounts: Record<string, number>;
}

export interface RejectMasterImportResult {
  batch: MasterImportBatchDto;
  rejectionReason: string;
}

function requireAdmin(actor: Pick<AuthUser, 'userId' | 'role'>): void {
  if (actor.role !== Role.ADMIN) throw new ApiError(403, 'Không có quyền truy cập');
}

function sha256(value: Buffer | string): string {
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

function extractLabeledValue(source: string, labels: string[], maxLength: number): string | null {
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}\\s*[:：-]?\\s*([^;,]{2,${maxLength}})`, 'iu'));
    if (match?.[1]) return normalizeSpaces(match[1]).slice(0, maxLength);
  }
  return null;
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

function cellValue(cell: ExcelJS.Cell): { text: string; formula: boolean } {
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

function parseOrganizationReferences(
  workbook: ExcelJS.Workbook,
  rows: ParsedRow[],
): Map<string, string> {
  const result = new Map<string, string>();
  const sheet = workbook.getWorksheet('THÔNG TIN NCC');
  if (sheet) {
    const last = lastRelevantRow(sheet, 3, [1, 2, 3, 4]);
    for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
      const { values, hasFormula } = cellsForRow(sheet, rowNumber, [2, 3, 4]);
      const [internalCode, taxCode, name] = values;
      if (!internalCode && !taxCode && !name) {
        rows.push(templateRow(sheet.name, rowNumber, 'organization'));
        continue;
      }
      rows.push(blockedRow(
        sheet.name,
        rowNumber,
        'organization',
        hasFormula ? 'FORMULA_NOT_ALLOWED' : 'AMBIGUOUS_ORGANIZATION_ROLE',
        hasFormula
          ? 'Ô dữ liệu chứa công thức và không được phép nhập.'
          : 'Vai trò nhà cung cấp/khách hàng chưa được xác nhận; không tạo bản ghi.',
      ));
    }
  }
  const approvedSheet = workbook.getWorksheet('ÁNH XẠ KHÁCH HÀNG');
  if (!approvedSheet) return result;
  const approvedLast = lastRelevantRow(approvedSheet, 2, [1, 2, 3]);
  for (let rowNumber = 2; rowNumber <= approvedLast; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(approvedSheet, rowNumber, [1, 2, 3]);
    const [internalCode, taxCode, customerName] = values;
    if (!values.some(Boolean)) {
      rows.push(templateRow(approvedSheet.name, rowNumber, 'customer_reference'));
      continue;
    }
    if (hasFormula || !internalCode || !taxCode || !customerName) {
      rows.push(blockedRow(
        approvedSheet.name,
        rowNumber,
        'customer_reference',
        hasFormula ? 'FORMULA_NOT_ALLOWED' : 'INVALID_CUSTOMER_REFERENCE',
        hasFormula
          ? 'Ô dữ liệu chứa công thức và không được phép nhập.'
          : 'Ánh xạ khách hàng thiếu mã nội bộ, mã số thuế hoặc tên xác nhận.',
      ));
      continue;
    }
    const normalizedCode = normalizeLookup(internalCode);
    const normalizedTaxCode = normalizeIdentifier(taxCode);
    result.set(normalizedCode, normalizedTaxCode);
    rows.push(classifiedRow({
      sheetName: approvedSheet.name,
      rowNumber,
      entityType: 'customer_reference',
      classification: 'ACCEPTED',
      naturalKey: `${normalizedCode}:${normalizedTaxCode}`,
      payload: null,
      reasonCode: null,
      redactedReason: null,
    }));
  }
  return result;
}

function parseTemplateSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  startRow: number,
  entityType: string,
  relevantColumns: number[],
  rows: ParsedRow[],
): void {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return;
  const last = lastRelevantRow(sheet, startRow, relevantColumns);
  for (let rowNumber = startRow; rowNumber <= last; rowNumber += 1) {
    const { values } = cellsForRow(sheet, rowNumber, relevantColumns);
    if (values.some(Boolean)) {
      rows.push(blockedRow(
        sheet.name,
        rowNumber,
        entityType,
        'UNSUPPORTED_SOURCE_ROW',
        'Dòng nguồn chưa có ánh xạ được phê duyệt; không tạo bản ghi.',
      ));
    } else {
      rows.push(templateRow(sheet.name, rowNumber, entityType));
    }
  }
}

function parseSites(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('NHÀ MÁY');
  if (!sheet) return;
  const siteTypeHeader = normalizeLookup(cellValue(sheet.getCell(2, 8)).text);
  const hasSiteTypeColumn = siteTypeHeader === 'SITE TYPE'
    || siteTypeHeader.includes('LOAI DIEM');
  const relevantColumns = hasSiteTypeColumn ? [2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6, 7];
  const last = lastRelevantRow(sheet, 3, relevantColumns);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(
      sheet,
      rowNumber,
      hasSiteTypeColumn ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7],
    );
    const [sequence, customerCode, name, address, billingText, strictRules, mapsUrl, rawSiteType = ''] = values;
    if (!values.some(Boolean)) {
      rows.push(templateRow(sheet.name, rowNumber, 'operational_site'));
      continue;
    }
    if (hasFormula) {
      rows.push(blockedRow(sheet.name, rowNumber, 'operational_site', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.'));
      continue;
    }
    if (!sequence || !customerCode || !name || !address) {
      rows.push(blockedRow(sheet.name, rowNumber, 'operational_site', 'MISSING_REQUIRED_FIELDS', 'Thiếu mã khách hàng, tên điểm hoặc địa chỉ.'));
      continue;
    }
    if (name.length > 255 || address.length > 8_000 || billingText.length > 8_000
      || strictRules.length > 8_000 || mapsUrl.length > 2_000) {
      rows.push(blockedRow(sheet.name, rowNumber, 'operational_site', 'FIELD_TOO_LONG', 'Một hoặc nhiều trường vượt quá độ dài cho phép.'));
      continue;
    }
    const normalizedSiteType = normalizeLookup(rawSiteType);
    const siteType = normalizedSiteType === ''
      || normalizedSiteType === 'FACTORY'
      || normalizedSiteType === 'NHA MAY'
      ? 'FACTORY'
      : normalizedSiteType === 'WAREHOUSE'
        || normalizedSiteType === 'KHO'
        || normalizedSiteType === 'KHO HANG'
        ? 'WAREHOUSE'
        : null;
    if (!siteType) {
      rows.push(blockedRow(
        sheet.name,
        rowNumber,
        'operational_site',
        'INVALID_OPERATIONAL_SITE_TYPE',
        'Loại điểm vận hành phải là Nhà máy hoặc Kho.',
      ));
      continue;
    }
    const code = `SITE-${normalizeLookup(customerCode).replace(/[^A-Z0-9]+/g, '-').slice(0, 48)}-${normalizeIdentifier(sequence).slice(0, 20)}`;
    const payload: SitePayload = {
      kind: 'operational_site',
      customerCode: normalizeLookup(customerCode),
      code,
      name,
      siteType,
      address,
      googleMapsUrl: /^https?:\/\//i.test(mapsUrl) ? mapsUrl : null,
      contactName: extractLabeledValue(address, ['người liên hệ', 'liên hệ', 'contact', 'pic'], 120),
      contactPhone: address.match(/(?:sđt|điện thoại|phone)\s*[:：-]?\s*([+0-9][0-9 .-]{7,19})/iu)?.[1]?.replace(/\s+/g, '') ?? null,
      liftFeeInvoiceName: extractLabeledValue(billingText, ['tên đơn vị', 'tên công ty', 'company'], 255),
      liftFeeInvoiceAddress: billingText || null,
      liftFeeTaxCode: billingText.match(/\b\d{10,14}\b/)?.[0] ?? null,
      strictRules: strictRules || null,
      warehouseContactInfo: null,
      liftInfo: null,
      dropInfo: null,
      cleaningInfo: null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name,
      rowNumber,
      entityType: 'operational_site',
      classification: 'ACCEPTED',
      naturalKey: `${payload.customerCode}:${payload.code}`,
      payload,
      reasonCode: null,
      redactedReason: null,
    }));
  }
}

function parsePorts(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('THÔNG TIN CẢNG BÃI');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2, 3, 4]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4]);
    const [sequence, name, address, webUrl] = values;
    if (!name || normalizeLookup(name) === 'TEN CANG') {
      rows.push(templateRow(sheet.name, rowNumber, 'port'));
      continue;
    }
    if (hasFormula) {
      rows.push(blockedRow(sheet.name, rowNumber, 'port', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.'));
      continue;
    }
    if (name.length > 255 || address.length > 8_000 || webUrl.length > 2_000) {
      rows.push(blockedRow(sheet.name, rowNumber, 'port', 'FIELD_TOO_LONG', 'Một hoặc nhiều trường vượt quá độ dài cho phép.'));
      continue;
    }
    const payload: PortPayload = {
      kind: 'port',
      code: sequence && /^\d+$/.test(sequence)
        ? `PORT-${sequence}`
        : stableCode('P-', name, 20),
      name,
      address: address || null,
      webUrl: /^https?:\/\//i.test(webUrl) ? webUrl : null,
      classification: null,
      legalEntity: null,
      isLachHuyen: false,
      position: null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name,
      rowNumber,
      entityType: 'port',
      classification: 'ACCEPTED',
      naturalKey: payload.code,
      payload,
      reasonCode: null,
      redactedReason: null,
    }));
  }
}

function parseDrivers(workbook: ExcelJS.Workbook, rows: ParsedRow[]): Set<string> {
  const acceptedNames = new Set<string>();
  const sheet = workbook.getWorksheet('DS NHÂN SỰ');
  if (!sheet) return acceptedNames;
  const last = lastRelevantRow(sheet, 5, [1, 2, 4, 5, 8]);
  for (let rowNumber = 5; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 4, 5, 8]);
    const [sequence, name, role, taxCode, phone] = values;
    const isMergedDriverSectionHeader = normalizeLookup(sequence) === 'LAI XE'
      && normalizeLookup(name) === 'LAI XE';
    if (!values.some(Boolean) || isMergedDriverSectionHeader
      || (!name && normalizeLookup(role) === 'LAI XE')) {
      rows.push(templateRow(sheet.name, rowNumber, 'driver'));
      continue;
    }
    if (normalizeLookup(role) !== 'LAI XE') {
      rows.push(classifiedRow({
        sheetName: sheet.name,
        rowNumber,
        entityType: 'personnel',
        classification: 'EXAMPLE',
        reasonCode: null,
        redactedReason: null,
      }));
      continue;
    }
    if (hasFormula || !name || name.length > 255 || normalizeIdentifier(phone).length > 20) {
      rows.push(blockedRow(
        sheet.name,
        rowNumber,
        'driver',
        hasFormula ? 'FORMULA_NOT_ALLOWED' : (!name ? 'MISSING_DRIVER_NAME' : 'FIELD_TOO_LONG'),
        hasFormula ? 'Ô dữ liệu chứa công thức và không được phép nhập.' : (!name ? 'Thiếu tên tài xế.' : 'Một hoặc nhiều trường vượt quá độ dài cho phép.'),
      ));
      continue;
    }
    const normalizedPhone = normalizeIdentifier(phone);
    const payload: DriverPayload = {
      kind: 'driver',
      name,
      phone: normalizedPhone || null,
      code: null,
      idNumber: null,
      licenseNumber: null,
      licenseExpiryDate: null,
      bankName: null,
      bankAccount: null,
      salaryType: null,
    };
    const normalizedTaxCode = normalizeIdentifier(taxCode);
    const naturalKey = normalizedTaxCode
      ? `TAX:${normalizedTaxCode}`
      : `NAME_PHONE:${normalizeLookup(name)}:${normalizedPhone}`;
    acceptedNames.add(normalizeLookup(name));
    rows.push(classifiedRow({
      sheetName: sheet.name,
      rowNumber,
      entityType: 'driver',
      classification: 'ACCEPTED',
      naturalKey,
      payload,
      reasonCode: null,
      redactedReason: null,
    }));
  }
  return acceptedNames;
}

function parseFleet(workbook: ExcelJS.Workbook, rows: ParsedRow[], driverNames: Set<string>): void {
  const sheet = workbook.getWorksheet('LOẠI HÌNH XE');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 4, [1, 2, 3, 5, 14, 15, 16, 17, 18, 19]);
  for (let rowNumber = 4; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 5, 14, 15, 16, 17, 18, 19]);
    const [, plate, trailerPlate, driverName, ...lclLayout] = values;
    if (!plate) {
      rows.push(classifiedRow({
        sheetName: sheet.name,
        rowNumber,
        entityType: 'fleet_layout',
        classification: lclLayout.some(Boolean) ? 'EXAMPLE' : 'TEMPLATE',
        reasonCode: null,
        redactedReason: null,
      }));
      continue;
    }
    if (hasFormula) {
      rows.push(blockedRow(sheet.name, rowNumber, 'fleet', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.'));
      continue;
    }
    if (driverName && !driverNames.has(normalizeLookup(driverName))) {
      rows.push(blockedRow(sheet.name, rowNumber, 'fleet', 'UNKNOWN_DRIVER', 'Biển số đang gán cho tài xế chưa có trong danh sách tài xế hợp lệ.'));
      continue;
    }
    const normalizedPlate = normalizeIdentifier(plate);
    if (!/^[A-Z0-9.-]{5,20}$/.test(normalizedPlate)) {
      rows.push(blockedRow(sheet.name, rowNumber, 'fleet', 'INVALID_PLATE', 'Biển số xe không hợp lệ.'));
      continue;
    }
    const payload: FleetPayload = {
      kind: 'fleet',
      plate: normalizedPlate,
      trailerPlate: normalizeIdentifier(trailerPlate) || null,
      trailerType: trailerPlate ? (normalizeIdentifier(trailerPlate).includes('RM') ? '40FT' : '20FT') : null,
      driverName: driverName || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name,
      rowNumber,
      entityType: 'fleet',
      classification: 'ACCEPTED',
      naturalKey: payload.plate,
      payload,
      reasonCode: null,
      redactedReason: null,
    }));
  }
}

function blockAmbiguousDriverNames(rows: ParsedRow[], acceptedDriverNames: Set<string>): void {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (row.classification !== 'ACCEPTED' || row.payload?.kind !== 'driver') continue;
    const key = normalizeLookup(row.payload.name);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    acceptedDriverNames.delete(name);
    for (const row of group) {
      row.classification = 'BLOCKED';
      row.payload = null;
      row.reasonCode = 'DUPLICATE_DRIVER_NAME';
      row.redactedReason = 'Tên tài xế bị trùng và không thể dùng để gán xe an toàn.';
    }
  }
}

function blockConflictingFleetAssignments(rows: ParsedRow[]): void {
  const driverGroups = new Map<string, ParsedRow[]>();
  const trailerGroups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (row.classification !== 'ACCEPTED' || row.payload?.kind !== 'fleet') continue;
    if (row.payload.driverName) {
      const key = normalizeLookup(row.payload.driverName);
      const group = driverGroups.get(key) ?? [];
      group.push(row);
      driverGroups.set(key, group);
    }
    if (row.payload.trailerPlate) {
      const group = trailerGroups.get(row.payload.trailerPlate) ?? [];
      group.push(row);
      trailerGroups.set(row.payload.trailerPlate, group);
    }
  }
  for (const [reasonCode, groups] of [
    ['DUPLICATE_DRIVER_ASSIGNMENT', driverGroups],
    ['DUPLICATE_TRAILER_ASSIGNMENT', trailerGroups],
  ] as const) {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const row of group) {
        row.classification = 'BLOCKED';
        row.payload = null;
        row.reasonCode = reasonCode;
        row.redactedReason = reasonCode === 'DUPLICATE_DRIVER_ASSIGNMENT'
          ? 'Một tài xế được gán cho nhiều xe trong cùng tệp.'
          : 'Một rơ-moóc được gán cho nhiều xe trong cùng tệp.';
      }
    }
  }
}

function addExampleSheetRows(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  for (const sheetName of ['MẪU BÁO GIÁ', 'MẪU DEBIT LONG MINH']) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) continue;
    rows.push(classifiedRow({
      sheetName,
      rowNumber: 1,
      entityType: 'presentation_template',
      classification: 'EXAMPLE',
      reasonCode: null,
      redactedReason: null,
    }));
  }
}

function blockDuplicateNaturalKeys(rows: ParsedRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.classification !== 'ACCEPTED' || !row.naturalKey) continue;
    const key = `${row.entityType}:${row.naturalKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    row.classification = 'BLOCKED';
    row.payload = null;
    row.reasonCode = 'DUPLICATE_NATURAL_KEY';
    row.redactedReason = 'Khóa tự nhiên bị lặp trong cùng tệp nguồn.';
  }
}

function summarizeRows(rows: ParsedRow[]): Record<string, number> {
  const summary: Record<string, number> = { TOTAL: rows.length };
  for (const row of rows) {
    summary[row.classification] = (summary[row.classification] ?? 0) + 1;
    const key = `${row.entityType}.${row.classification}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ApiError(400, 'Tệp XLSX không hợp lệ hoặc đã bị hỏng.');
  }
  if (workbook.worksheets.length > MASTER_IMPORT_MAX_SHEETS
    || workbook.worksheets.some((sheet) => (
      sheet.rowCount > MASTER_IMPORT_MAX_ROWS_PER_SHEET
      || sheet.columnCount > MASTER_IMPORT_MAX_COLUMNS_PER_SHEET
    ))) {
    throw new ApiError(413, 'Cấu trúc tệp XLSX vượt quá giới hạn xử lý.');
  }
  const rows: ParsedRow[] = [];
  const customerTaxCodeByInternalCode = parseOrganizationReferences(workbook, rows);
  parseTemplateSheet(workbook, 'THÔNG TIN KH', 3, 'customer', [2, 3, 4], rows);
  parseSites(workbook, rows);
  parseTemplateSheet(workbook, 'TUYẾN ĐƯỜNG', 3, 'route', [2, 3, 4, 5, 6], rows);
  const driverNames = parseDrivers(workbook, rows);
  blockAmbiguousDriverNames(rows, driverNames);
  parseFleet(workbook, rows, driverNames);
  blockConflictingFleetAssignments(rows);
  parsePorts(workbook, rows);
  addExampleSheetRows(workbook, rows);

  // Sep-2026 delivery sheets (Data form.xlsx + User & Role.xlsx, merged into
  // one workbook by the route before this parse runs). No-ops when absent.
  parseCustomersV2(workbook, rows);
  parseSitesV2(workbook, rows);
  parseRoutesV2(workbook, rows);
  parsePortsV2(workbook, rows);
  parseDriversV2(workbook, rows);
  parseTruckSpecs(workbook, rows);
  parseTrailerSpecs(workbook, rows);
  parseStaffUsers(workbook, rows);

  const knownSheets = new Set([
    'THÔNG TIN NCC', 'THÔNG TIN KH', 'NHÀ MÁY', 'TUYẾN ĐƯỜNG',
    'LOẠI HÌNH XE', 'MẪU BÁO GIÁ', 'THÔNG TIN CẢNG BÃI',
    'DS NHÂN SỰ', 'MẪU DEBIT LONG MINH',
    'ÁNH XẠ KHÁCH HÀNG',
    'Khách hàng', 'Nhà máy & Kho', 'Tuyến đường', 'Cảng & Bãi',
    'Đầu kéo', 'Mooc', 'User', 'Lái xe', 'Nhà xe',
  ]);
  for (const sheet of workbook.worksheets) {
    if (!knownSheets.has(sheet.name)) {
      rows.push(blockedRow(sheet.name, 1, 'unknown_sheet', 'UNKNOWN_SHEET', 'Trang tính không có ánh xạ nhập dữ liệu.'));
    }
  }
  blockDuplicateNaturalKeys(rows);
  const warningCodes = new Set<string>();
  if (rows.some((row) => row.classification === 'BLOCKED')) warningCodes.add('BLOCKED_ROWS');
  if (rows.some((row) => row.reasonCode === 'AMBIGUOUS_ORGANIZATION_ROLE')) warningCodes.add('AMBIGUOUS_ORGANIZATION_ROLE');
  if (rows.some((row) => row.reasonCode === 'UNKNOWN_SHEET')) warningCodes.add('UNKNOWN_SHEETS');
  if (!rows.some((row) => row.entityType === 'customer' && row.classification === 'ACCEPTED')) warningCodes.add('NO_CUSTOMER_ROWS');
  if (!rows.some((row) => row.entityType === 'route' && row.classification === 'ACCEPTED')) warningCodes.add('NO_ROUTE_ROWS');
  return {
    rows,
    summary: summarizeRows(rows),
    warningCodes: [...warningCodes].sort(),
    customerTaxCodeByInternalCode,
  };
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
    throw new ApiError(413, 'Tệp XLSX không được vượt quá 15 MB.');
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

// The Sep-2026 delivery is two separate workbooks (Data form.xlsx + User &
// Role.xlsx). Rather than plumb a second file through the hardened
// hash/private-storage/replay/apply-time-reparse machinery above, each file
// is validated independently, then their worksheets (cell values only — no
// styles/formulas needed by the parsers) are copied into one synthetic
// workbook. That single buffer flows through the existing single-file
// pipeline unchanged. Sheet names never collide between the two source files
// or with the legacy single-file sheets, so row identity (sheetName:rowNumber)
// stays unambiguous.
// Implementation lives in master-data-import-sep2026.service.ts (LOC budget);
// re-exported here so route imports don't need to know about the split.
export { mergeWorkbookFiles } from './master-data-import-sep2026.service';

function batchRowToDto(
  batch: typeof s.masterImportBatches.$inferSelect,
  rows: Array<typeof s.masterImportRowResults.$inferSelect>,
  rejection: { rejectedBy: number; rejectedAt: Date; rejectionReason: string } | null,
): MasterImportBatchDto {
  return {
    id: batch.id,
    sourceFileName: batch.sourceFileName,
    sourceFileHash: batch.sourceFileHash,
    parserVersion: batch.parserVersion,
    status: batch.status,
    summary: batch.summary,
    warningCodes: batch.warningCodes,
    version: batch.version,
    analyzedBy: batch.analyzedBy,
    appliedBy: batch.appliedBy,
    rejectedBy: rejection?.rejectedBy ?? null,
    analyzedAt: batch.analyzedAt.toISOString(),
    appliedAt: batch.appliedAt?.toISOString() ?? null,
    rejectedAt: rejection?.rejectedAt.toISOString() ?? null,
    rejectionReason: rejection?.rejectionReason ?? null,
    rows: rows.map((row) => ({
      id: row.id,
      sheetName: row.sheetName,
      rowNumber: row.rowNumber,
      entityType: row.entityType,
      classification: row.classification,
      reasonCode: row.reasonCode,
      redactedReason: row.redactedReason,
      appliedEntityType: row.appliedEntityType,
      appliedEntityId: row.appliedEntityId,
    })),
  };
}

async function loadBatchDto(batchId: number, client: Tx | typeof db = db): Promise<MasterImportBatchDto> {
  const [batch] = await client.select().from(s.masterImportBatches)
    .where(eq(s.masterImportBatches.id, batchId)).limit(1);
  if (!batch) throw new ApiError(404, 'Không tìm thấy lô nhập Master Data.');
  const rows = await client.select().from(s.masterImportRowResults)
    .where(eq(s.masterImportRowResults.batchId, batchId))
    .orderBy(s.masterImportRowResults.id);
  let rejection: { rejectedBy: number; rejectedAt: Date; rejectionReason: string } | null = null;
  if (batch.status === 'REJECTED') {
    const [record] = await client.select({
      createdBy: s.idempotencyKeys.createdBy,
      createdAt: s.idempotencyKeys.createdAt,
      responseSnapshot: s.idempotencyKeys.responseSnapshot,
    }).from(s.idempotencyKeys).where(and(
      eq(s.idempotencyKeys.endpoint, MASTER_IMPORT_REJECT_ENDPOINT),
      eq(s.idempotencyKeys.entityType, 'master_import_batch'),
      eq(s.idempotencyKeys.entityId, batch.id),
    )).limit(1);
    const snapshot = record?.responseSnapshot;
    const reason = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      && typeof snapshot.rejectionReason === 'string'
      ? snapshot.rejectionReason
      : null;
    if (record?.createdBy != null && reason) {
      rejection = {
        rejectedBy: record.createdBy,
        rejectedAt: record.createdAt,
        rejectionReason: reason,
      };
    }
  }
  return batchRowToDto(batch, rows, rejection);
}

function sourceExpiryDedupeKey(batchId: number, sourceFileHash: string): string {
  return `master-import-source-expiry:${batchId}:${sourceFileHash}`;
}

function privateSourceStorageKey(sourceFileHash: string): string {
  return `master-imports/${MASTER_IMPORT_PARSER_VERSION}/${sourceFileHash}.xlsx`;
}

async function schedulePrivateBatchSourceExpiry(
  tx: Tx,
  batch: Pick<typeof s.masterImportBatches.$inferSelect, 'id' | 'sourceFileHash'>,
  privateStorageKey: string,
  now = new Date(),
): Promise<void> {
  const dedupeKey = sourceExpiryDedupeKey(batch.id, batch.sourceFileHash);
  await enqueueStorageDelete(tx, {
    dedupeKey,
    payload: {
      storageKey: privateStorageKey,
      mode: STORAGE_DELETE_MODE.FINAL_DELETE,
      entityType: 'master_import_batches',
      entityId: batch.id,
    },
  });
  await tx.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.PENDING,
    attemptCount: 0,
    nextAttemptAt: new Date(now.getTime() + MASTER_IMPORT_SOURCE_RETENTION_MS),
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: null,
    completedAt: null,
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE),
    eq(s.durableEffectJobs.dedupeKey, dedupeKey),
  ));
}

async function cancelPrivateBatchSourceExpiry(
  tx: Tx,
  batch: Pick<typeof s.masterImportBatches.$inferSelect, 'id' | 'sourceFileHash'>,
): Promise<void> {
  const now = new Date();
  await tx.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.CANCELLED,
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE),
    eq(s.durableEffectJobs.dedupeKey, sourceExpiryDedupeKey(batch.id, batch.sourceFileHash)),
  ));
}

async function replayExistingAnalysis(
  batchId: number,
  sourceFileHash: string,
  file: MasterWorkbookFile,
): Promise<AnalyzeMasterWorkbookResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`master-import:${sourceFileHash}:${MASTER_IMPORT_PARSER_VERSION}`}, 0))`);
    const [batch] = await tx.select().from(s.masterImportBatches)
      .where(eq(s.masterImportBatches.id, batchId)).limit(1).for('update');
    if (!batch) throw new ApiError(404, 'Không tìm thấy lô nhập Master Data.');
    if (batch.status === 'ANALYZED') {
      const privateStorageKey = batch.privateStorageKey ?? privateSourceStorageKey(sourceFileHash);
      if (!await storageService.exists(privateStorageKey)) {
        await storageService.upload(file.buffer, privateStorageKey);
        await tx.update(s.masterImportBatches).set({ privateStorageKey })
          .where(eq(s.masterImportBatches.id, batch.id));
        await schedulePrivateBatchSourceExpiry(tx, batch, privateStorageKey);
      }
    }
    return { batch: await loadBatchDto(batch.id, tx), replayed: true };
  });
}

export async function analyzeMasterWorkbook(
  file: MasterWorkbookFile,
  actor: Pick<AuthUser, 'userId' | 'role'>,
): Promise<AnalyzeMasterWorkbookResult> {
  requireAdmin(actor);
  validateWorkbookFile(file);
  const sourceFileHash = sha256(file.buffer);
  const [existing] = await db.select({ id: s.masterImportBatches.id })
    .from(s.masterImportBatches).where(and(
      eq(s.masterImportBatches.sourceFileHash, sourceFileHash),
      eq(s.masterImportBatches.parserVersion, MASTER_IMPORT_PARSER_VERSION),
  )).limit(1);
  if (existing) {
    return replayExistingAnalysis(existing.id, sourceFileHash, file);
  }
  const parsed = await parseWorkbook(file.buffer);
  const privateStorageKey = privateSourceStorageKey(sourceFileHash);
  await storageService.upload(file.buffer, privateStorageKey);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`master-import:${sourceFileHash}:${MASTER_IMPORT_PARSER_VERSION}`}, 0))`);
      const [existing] = await tx.select().from(s.masterImportBatches).where(and(
        eq(s.masterImportBatches.sourceFileHash, sourceFileHash),
        eq(s.masterImportBatches.parserVersion, MASTER_IMPORT_PARSER_VERSION),
      )).limit(1);
      if (existing) {
        return { batch: await loadBatchDto(existing.id, tx), replayed: true };
      }

      const [batch] = await tx.insert(s.masterImportBatches).values({
        sourceFileName: path.basename(file.originalname).slice(0, 255),
        sourceFileHash,
        parserVersion: MASTER_IMPORT_PARSER_VERSION,
        privateStorageKey,
        summary: parsed.summary,
        warningCodes: parsed.warningCodes,
        analyzedBy: actor.userId,
      }).returning();
      await schedulePrivateBatchSourceExpiry(tx, batch, privateStorageKey);
      if (parsed.rows.length > 0) {
        await tx.insert(s.masterImportRowResults).values(parsed.rows.map((row) => ({
          batchId: batch.id,
          sheetName: row.sheetName,
          rowNumber: row.rowNumber,
          entityType: row.entityType,
          classification: row.classification,
          naturalKeyHash: row.naturalKey ? sha256(row.naturalKey) : null,
          payloadHash: row.payload ? sha256(JSON.stringify(row.payload)) : null,
          reasonCode: row.reasonCode,
          redactedReason: row.redactedReason,
        })));
      }
      return { batch: await loadBatchDto(batch.id, tx), replayed: false };
    });
  } catch (error) {
    const [persisted] = await db.select({ id: s.masterImportBatches.id })
      .from(s.masterImportBatches)
      .where(and(
        eq(s.masterImportBatches.sourceFileHash, sourceFileHash),
        eq(s.masterImportBatches.parserVersion, MASTER_IMPORT_PARSER_VERSION),
      )).limit(1);
    if (!persisted) await storageService.delete(privateStorageKey).catch(() => undefined);
    throw error;
  }
}

export async function getMasterImportBatch(
  batchId: number,
  actor: Pick<AuthUser, 'userId' | 'role'>,
): Promise<MasterImportBatchDto> {
  requireAdmin(actor);
  if (!Number.isInteger(batchId) || batchId < 1) throw new ApiError(400, 'ID lô nhập không hợp lệ.');
  return loadBatchDto(batchId);
}

export function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

async function applyParsedRows(
  tx: Tx,
  batchId: number,
  parsed: ParsedWorkbook,
  actorId: number,
): Promise<Record<string, number>> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'master-data-import.apply'}, 0))`);
  const persistedRows = await tx.select().from(s.masterImportRowResults)
    .where(eq(s.masterImportRowResults.batchId, batchId));
  const persistedBySource = new Map(persistedRows.map((row) => [`${row.sheetName}:${row.rowNumber}`, row]));

  for (const row of parsed.rows) {
    const persisted = persistedBySource.get(`${row.sheetName}:${row.rowNumber}`);
    if (!persisted || persisted.classification !== row.classification
      || persisted.payloadHash !== (row.payload ? sha256(JSON.stringify(row.payload)) : null)) {
      throw new ApiError(409, 'Kết quả phân tích đã thay đổi; vui lòng phân tích lại tệp.');
    }
  }

  const customerRows = await tx.select().from(s.customers).where(isNull(s.customers.deletedAt));
  const customerByTax = new Map(customerRows
    .filter((row) => row.taxCode)
    .map((row) => [normalizeIdentifier(row.taxCode!), row]));
  // Sep-2026 sites/customers reference the customer directly by shortName
  // (e.g. "LOGCOM"), not through the legacy internal-code→tax-code mapping.
  const customerByShortName = new Map(customerRows
    .filter((row) => row.shortName)
    .map((row) => [normalizeLookup(row.shortName), row]));
  const counts: Record<string, number> = {};

  // Sep-2026 customer/route/staff-user sheets — split out to
  // ../services/master-data-import-sep2026.service.ts (LOC budget). Must run
  // before the operational_site loop below, which resolves customers via
  // customerByTax/customerByShortName (mutated in place by this call).
  await applyReferenceEntities(tx, parsed.rows, persistedBySource, counts, customerByTax, customerByShortName);

  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'operational_site')) {
    const payload = row.payload as SitePayload;
    const taxCode = parsed.customerTaxCodeByInternalCode.get(payload.customerCode);
    const customer = (taxCode ? customerByTax.get(taxCode) : undefined)
      ?? customerByShortName.get(payload.customerCode);
    if (!customer) throw new ApiError(409, 'Không tìm thấy khách hàng chuẩn cho điểm vận hành đã phân tích.');
    await lockActiveCustomerIds(tx, [customer.id], 'Không tìm thấy khách hàng chuẩn cho điểm vận hành đã phân tích.');
    const [existing] = await tx.select().from(s.operationalSites).where(and(
      eq(s.operationalSites.customerId, customer.id),
      eq(s.operationalSites.code, payload.code),
      isNull(s.operationalSites.deletedAt),
    )).limit(1);
    if (existing && !existing.isActive) {
      throw new ApiError(409, 'Điểm vận hành chuẩn đang ngưng hoạt động; không tự động kích hoạt lại.');
    }
    const values = {
      customerId: customer.id,
      code: payload.code,
      name: payload.name,
      shortName: existing?.shortName.trim() || payload.name,
      siteType: payload.siteType,
      address: payload.address,
      googleMapsUrl: payload.googleMapsUrl,
      contactName: payload.contactName,
      contactPhone: payload.contactPhone,
      liftFeeInvoiceName: payload.liftFeeInvoiceName,
      liftFeeInvoiceAddress: payload.liftFeeInvoiceAddress,
      liftFeeTaxCode: payload.liftFeeTaxCode,
      strictRules: payload.strictRules,
      warehouseContactInfo: payload.warehouseContactInfo ?? existing?.warehouseContactInfo ?? null,
      liftInfo: payload.liftInfo ?? existing?.liftInfo ?? null,
      dropInfo: payload.dropInfo ?? existing?.dropInfo ?? null,
      cleaningInfo: payload.cleaningInfo ?? existing?.cleaningInfo ?? null,
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    const entity = existing
      ? (await tx.update(s.operationalSites).set({ ...values, version: sql`${s.operationalSites.version} + 1` })
        .where(eq(s.operationalSites.id, existing.id)).returning({ id: s.operationalSites.id }))[0]
      : (await tx.insert(s.operationalSites).values({ ...values, isActive: true, createdBy: actorId }).returning({ id: s.operationalSites.id }))[0];
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'operational_site', appliedEntityId: entity.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'operational_site');
  }

  const existingPorts = await tx.select().from(s.ports);
  const portsByCode = new Map(existingPorts.filter((row) => row.code).map((row) => [row.code!, row]));
  const portsByName = new Map(existingPorts.map((row) => [normalizeLookup(row.name), row]));
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'port')) {
    const payload = row.payload as PortPayload;
    // A port may already exist under a different display name for the same
    // code (legacy seeder curated shorter names, e.g. "TC - HICT"). Match by
    // code first so re-applying doesn't collide on the unique code index.
    const existing = portsByCode.get(payload.code) ?? portsByName.get(normalizeLookup(payload.name));
    if (existing?.deletedAt) {
      throw new ApiError(409, 'Cảng/bãi chuẩn đã bị ngưng; không tự động kích hoạt lại.');
    }
    const values = {
      name: existing?.name ?? payload.name,
      code: existing?.code ?? payload.code,
      address: payload.address ?? existing?.address ?? null,
      notes: payload.webUrl ? `Trang tác nghiệp: ${payload.webUrl}` : (existing?.notes ?? null),
      classification: payload.classification ?? existing?.classification ?? null,
      legalEntity: payload.legalEntity ?? existing?.legalEntity ?? null,
      isLachHuyen: payload.isLachHuyen || (existing?.isLachHuyen ?? false),
      opsPortalUrl: payload.webUrl ?? existing?.opsPortalUrl ?? null,
      position: payload.position ?? existing?.position ?? null,
      updatedAt: new Date(),
    };
    const entity = existing
      ? (await tx.update(s.ports).set(values).where(eq(s.ports.id, existing.id)).returning({ id: s.ports.id }))[0]
      : (await tx.insert(s.ports).values({ ...values, deletedAt: null }).returning({ id: s.ports.id }))[0];
    portsByCode.set(values.code, { ...(existing ?? {}), ...values, id: entity.id } as typeof s.ports.$inferSelect);
    portsByName.set(normalizeLookup(values.name), { ...(existing ?? {}), ...values, id: entity.id } as typeof s.ports.$inferSelect);
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'port', appliedEntityId: entity.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'port');
  }

  const existingDrivers = await tx.select().from(s.drivers);
  const driversByIdentity = new Map(existingDrivers.map((row) => [`${normalizeLookup(row.name)}:${normalizeIdentifier(row.phone ?? '')}`, row]));
  const driversByName = new Map(existingDrivers.map((row) => [normalizeLookup(row.name), row]));
  const driversById = new Map(existingDrivers.map((row) => [row.id, row]));
  const driversByCode = new Map(existingDrivers.filter((row) => row.code).map((row) => [row.code!, row]));
  const previouslyAppliedDriverRows = await tx.select({
    naturalKeyHash: s.masterImportRowResults.naturalKeyHash,
    appliedEntityId: s.masterImportRowResults.appliedEntityId,
  }).from(s.masterImportRowResults).where(and(
    eq(s.masterImportRowResults.entityType, 'driver'),
    eq(s.masterImportRowResults.appliedEntityType, 'driver'),
  ));
  const priorDriverIdByNaturalKeyHash = new Map(previouslyAppliedDriverRows
    .filter((row): row is { naturalKeyHash: string; appliedEntityId: number } => (
      row.naturalKeyHash != null && row.appliedEntityId != null
    ))
    .map((row) => [row.naturalKeyHash, row.appliedEntityId]));
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'driver')) {
    const payload = row.payload as DriverPayload;
    const identity = `${normalizeLookup(payload.name)}:${normalizeIdentifier(payload.phone ?? '')}`;
    const persistedSourceRow = persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!;
    const priorDriverId = persistedSourceRow.naturalKeyHash
      ? priorDriverIdByNaturalKeyHash.get(persistedSourceRow.naturalKeyHash)
      : undefined;
    const mappedExisting = (priorDriverId ? driversById.get(priorDriverId) : undefined)
      ?? (payload.code ? driversByCode.get(payload.code) : undefined)
      ?? driversByIdentity.get(identity);
    const existing = mappedExisting
      ? await lockDriverRowForUpdate(tx, mappedExisting.id, 'Không tìm thấy tài xế chuẩn cho biển số đã phân tích.')
      : null;
    if (existing && (existing.deletedAt != null || existing.status !== 'ACTIVE')) {
      throw new ApiError(409, 'Tài xế chuẩn đang ngưng hoạt động; không tự động kích hoạt lại.');
    }
    const driverValues = {
      name: payload.name,
      phone: payload.phone,
      code: payload.code ?? existing?.code ?? null,
      idNumber: payload.idNumber ?? existing?.idNumber ?? null,
      licenseNumber: payload.licenseNumber ?? existing?.licenseNumber ?? null,
      licenseExpiryDate: payload.licenseExpiryDate ?? existing?.licenseExpiryDate ?? null,
      bankName: payload.bankName ?? existing?.bankName ?? null,
      bankAccount: payload.bankAccount ?? existing?.bankAccount ?? null,
      salaryType: payload.salaryType ?? existing?.salaryType ?? null,
    };
    const entity = existing
      ? (await tx.update(s.drivers).set({ ...driverValues, updatedAt: new Date() })
        .where(eq(s.drivers.id, existing.id)).returning({ id: s.drivers.id }))[0]
      : (await tx.insert(s.drivers).values({ ...driverValues, status: 'ACTIVE' }).returning({ id: s.drivers.id }))[0];
    const resolved = { ...(existing ?? {}), id: entity.id, ...driverValues } as typeof s.drivers.$inferSelect;
    driversByIdentity.set(identity, resolved);
    driversByName.set(normalizeLookup(payload.name), resolved);
    driversById.set(entity.id, resolved);
    if (driverValues.code) driversByCode.set(driverValues.code, resolved);
    if (persistedSourceRow.naturalKeyHash) {
      priorDriverIdByNaturalKeyHash.set(persistedSourceRow.naturalKeyHash, entity.id);
    }
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'driver', appliedEntityId: entity.id })
      .where(eq(s.masterImportRowResults.id, persistedSourceRow.id));
    increment(counts, 'driver');
  }

  const existingTrailers = await tx.select().from(s.trailers);
  const trailersByPlate = new Map(existingTrailers.map((row) => [normalizeIdentifier(row.licensePlate), row]));
  const existingTrucks = await tx.select().from(s.trucks);
  const trucksByPlate = new Map(existingTrucks.map((row) => [normalizeIdentifier(row.licensePlate), row]));
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'fleet')) {
    const payload = row.payload as FleetPayload;
    let trailerId: number | null = null;
    if (payload.trailerPlate) {
      const mappedTrailer = trailersByPlate.get(payload.trailerPlate);
      const existingTrailer = mappedTrailer
        ? await lockTrailerRow(tx, mappedTrailer.id, { mode: 'update', notFoundMessage: 'Không tìm thấy rơ-moóc chuẩn đã phân tích.' })
        : null;
      if (existingTrailer && (existingTrailer.deletedAt != null || existingTrailer.status !== 'ACTIVE')) {
        throw new ApiError(409, 'Rơ-moóc chuẩn đang ngưng hoạt động; không tự động kích hoạt lại.');
      }
      const trailer = existingTrailer
        ? (await tx.update(s.trailers).set({ type: payload.trailerType!, updatedAt: new Date() })
          .where(eq(s.trailers.id, existingTrailer.id)).returning({ id: s.trailers.id }))[0]
        : (await tx.insert(s.trailers).values({ licensePlate: payload.trailerPlate, type: payload.trailerType!, status: 'ACTIVE' })
          .returning({ id: s.trailers.id }))[0];
      trailerId = trailer.id;
      trailersByPlate.set(payload.trailerPlate, { ...(existingTrailer ?? {}), id: trailer.id, licensePlate: payload.trailerPlate } as typeof s.trailers.$inferSelect);
    }
    const mappedTruck = trucksByPlate.get(payload.plate);
    const existingTruck = mappedTruck
      ? await lockTruckRow(tx, mappedTruck.id, { mode: 'update', notFoundMessage: 'Không tìm thấy xe chuẩn đã phân tích.' })
      : null;
    if (existingTruck && (existingTruck.deletedAt != null || existingTruck.status !== 'ACTIVE')) {
      throw new ApiError(409, 'Xe chuẩn đang ngưng hoạt động; không tự động kích hoạt lại.');
    }
    const [conflictingTrailerOwner] = trailerId == null
      ? []
      : await tx.select({ id: s.trucks.id }).from(s.trucks).where(and(
        eq(s.trucks.currentTrailerId, trailerId),
        existingTruck ? sql`${s.trucks.id} <> ${existingTruck.id}` : sql`true`,
        isNull(s.trucks.deletedAt),
        eq(s.trucks.status, 'ACTIVE'),
      )).limit(1).for('update');
    if (conflictingTrailerOwner) {
      throw new ApiError(409, 'Rơ-moóc đã được gán cho xe khác trong dữ liệu chuẩn.');
    }
    const truckValues = {
      trailerPlateNumber: payload.trailerPlate,
      trailerType: payload.trailerType,
      currentTrailerId: trailerId,
      updatedAt: new Date(),
    };
    const truck = existingTruck
      ? (await tx.update(s.trucks).set(truckValues).where(eq(s.trucks.id, existingTruck.id)).returning({ id: s.trucks.id }))[0]
      : (await tx.insert(s.trucks).values({ licensePlate: payload.plate, ...truckValues, status: 'ACTIVE', deletedAt: null }).returning({ id: s.trucks.id }))[0];
    trucksByPlate.set(payload.plate, { ...(existingTruck ?? {}), ...truckValues, id: truck.id, licensePlate: payload.plate } as typeof s.trucks.$inferSelect);
    if (payload.driverName) {
      const mappedDriver = driversByName.get(normalizeLookup(payload.driverName));
      if (!mappedDriver) throw new ApiError(409, 'Không tìm thấy tài xế chuẩn cho biển số đã phân tích.');
      const driver = await lockDriverRowForUpdate(tx, mappedDriver.id, 'Không tìm thấy tài xế chuẩn cho biển số đã phân tích.');
      if (driver.deletedAt != null || driver.status !== 'ACTIVE') {
        throw new ApiError(409, 'Tài xế chuẩn đang ngưng hoạt động; không tự động kích hoạt lại.');
      }
      // skipAdvisoryLock: the import already holds the driver row lock and
      // serializes its own batch; taking the truck advisory lock here would
      // invert the lock order against a concurrent PATCH assigned-driver
      // (row lock → advisory vs advisory → row lock = AB-BA deadlock).
      await reassignTruckDriverInTx(tx, {
        truckId: truck.id,
        driverId: driver.id,
        createdBy: null,
        skipAdvisoryLock: true,
      });
    }
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'truck', appliedEntityId: truck.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'fleet');
  }

  // Sep-2026 tractor/trailer spec sheets (Đầu kéo, Mooc) — split out to
  // ../services/master-data-import-sep2026.service.ts (LOC budget).
  await applyFleetSpecs(tx, parsed.rows, persistedBySource, counts, actorId, trucksByPlate, trailersByPlate, driversByName);

  return counts;
}

export async function applyMasterImport(input: {
  batchId: number;
  expectedVersion: number;
  idempotencyKey: string | undefined;
  actor: Pick<AuthUser, 'userId' | 'role'>;
}): Promise<{ result: ApplyMasterImportResult; replayed: boolean; statusCode: number }> {
  requireAdmin(input.actor);
  if (!Number.isInteger(input.batchId) || input.batchId < 1) throw new ApiError(400, 'ID lô nhập không hợp lệ.');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ApiError(400, 'expectedVersion không hợp lệ.');
  const outcome = await runIdempotent<ApplyMasterImportResult>({
    endpoint: MASTER_IMPORT_APPLY_ENDPOINT,
    idempotencyKey: input.idempotencyKey,
    payload: { batchId: input.batchId, expectedVersion: input.expectedVersion },
    createdBy: input.actor.userId,
    entityType: 'master_import_batch',
    getEntityId: (result) => result.batch.id,
    create: async (tx) => {
      const [batch] = await tx.select().from(s.masterImportBatches)
        .where(eq(s.masterImportBatches.id, input.batchId)).for('update').limit(1);
      if (!batch) throw new ApiError(404, 'Không tìm thấy lô nhập Master Data.');
      if (batch.version !== input.expectedVersion) throw new ApiError(409, 'Lô nhập đã thay đổi. Vui lòng tải lại.');
      if (batch.status !== 'ANALYZED') throw new ApiError(409, 'Lô nhập không còn ở trạng thái chờ áp dụng.');
      const [blocked] = await tx.select({ id: s.masterImportRowResults.id })
        .from(s.masterImportRowResults).where(and(
          eq(s.masterImportRowResults.batchId, batch.id),
          eq(s.masterImportRowResults.classification, 'BLOCKED'),
        )).limit(1);
      if (blocked) {
        throw new ApiError(409, 'Lô nhập còn dòng bị chặn; hãy sửa tệp và phân tích lại hoặc từ chối lô này.');
      }
      if (!batch.privateStorageKey) throw new ApiError(409, 'Không còn tệp nguồn riêng tư để áp dụng.');
      const buffer = await storageService.read(batch.privateStorageKey);
      if (!buffer || sha256(buffer) !== batch.sourceFileHash) throw new ApiError(409, 'Tệp nguồn đã thiếu hoặc thay đổi; vui lòng phân tích lại.');
      const parsed = await parseWorkbook(buffer);
      const appliedCounts = await applyParsedRows(tx, batch.id, parsed, input.actor.userId);
      await enqueuePrivateBatchSourceDeletion(tx, batch);
      await tx.update(s.masterImportBatches).set({
        status: 'APPLIED',
        version: batch.version + 1,
        privateStorageKey: null,
        appliedBy: input.actor.userId,
        appliedAt: new Date(),
      }).where(and(
        eq(s.masterImportBatches.id, batch.id),
        eq(s.masterImportBatches.version, input.expectedVersion),
      ));
      return { batch: await loadBatchDto(batch.id, tx), appliedCounts };
    },
  });
  return outcome;
}

async function enqueuePrivateBatchSourceDeletion(
  tx: Tx,
  batch: Pick<typeof s.masterImportBatches.$inferSelect, 'id' | 'sourceFileHash' | 'privateStorageKey'>,
): Promise<void> {
  if (!batch.privateStorageKey) return;
  await cancelPrivateBatchSourceExpiry(tx, batch);
  await enqueueStorageDelete(tx, {
    dedupeKey: `master-import-source-final:${batch.id}:${batch.sourceFileHash}`,
    payload: {
      storageKey: batch.privateStorageKey,
      mode: STORAGE_DELETE_MODE.FINAL_DELETE,
      entityType: 'master_import_batches',
      entityId: batch.id,
    },
  });
}

export async function rejectMasterImport(input: {
  batchId: number;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string | undefined;
  actor: Pick<AuthUser, 'userId' | 'role'>;
}): Promise<{ result: RejectMasterImportResult; replayed: boolean; statusCode: number }> {
  requireAdmin(input.actor);
  if (!Number.isInteger(input.batchId) || input.batchId < 1) throw new ApiError(400, 'ID lô nhập không hợp lệ.');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ApiError(400, 'expectedVersion không hợp lệ.');
  const reason = normalizeSpaces(input.reason);
  if (!reason || reason.length > 2_000) throw new ApiError(400, 'Lý do từ chối lô nhập là bắt buộc và không vượt quá 2.000 ký tự.');
  const outcome = await runIdempotent<RejectMasterImportResult>({
    endpoint: MASTER_IMPORT_REJECT_ENDPOINT,
    idempotencyKey: input.idempotencyKey,
    payload: { batchId: input.batchId, expectedVersion: input.expectedVersion, reason },
    createdBy: input.actor.userId,
    entityType: 'master_import_batch',
    getEntityId: (result) => result.batch.id,
    create: async (tx) => {
      const [batch] = await tx.select().from(s.masterImportBatches)
        .where(eq(s.masterImportBatches.id, input.batchId)).for('update').limit(1);
      if (!batch) throw new ApiError(404, 'Không tìm thấy lô nhập Master Data.');
      if (batch.version !== input.expectedVersion) throw new ApiError(409, 'Lô nhập đã thay đổi. Vui lòng tải lại.');
      if (batch.status !== 'ANALYZED') throw new ApiError(409, 'Lô nhập không còn ở trạng thái chờ xử lý.');
      await enqueuePrivateBatchSourceDeletion(tx, batch);
      const rejectedAt = new Date();
      await tx.update(s.masterImportBatches).set({
        status: 'REJECTED',
        version: batch.version + 1,
        privateStorageKey: null,
      }).where(and(
        eq(s.masterImportBatches.id, batch.id),
        eq(s.masterImportBatches.version, input.expectedVersion),
      ));
      const rejectedBatch = await loadBatchDto(batch.id, tx);
      return {
        batch: {
          ...rejectedBatch,
          rejectedBy: input.actor.userId,
          rejectedAt: rejectedAt.toISOString(),
          rejectionReason: reason,
        },
        rejectionReason: reason,
      };
    },
  });
  return outcome;
}
