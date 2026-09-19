import path from 'node:path';
import bcrypt from 'bcryptjs';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Role } from '@tingting/shared';

import * as s from '../db/schema';
import { ApiError } from '../errors';
import { reassignTruckDriverInTx } from './truck-driver-assignment.service';
import { lockDriverRowForUpdate, lockTrailerRow, lockTruckRow } from './application-relationship.service';
import {
  blockedRow,
  cellsForRow,
  classifiedRow,
  increment,
  lastRelevantRow,
  MASTER_IMPORT_XLSX_MIME,
  normalizeIdentifier,
  normalizeLookup,
  normalizeSpaces,
  stableCode,
  templateRow,
  validateWorkbookFile,
  type DriverPayload,
  type MasterWorkbookFile,
  type ParsedRow,
  type PortPayload,
  type SitePayload,
  type Tx,
} from './master-data-import.service';

// Two-file merge for the Sep-2026 delivery (Data form.xlsx + User &
// Role.xlsx). Each file is validated independently, then their worksheets
// (cell values only — no styles/formulas needed by the parsers below) are
// copied into one synthetic workbook so the single-file hash/private-storage/
// replay/apply-time-reparse pipeline in the main file stays untouched. Sheet
// names never collide between the two source files or with the legacy
// single-file sheets, so row identity (sheetName:rowNumber) stays unambiguous.
export async function mergeWorkbookFiles(files: MasterWorkbookFile[]): Promise<MasterWorkbookFile> {
  if (files.length === 0) throw new ApiError(400, 'Tệp XLSX là bắt buộc.');
  for (const file of files) validateWorkbookFile(file);
  // A single file (the legacy upload path) passes through untouched — hash
  // identity (dedup/replay) must stay tied to the exact original bytes, and
  // there is nothing to merge.
  if (files.length === 1) return files[0]!;
  const merged = new ExcelJS.Workbook();
  for (const file of files) {
    const source = new ExcelJS.Workbook();
    try {
      await source.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new ApiError(400, 'Tệp XLSX không hợp lệ hoặc đã bị hỏng.');
    }
    for (const sheet of source.worksheets) {
      if (merged.getWorksheet(sheet.name)) continue;
      const dest = merged.addWorksheet(sheet.name);
      sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const destRow = dest.getRow(rowNumber);
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          destRow.getCell(colNumber).value = cell.value;
        });
        destRow.commit();
      });
    }
  }
  const buffer = Buffer.from(await merged.xlsx.writeBuffer());
  return {
    buffer,
    originalname: files.map((file) => path.basename(file.originalname)).join(' + '),
    mimetype: MASTER_IMPORT_XLSX_MIME,
    size: buffer.length,
  };
}

// Sep-2026 delivery (Data form.xlsx + User & Role.xlsx) parsers + apply
// logic, split out of master-data-import.service.ts to stay under the repo's
// LOC budget. Targets the customer's current workbook shape, distinct from
// the legacy July-extract sheets parsed in the main file. Every parser below
// is a no-op when its own sheet is absent (getWorksheet returns undefined).

export interface CustomerPayload {
  kind: 'customer';
  name: string;
  shortName: string | null;
  code: string | null;
  taxCode: string | null;
  address: string | null;
  director: string | null;
  directorPhone: string | null;
  accountantName: string | null;
  accountantPhone: string | null;
  email: string | null;
  paymentTermChiHoDays: number | null;
  paymentTermCuocDays: number | null;
}

export interface RoutePayload {
  kind: 'route';
  name: string;
  code: string;
  shortName: string | null;
  loadPoint: string | null;
  distanceKm: number | null;
  tollsStations: number | null;
  note: string | null;
}

export interface TruckSpecPayload {
  kind: 'truck_spec';
  plate: string;
  driverName: string | null;
  vehicleClass: string | null;
  brand: string | null;
  towCapacityTons: number | null;
  fuelLPer100kmLoaded: number | null;
  fuelLPer100kmEmpty: number | null;
  nextInspectionDate: string | null;
  insuranceExpiryDate: string | null;
  preferredRoute: string | null;
  note: string | null;
}

export interface TrailerSpecPayload {
  kind: 'trailer_spec';
  plate: string;
  pairedTractor: string | null;
  maxPayloadTons: number | null;
  maxAxleLoadFrontTons: number | null;
  maxAxleLoadRearTons: number | null;
  inspectionDeadline: string | null;
  note: string | null;
}

export interface StaffUserPayload {
  kind: 'staff_user';
  username: string;
  employeeCode: string;
  fullName: string;
  role: typeof Role[keyof typeof Role];
}

// ─── Sep-2026 delivery parsers (Data form.xlsx + User & Role.xlsx) ─────────
// These target the customer's current workbook shape, distinct from the
// legacy July-extract sheets parsed above. Both sets run unconditionally;
// each is a no-op when its own sheet is absent (getWorksheet returns undefined).

const STAFF_ROLE_BY_GROUP: Record<string, typeof Role[keyof typeof Role]> = {
  'Ban Giám Đốc': Role.MANAGER,
  'Kế toán': Role.ACCOUNTANT,
  Ops: Role.OPS,
  'Điều vận': Role.DISPATCHER,
  Cus: Role.CUS,
};

function foldVietnamese(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'));
}

function usernameFromFullName(fullName: string): string {
  const words = normalizeSpaces(fullName).split(' ').filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return foldVietnamese(words[0]!).toLowerCase();
  const given = foldVietnamese(words[words.length - 1]!).toLowerCase();
  const initials = words.slice(0, -1).map((w) => foldVietnamese(w).slice(0, 1)).join('').toLowerCase();
  return `${given}${initials}`;
}

function titleCaseName(value: string): string {
  return normalizeSpaces(value).split(' ').map((w) => (
    w ? w[0]!.toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi') : w
  )).join(' ');
}

function parseDecimal(value: string): number | null {
  if (!value) return null;
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntStrict(value: string): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

function normalizePlateV2(value: string): string {
  return normalizeIdentifier(value);
}

export function parseCustomersV2(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Khách hàng');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2, 3, 4]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const [name, shortName, code, taxCode, address, director, directorPhone, accountantName, accountantPhone, email, chiHo, cuoc] = values;
    if (!values.some(Boolean)) { rows.push(templateRow(sheet.name, rowNumber, 'customer')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'customer', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    if (!name) { rows.push(blockedRow(sheet.name, rowNumber, 'customer', 'MISSING_REQUIRED_FIELDS', 'Thiếu tên khách hàng.')); continue; }
    const payload: CustomerPayload = {
      kind: 'customer',
      name,
      shortName: shortName || code || null,
      code: code || null,
      taxCode: taxCode || null,
      address: address || null,
      director: director || null,
      directorPhone: directorPhone || null,
      accountantName: accountantName || null,
      accountantPhone: accountantPhone || null,
      email: email || null,
      paymentTermChiHoDays: parseIntStrict(chiHo),
      paymentTermCuocDays: parseIntStrict(cuoc),
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'customer', classification: 'ACCEPTED',
      naturalKey: taxCode ? `TAX:${normalizeIdentifier(taxCode)}` : `CODE:${normalizeLookup(code || name)}`,
      payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parseSitesV2(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Nhà máy & Kho');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const [name, code, , customerCode, , address, contactName, contactPhone,
      warehouseContactInfo, note, liftInfo, dropInfo, cleaningInfo, mapsUrl] = values;
    if (!values.some(Boolean)) { rows.push(templateRow(sheet.name, rowNumber, 'operational_site')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'operational_site', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    if (!code || !name || !address || !customerCode) { rows.push(blockedRow(sheet.name, rowNumber, 'operational_site', 'MISSING_REQUIRED_FIELDS', 'Thiếu mã điểm, tên, địa chỉ hoặc mã khách hàng.')); continue; }
    const payload: SitePayload = {
      kind: 'operational_site',
      customerCode: normalizeLookup(customerCode),
      code: normalizeIdentifier(code),
      name,
      siteType: normalizeLookup(name).includes('KHO') ? 'WAREHOUSE' : 'FACTORY',
      address,
      googleMapsUrl: /^https?:\/\//i.test(mapsUrl) ? mapsUrl : null,
      contactName: contactName || null,
      contactPhone: contactPhone || null,
      liftFeeInvoiceName: null,
      liftFeeInvoiceAddress: null,
      liftFeeTaxCode: null,
      strictRules: note || null,
      warehouseContactInfo: warehouseContactInfo || null,
      liftInfo: liftInfo || null,
      dropInfo: dropInfo || null,
      cleaningInfo: cleaningInfo || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'operational_site', classification: 'ACCEPTED',
      naturalKey: `${payload.customerCode}:${payload.code}`, payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parseRoutesV2(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Tuyến đường');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7]);
    const [code, , shortName, loadPoint, km, tolls, note] = values;
    if (!values.some(Boolean)) { rows.push(templateRow(sheet.name, rowNumber, 'route')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'route', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    if (!code) { rows.push(blockedRow(sheet.name, rowNumber, 'route', 'MISSING_REQUIRED_FIELDS', 'Thiếu mã tuyến.')); continue; }
    const payload: RoutePayload = {
      kind: 'route',
      name: code,
      code,
      shortName: shortName || null,
      loadPoint: loadPoint || null,
      distanceKm: parseIntStrict(km),
      tollsStations: parseIntStrict(tolls),
      note: note || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'route', classification: 'ACCEPTED',
      naturalKey: `NAME:${normalizeLookup(code)}`, payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parsePortsV2(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Cảng & Bãi');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7, 16]);
    const [name, code, classification, legalEntity, address, webUrl, position] = values;
    if (!values.some(Boolean)) { rows.push(templateRow(sheet.name, rowNumber, 'port')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'port', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    if (!name) { rows.push(blockedRow(sheet.name, rowNumber, 'port', 'MISSING_REQUIRED_FIELDS', 'Thiếu tên cảng/bãi.')); continue; }
    const payload: PortPayload = {
      kind: 'port',
      code: code ? normalizeIdentifier(code) : stableCode('P-', name, 20),
      name,
      address: address || null,
      webUrl: /^https?:\/\//i.test(webUrl) ? webUrl : null,
      classification: classification || null,
      legalEntity: legalEntity || null,
      position: position || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'port', classification: 'ACCEPTED',
      naturalKey: payload.code, payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parseDriversV2(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Lái xe');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const [code, name, cccd, gplx, gplxExpiry, phone, bankName, bankAccount, salaryType] = values;
    if (!values.some(Boolean)) { rows.push(templateRow(sheet.name, rowNumber, 'driver')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'driver', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    if (!code || !name) { rows.push(blockedRow(sheet.name, rowNumber, 'driver', 'MISSING_DRIVER_NAME', 'Thiếu mã tài xế hoặc họ tên.')); continue; }
    const payload: DriverPayload = {
      kind: 'driver',
      name: titleCaseName(name),
      phone: normalizeIdentifier(phone) || null,
      code: normalizeIdentifier(code),
      idNumber: cccd || null,
      licenseNumber: gplx || null,
      licenseExpiryDate: gplxExpiry || null,
      bankName: bankName || null,
      bankAccount: bankAccount || null,
      salaryType: salaryType || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'driver', classification: 'ACCEPTED',
      naturalKey: `CODE:${payload.code}`, payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parseTruckSpecs(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Đầu kéo');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const [plateRaw, driverName, vehicleClass, brand, tow, fuelLoaded, fuelEmpty, inspect, insurance, route, note] = values;
    if (!plateRaw) { rows.push(templateRow(sheet.name, rowNumber, 'truck_spec')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'truck_spec', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    const plate = normalizePlateV2(plateRaw);
    if (!/^[A-Z0-9.-]{5,20}$/.test(plate)) { rows.push(blockedRow(sheet.name, rowNumber, 'truck_spec', 'INVALID_PLATE', 'Biển số xe không hợp lệ.')); continue; }
    const payload: TruckSpecPayload = {
      kind: 'truck_spec',
      plate,
      driverName: driverName ? titleCaseName(driverName) : null,
      vehicleClass: vehicleClass || null,
      brand: brand || null,
      towCapacityTons: parseDecimal(tow),
      fuelLPer100kmLoaded: parseDecimal(fuelLoaded),
      fuelLPer100kmEmpty: parseDecimal(fuelEmpty),
      nextInspectionDate: inspect || null,
      insuranceExpiryDate: insurance || null,
      preferredRoute: route || null,
      note: note || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'truck_spec', classification: 'ACCEPTED',
      naturalKey: `PLATE:${plate}`, payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parseTrailerSpecs(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('Mooc');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3, 4, 5, 6, 7, 8]);
    const [plateRaw, pairedRaw, , maxLoad, front, rear, inspect, note] = values;
    if (!plateRaw) { rows.push(templateRow(sheet.name, rowNumber, 'trailer_spec')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'trailer_spec', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    const plate = normalizePlateV2(plateRaw);
    if (!/^[A-Z0-9.-]{5,20}$/.test(plate)) { rows.push(blockedRow(sheet.name, rowNumber, 'trailer_spec', 'INVALID_PLATE', 'Biển số rơ-moóc không hợp lệ.')); continue; }
    const payload: TrailerSpecPayload = {
      kind: 'trailer_spec',
      plate,
      pairedTractor: pairedRaw ? normalizePlateV2(pairedRaw) : null,
      maxPayloadTons: parseDecimal(maxLoad),
      maxAxleLoadFrontTons: parseDecimal(front),
      maxAxleLoadRearTons: parseDecimal(rear),
      inspectionDeadline: inspect || null,
      note: note || null,
    };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'trailer_spec', classification: 'ACCEPTED',
      naturalKey: `PLATE:${plate}`, payload, reasonCode: null, redactedReason: null,
    }));
  }
}

export function parseStaffUsers(workbook: ExcelJS.Workbook, rows: ParsedRow[]): void {
  const sheet = workbook.getWorksheet('User');
  if (!sheet) return;
  const last = lastRelevantRow(sheet, 3, [1, 2]);
  for (let rowNumber = 3; rowNumber <= last; rowNumber += 1) {
    const { values, hasFormula } = cellsForRow(sheet, rowNumber, [1, 2, 3]);
    const [code, name, roleGroup] = values;
    if (!values.some(Boolean)) { rows.push(templateRow(sheet.name, rowNumber, 'staff_user')); continue; }
    if (hasFormula) { rows.push(blockedRow(sheet.name, rowNumber, 'staff_user', 'FORMULA_NOT_ALLOWED', 'Ô dữ liệu chứa công thức và không được phép nhập.')); continue; }
    if (!code || !name) { rows.push(blockedRow(sheet.name, rowNumber, 'staff_user', 'MISSING_REQUIRED_FIELDS', 'Thiếu mã nhân viên hoặc họ tên.')); continue; }
    const role = STAFF_ROLE_BY_GROUP[normalizeSpaces(roleGroup)];
    if (!role) { rows.push(blockedRow(sheet.name, rowNumber, 'staff_user', 'UNKNOWN_ROLE_GROUP', 'Phân quyền không nằm trong danh sách hợp lệ.')); continue; }
    const fullName = titleCaseName(name);
    const username = usernameFromFullName(fullName);
    if (!username) { rows.push(blockedRow(sheet.name, rowNumber, 'staff_user', 'MISSING_REQUIRED_FIELDS', 'Không tạo được tên đăng nhập từ họ tên.')); continue; }
    const payload: StaffUserPayload = { kind: 'staff_user', username, employeeCode: normalizeIdentifier(code), fullName, role };
    rows.push(classifiedRow({
      sheetName: sheet.name, rowNumber, entityType: 'staff_user', classification: 'ACCEPTED',
      naturalKey: `CODE:${payload.employeeCode}`, payload, reasonCode: null, redactedReason: null,
    }));
  }
}


export async function applyReferenceEntities(
  tx: Tx,
  rows: ParsedRow[],
  persistedBySource: Map<string, typeof s.masterImportRowResults.$inferSelect>,
  counts: Record<string, number>,
  customerByTax: Map<string, typeof s.customers.$inferSelect>,
  customerByShortName: Map<string, typeof s.customers.$inferSelect>,
): Promise<void> {
  const parsed = { rows };
  // Customers first: sites (below) resolve their owning customer by
  // tax code or shortName, so a customer created in this same batch must
  // already be reflected in customerByTax/customerByShortName.
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'customer')) {
    const payload = row.payload as CustomerPayload;
    const existing = (payload.taxCode ? customerByTax.get(normalizeIdentifier(payload.taxCode)) : undefined)
      ?? (payload.shortName ? customerByShortName.get(normalizeLookup(payload.shortName)) : undefined);
    const values = {
      name: payload.name,
      shortName: payload.shortName ?? existing?.shortName ?? '',
      code: payload.code ?? existing?.code ?? null,
      taxCode: payload.taxCode ?? existing?.taxCode ?? null,
      address: payload.address ?? existing?.address ?? null,
      contactPerson: payload.director ?? existing?.contactPerson ?? null,
      phone: payload.directorPhone ?? existing?.phone ?? null,
      accountantName: payload.accountantName ?? existing?.accountantName ?? null,
      accountantPhone: payload.accountantPhone ?? existing?.accountantPhone ?? null,
      contactInfo: payload.email ?? existing?.contactInfo ?? null,
      agencyFeePaymentTermDays: payload.paymentTermChiHoDays ?? existing?.agencyFeePaymentTermDays ?? null,
      paymentTermDays: payload.paymentTermCuocDays ?? existing?.paymentTermDays ?? null,
      updatedAt: new Date(),
    };
    const entity = existing
      ? (await tx.update(s.customers).set(values).where(eq(s.customers.id, existing.id)).returning())[0]!
      : (await tx.insert(s.customers).values({ ...values, status: 'ACTIVE', debitNoteMode: 'MONTHLY' }).returning())[0]!;
    customerByTax.set(normalizeIdentifier(entity.taxCode ?? ''), entity);
    if (entity.shortName) customerByShortName.set(normalizeLookup(entity.shortName), entity);
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'customer', appliedEntityId: entity.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'customer');
  }

  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'route')) {
    const payload = row.payload as RoutePayload;
    const [existing] = await tx.select().from(s.routes).where(and(
      isNull(s.routes.deletedAt),
      eq(sql`lower(btrim(${s.routes.name}))`, payload.name.trim().toLowerCase()),
    )).limit(1);
    const values = {
      name: payload.name,
      code: payload.code,
      shortName: payload.shortName ?? existing?.shortName ?? '',
      loadPoint: payload.loadPoint ?? existing?.loadPoint ?? null,
      note: payload.note ?? existing?.note ?? null,
      distanceKm: payload.distanceKm ?? existing?.distanceKm ?? null,
      tollsStations: payload.tollsStations ?? existing?.tollsStations ?? null,
      updatedAt: new Date(),
    };
    const entity = existing
      ? (await tx.update(s.routes).set(values).where(eq(s.routes.id, existing.id)).returning({ id: s.routes.id }))[0]!
      : (await tx.insert(s.routes).values(values).returning({ id: s.routes.id }))[0]!;
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'route', appliedEntityId: entity.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'route');
  }

  // Staff logins: new accounts get a bootstrap password (Abc123, same as
  // pnpm seed:prod) and must reset it before real use. Existing accounts keep
  // whatever password they already have — an admin re-upserting the roster
  // must never silently reset a login someone is actively using.
  const bootstrapPasswordHash = await bcrypt.hash('Abc123', 10);
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'staff_user')) {
    const payload = row.payload as StaffUserPayload;
    const [existing] = await tx.select().from(s.users).where(
      eq(sql`lower(btrim(${s.users.username}))`, payload.username),
    ).limit(1);
    const entity = existing
      ? (await tx.update(s.users).set({
        employeeCode: payload.employeeCode, fullName: payload.fullName, role: payload.role, updatedAt: new Date(),
      }).where(eq(s.users.id, existing.id)).returning({ id: s.users.id }))[0]!
      : (await tx.insert(s.users).values({
        username: payload.username, employeeCode: payload.employeeCode, fullName: payload.fullName,
        role: payload.role, passwordHash: bootstrapPasswordHash, status: 'ACTIVE',
      }).returning({ id: s.users.id }))[0]!;
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'user', appliedEntityId: entity.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'staff_user');
  }

}

export async function applyFleetSpecs(
  tx: Tx,
  rows: ParsedRow[],
  persistedBySource: Map<string, typeof s.masterImportRowResults.$inferSelect>,
  counts: Record<string, number>,
  actorId: number,
  trucksByPlate: Map<string, typeof s.trucks.$inferSelect>,
  trailersByPlate: Map<string, typeof s.trailers.$inferSelect>,
  driversByName: Map<string, typeof s.drivers.$inferSelect>,
): Promise<void> {
  const parsed = { rows };
  // Tractor spec sheet (Đầu kéo): enriches/creates the truck by plate and
  // optionally pairs it with a driver by name — additive to the 'fleet'
  // block above, which owns trailer-plate/trailer-type assignment instead.
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'truck_spec')) {
    const payload = row.payload as TruckSpecPayload;
    const mappedTruck = trucksByPlate.get(payload.plate);
    const existingTruck = mappedTruck
      ? await lockTruckRow(tx, mappedTruck.id, { mode: 'update', notFoundMessage: 'Không tìm thấy xe chuẩn đã phân tích.' })
      : null;
    const numToStr = (v: number | null): string | null => (v == null ? null : String(v));
    const truckValues = {
      vehicleClass: payload.vehicleClass ?? existingTruck?.vehicleClass ?? null,
      brand: payload.brand ?? existingTruck?.brand ?? null,
      towCapacityTons: numToStr(payload.towCapacityTons) ?? existingTruck?.towCapacityTons ?? null,
      fuelLPer100kmLoaded: numToStr(payload.fuelLPer100kmLoaded) ?? existingTruck?.fuelLPer100kmLoaded ?? null,
      fuelLPer100kmEmpty: numToStr(payload.fuelLPer100kmEmpty) ?? existingTruck?.fuelLPer100kmEmpty ?? null,
      nextInspectionDate: payload.nextInspectionDate ?? existingTruck?.nextInspectionDate ?? null,
      insuranceExpiryDate: payload.insuranceExpiryDate ?? existingTruck?.insuranceExpiryDate ?? null,
      preferredRoute: payload.preferredRoute ?? existingTruck?.preferredRoute ?? null,
      note: payload.note ?? existingTruck?.note ?? null,
      updatedAt: new Date(),
    };
    const truck = existingTruck
      ? (await tx.update(s.trucks).set(truckValues).where(eq(s.trucks.id, existingTruck.id)).returning({ id: s.trucks.id }))[0]!
      : (await tx.insert(s.trucks).values({ licensePlate: payload.plate, status: 'ACTIVE', ...truckValues }).returning({ id: s.trucks.id }))[0]!;
    trucksByPlate.set(payload.plate, { ...(existingTruck ?? {}), ...truckValues, id: truck.id, licensePlate: payload.plate } as typeof s.trucks.$inferSelect);
    if (payload.driverName) {
      const mappedDriver = driversByName.get(normalizeLookup(payload.driverName));
      if (mappedDriver) {
        const driver = await lockDriverRowForUpdate(tx, mappedDriver.id, 'Không tìm thấy tài xế chuẩn cho biển số đã phân tích.');
        if (driver.deletedAt == null && driver.status === 'ACTIVE') {
          await reassignTruckDriverInTx(tx, { truckId: truck.id, driverId: driver.id, createdBy: actorId, skipAdvisoryLock: true });
        }
      }
    }
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'truck', appliedEntityId: truck.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'truck_spec');
  }

  // Trailer spec sheet (Mooc): enrich/create by plate; type stays null when
  // the sheet's Loại Moóc is blank (trailers.type is nullable — see 0046).
  for (const row of parsed.rows.filter((candidate) => candidate.classification === 'ACCEPTED' && candidate.payload?.kind === 'trailer_spec')) {
    const payload = row.payload as TrailerSpecPayload;
    const numToStr = (v: number | null): string | null => (v == null ? null : String(v));
    const mappedTrailer = trailersByPlate.get(payload.plate);
    const existingTrailer = mappedTrailer
      ? await lockTrailerRow(tx, mappedTrailer.id, { mode: 'update', notFoundMessage: 'Không tìm thấy rơ-moóc chuẩn đã phân tích.' })
      : null;
    const trailerValues = {
      maxPayloadTons: numToStr(payload.maxPayloadTons) ?? existingTrailer?.maxPayloadTons ?? null,
      maxAxleLoadFrontTons: numToStr(payload.maxAxleLoadFrontTons) ?? existingTrailer?.maxAxleLoadFrontTons ?? null,
      maxAxleLoadRearTons: numToStr(payload.maxAxleLoadRearTons) ?? existingTrailer?.maxAxleLoadRearTons ?? null,
      inspectionDeadline: payload.inspectionDeadline ?? existingTrailer?.inspectionDeadline ?? null,
      note: payload.note ?? existingTrailer?.note ?? null,
      updatedAt: new Date(),
    };
    const trailer = existingTrailer
      ? (await tx.update(s.trailers).set(trailerValues).where(eq(s.trailers.id, existingTrailer.id)).returning({ id: s.trailers.id }))[0]!
      : (await tx.insert(s.trailers).values({ licensePlate: payload.plate, status: 'ACTIVE', ...trailerValues }).returning({ id: s.trailers.id }))[0]!;
    trailersByPlate.set(payload.plate, { ...(existingTrailer ?? {}), ...trailerValues, id: trailer.id, licensePlate: payload.plate } as typeof s.trailers.$inferSelect);
    if (payload.pairedTractor) {
      const truckRow = trucksByPlate.get(payload.pairedTractor);
      if (truckRow) {
        // Same transfer semantics as the catalog CRUD: pairing T to THIS
        // truck clears any OTHER truck's link to T in the same transaction —
        // without it two trucks would display the same trailer. (The
        // fleet-payload import REJECTS on conflict instead; both are valid
        // policies, but CRUD + this path agree on auto-clear.)
        await tx.update(s.trucks)
          .set({ currentTrailerId: null, updatedAt: new Date() })
          .where(and(
            eq(s.trucks.currentTrailerId, trailer.id),
            ne(s.trucks.id, truckRow.id),
          ));
        await tx.update(s.trucks).set({ trailerPlateNumber: payload.plate, currentTrailerId: trailer.id, updatedAt: new Date() })
          .where(eq(s.trucks.id, truckRow.id));
      }
    }
    await tx.update(s.masterImportRowResults).set({ appliedEntityType: 'trailer', appliedEntityId: trailer.id })
      .where(eq(s.masterImportRowResults.id, persistedBySource.get(`${row.sheetName}:${row.rowNumber}`)!.id));
    increment(counts, 'trailer_spec');
  }

}
