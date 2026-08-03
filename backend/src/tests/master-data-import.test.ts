import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import { auditLogMiddleware } from '../middleware/audit';
import masterDataImportRouter from '../routes/config/master-data-import.routes';
import { disconnectRedis } from '../lib/redis';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  processDurableEffectJob,
} from '../services/durable-effect.service';
import {
  MASTER_IMPORT_PARSER_VERSION,
  MASTER_IMPORT_SOURCE_RETENTION_MS,
} from '../services/master-data-import.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const taxCode = `99${String(Date.now()).slice(-8)}`;
const customerCode = `TEST ${suffix}`;
const customerName = `Khách hàng import ${suffix}`;
const siteName = `Nhà máy import ${suffix}`;
const warehouseName = `Kho import ${suffix}`;
const portName = `Cảng import ${suffix}`;
const driverName = `Tài xế import ${suffix}`;
const driverPhone = `09${String(Date.now()).slice(-8)}`;
const truckPlate = `15A-${String(Date.now()).slice(-5)}`;
const trailerPlate = `15R-${String(Date.now() + 1).slice(-5)}`;
const unknownDriverTruckPlate = `15B-${String(Date.now() + 2).slice(-5)}`;

const userIds: number[] = [];
const batchIds: number[] = [];
const batchStorageKeys: string[] = [];
let customerId = 0;
let adminUserId = 0;
let managerUserId = 0;
let server: http.Server;
let baseUrl = '';
let fixtureBuffer: Buffer;
let applyFixtureBuffer: Buffer;
let uploadRequestSequence = 0;

function setRow(sheet: ExcelJS.Worksheet, rowNumber: number, values: unknown[]): void {
  values.forEach((value, index) => {
    sheet.getCell(rowNumber, index + 1).value = value as ExcelJS.CellValue;
  });
}

async function buildWorkbookFixture(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const organizations = workbook.addWorksheet('THÔNG TIN NCC');
  setRow(organizations, 2, ['STT', 'MÃ NỘI BỘ', 'MST', 'TÊN KHÁCH HÀNG']);
  setRow(organizations, 3, [1, customerCode, taxCode, customerName]);

  const customers = workbook.addWorksheet('THÔNG TIN KH');
  setRow(customers, 2, ['STT', 'MST', 'TÊN KHÁCH HÀNG', 'ĐỊA CHỈ']);
  setRow(customers, 3, [1, '', '', '']);

  const sites = workbook.addWorksheet('NHÀ MÁY');
  setRow(sites, 2, ['STT', 'MÃ NỘI BỘ', 'NHÀ MÁY', 'ĐỊA CHỈ', 'MST NÂNG HẠ', 'LƯU Ý', 'ĐỊNH VỊ KHO']);
  setRow(sites, 3, [1, customerCode, siteName, 'Địa chỉ thử nghiệm', `Mã số thuế ${taxCode}`, 'Tuân thủ quy định an toàn', 'https://maps.example.test/site']);

  const routes = workbook.addWorksheet('TUYẾN ĐƯỜNG');
  setRow(routes, 2, ['STT', 'TUYẾN ĐƯỜNG', 'HÀNG NHẬP', 'HÀNG XUẤT']);
  setRow(routes, 3, ['', '', '', '']);

  const fleet = workbook.addWorksheet('LOẠI HÌNH XE');
  setRow(fleet, 3, ['Loại hình xe', 'BKS', 'Ro-mooc', 'HẠN ĐĂNG KIỂM', 'Tài xế']);
  setRow(fleet, 4, ['NẶNG 2 CẦU', truckPlate, trailerPlate, '', driverName]);
  setRow(fleet, 5, ['NẶNG 2 CẦU', unknownDriverTruckPlate, '', '', `Tài xế không có ${suffix}`]);
  setRow(fleet, 6, ['', '', '', '', '', '', '', '', '', '', '', '', '', 'Xe tải', '1250KG']);

  const ports = workbook.addWorksheet('THÔNG TIN CẢNG BÃI');
  setRow(ports, 2, ['STT', 'TÊN CẢNG', 'ĐỊA CHỈ', 'LINK WEB THỰC HIỆN TÁC NGHIỆP']);
  setRow(ports, 3, ['STT', 'TÊN CẢNG', 'ĐỊA CHỈ', 'LINK WEB THỰC HIỆN TÁC NGHIỆP']);
  setRow(ports, 4, ['STT', 'TÊN CẢNG', 'ĐỊA CHỈ', 'LINK WEB THỰC HIỆN TÁC NGHIỆP']);
  setRow(ports, 5, [1, portName, 'Địa chỉ cảng thử nghiệm', 'https://port.example.test']);

  const personnel = workbook.addWorksheet('DS NHÂN SỰ');
  setRow(personnel, 4, ['STT', 'Họ Tên', 'Ngày Sinh', 'Chức vụ', 'Mã số thuế', 'Quê Quán', 'Ngày vào làm', 'Số điện thoại']);
  setRow(personnel, 5, [1, driverName, '', 'Lái xe', `0${String(Date.now()).slice(-11)}`, '', '', driverPhone]);
  setRow(personnel, 6, [2, `Nhân viên mẫu ${suffix}`, '', 'Ops', '', '', '', '']);

  workbook.addWorksheet('MẪU BÁO GIÁ').getCell('A1').value = 'DỮ LIỆU VÍ DỤ';
  workbook.addWorksheet('MẪU DEBIT LONG MINH').getCell('A1').value = 'DỮ LIỆU VÍ DỤ';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function reviseFixture(
  mutate: (workbook: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx.load as (data: unknown) => Promise<unknown>)(fixtureBuffer);
  mutate(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function requestJson(
  method: 'GET' | 'POST',
  endpoint: string,
  options: {
    role?: Role;
    userId?: number;
    body?: Record<string, unknown>;
    idempotencyKey?: string;
    file?: Buffer;
    filename?: string;
    mimeType?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    'X-Test-Role': options.role ?? Role.ADMIN,
    'X-Test-User': String(options.userId ?? adminUserId),
  };
  let body: BodyInit | undefined;
  if (options.file) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(options.file)], {
      type: options.mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), options.filename ?? 'master-data.xlsx');
    body = form;
  } else if (options.body) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.file && !options.idempotencyKey) {
    uploadRequestSequence += 1;
    headers['Idempotency-Key'] = `master-analyze-${suffix}-${uploadRequestSequence}`;
  }
  const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function trackBatch(batchId: number): Promise<void> {
  if (batchIds.includes(batchId)) return;
  const [batch] = await db.select({ key: s.masterImportBatches.privateStorageKey })
    .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batchId)).limit(1);
  batchIds.push(batchId);
  if (batch?.key) batchStorageKeys.push(batch.key);
}

before(async () => {
  fixtureBuffer = await buildWorkbookFixture();
  applyFixtureBuffer = await reviseFixture((workbook) => {
    const ambiguous = workbook.getWorksheet('THÔNG TIN NCC');
    if (ambiguous) workbook.removeWorksheet(ambiguous.id);
    const approved = workbook.addWorksheet('ÁNH XẠ KHÁCH HÀNG');
    setRow(approved, 1, ['MÃ NỘI BỘ', 'MST', 'TÊN KHÁCH HÀNG']);
    setRow(approved, 2, [customerCode, taxCode, customerName]);
    const sites = workbook.getWorksheet('NHÀ MÁY')!;
    sites.getCell('H2').value = 'LOẠI ĐIỂM';
    sites.getCell('H3').value = 'NHÀ MÁY';
    setRow(sites, 4, [2, customerCode, warehouseName, 'Địa chỉ kho thử nghiệm', '', 'Liên hệ bảo vệ trước khi vào', '', 'KHO']);
    setRow(workbook.getWorksheet('LOẠI HÌNH XE')!, 5, ['', '', '', '', '']);
  });
  const users = await db.insert(s.users).values([
    { username: `master-import-admin-${suffix}`, passwordHash: 'test-only', role: Role.ADMIN },
    { username: `master-import-manager-${suffix}`, passwordHash: 'test-only', role: Role.MANAGER },
  ]).returning({ id: s.users.id, role: s.users.role });
  userIds.push(...users.map((user) => user.id));
  adminUserId = users.find((user) => user.role === Role.ADMIN)!.id;
  managerUserId = users.find((user) => user.role === Role.MANAGER)!.id;
  const [customer] = await db.insert(s.customers).values({
    name: customerName,
    taxCode,
  }).returning({ id: s.customers.id });
  customerId = customer.id;

  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api/config/master-data-imports', (req, _res, next) => {
    const role = String(req.header('X-Test-Role') ?? Role.ADMIN) as Role;
    const userId = Number(req.header('X-Test-User') ?? adminUserId);
    req.user = {
      userId,
      username: `master-import-${userId}`,
      email: null,
      fullName: null,
      role,
    };
    next();
  }, masterDataImportRouter);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('master-data workbook analysis', () => {
  test('classifies the source workbook counts without importing blank customer/route templates', async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(directory, '../../../docs/quytrinh/File Khách Hàng/29.7 - DATA PM.xlsx');
    const source = await readFile(sourcePath);
    const response = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: source,
      filename: '29.7 - DATA PM.xlsx',
    });
    assert.ok(response.status === 200 || response.status === 201);
    const batch = response.body.batch as { id: number; summary: Record<string, number>; rows: Array<Record<string, unknown>> };
    await trackBatch(batch.id);
    assert.equal(batch.summary['operational_site.ACCEPTED'], 8);
    assert.equal(batch.summary['port.ACCEPTED'], 17);
    assert.equal(batch.summary['port.TEMPLATE'], 2);
    assert.equal(batch.summary['driver.ACCEPTED'], 32);
    assert.equal(batch.summary['customer.ACCEPTED'] ?? 0, 0);
    assert.equal(batch.summary['route.ACCEPTED'] ?? 0, 0);
    assert.ok(batch.rows.some((row) => row.entityType === 'organization'
      && row.classification === 'BLOCKED'
      && row.reasonCode === 'AMBIGUOUS_ORGANIZATION_ROLE'));
  });

  test('rejects unauthorized roles before analysis and rejects a fake XLSX signature', async () => {
    const beforeRows = await db.select({ id: s.masterImportBatches.id }).from(s.masterImportBatches);
    const unauthorized = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      role: Role.MANAGER,
      userId: managerUserId,
      file: fixtureBuffer,
    });
    assert.equal(unauthorized.status, 403);
    const afterRows = await db.select({ id: s.masterImportBatches.id }).from(s.masterImportBatches);
    assert.equal(afterRows.length, beforeRows.length);

    const invalid = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: Buffer.from('not-an-xlsx'),
      filename: 'fake.xlsx',
    });
    assert.equal(invalid.status, 415);

    const wrongType = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: fixtureBuffer,
      filename: 'valid.xlsx',
      mimeType: 'application/octet-stream',
    });
    assert.equal(wrongType.status, 415);
  });

  test('replays the same source hash and exposes only redacted row results', async () => {
    const first = await requestJson('POST', '/api/config/master-data-imports/dry-run', {
      file: fixtureBuffer,
      filename: 'fixture.xlsx',
    });
    assert.equal(first.status, 201);
    const firstBatch = first.body.batch as { id: number; rows: Array<Record<string, unknown>> };
    await trackBatch(firstBatch.id);
    const [persistedBatch] = await db.select({
      key: s.masterImportBatches.privateStorageKey,
      parserVersion: s.masterImportBatches.parserVersion,
    })
      .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, firstBatch.id)).limit(1);
    assert.ok(persistedBatch?.key);
    assert.equal(persistedBatch!.parserVersion, MASTER_IMPORT_PARSER_VERSION);
    assert.match(persistedBatch!.key!, new RegExp(`^master-imports/${MASTER_IMPORT_PARSER_VERSION}/`));
    assert.equal(await storageService.exists(persistedBatch!.key!), true);
    assert.equal('privateStorageKey' in (first.body.batch as Record<string, unknown>), false);

    const replay = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: fixtureBuffer,
      filename: 'renamed-fixture.xlsx',
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal((replay.body.batch as { id: number }).id, firstBatch.id);

    const serializedRows = JSON.stringify(firstBatch.rows);
    assert.equal(serializedRows.includes(customerName), false);
    assert.equal(serializedRows.includes(taxCode), false);
    assert.equal(serializedRows.includes(driverName), false);
    assert.equal(serializedRows.includes(driverPhone), false);
    assert.equal(serializedRows.includes('rawPayload'), false);
    const blocked = firstBatch.rows.find((row) => row.reasonCode === 'AMBIGUOUS_ORGANIZATION_ROLE');
    assert.ok(blocked);
    assert.match(String(blocked.redactedReason), /chưa được xác nhận/i);
    assert.ok(firstBatch.rows.some((row) => row.reasonCode === 'UNKNOWN_DRIVER'
      && row.classification === 'BLOCKED'));
    assert.ok(firstBatch.rows.some((row) => row.classification === 'TEMPLATE'));
    assert.ok(firstBatch.rows.some((row) => row.classification === 'EXAMPLE'));
  });

  test('isolates the current parser source from cleanup of the legacy shared key', async () => {
    const source = await reviseFixture((workbook) => {
      workbook.getWorksheet('MẪU BÁO GIÁ')!.getCell('A9').value = `parser-isolation-${suffix}`;
    });
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const legacyStorageKey = `master-imports/${sourceHash}.xlsx`;
    await storageService.upload(source, legacyStorageKey);

    const analyzed = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: source,
      filename: 'parser-isolation.xlsx',
    });
    assert.equal(analyzed.status, 201);
    const batch = analyzed.body.batch as { id: number };
    await trackBatch(batch.id);
    const [persisted] = await db.select({
      key: s.masterImportBatches.privateStorageKey,
      parserVersion: s.masterImportBatches.parserVersion,
    }).from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batch.id)).limit(1);
    assert.equal(persisted!.parserVersion, MASTER_IMPORT_PARSER_VERSION);
    assert.equal(persisted!.key, `master-imports/${MASTER_IMPORT_PARSER_VERSION}/${sourceHash}.xlsx`);

    await storageService.delete(legacyStorageKey);
    assert.equal(await storageService.exists(legacyStorageKey), false);
    assert.equal(await storageService.exists(persisted!.key!), true);
  });

  test('expires an abandoned private source durably and restores it only on an authorized same-hash upload', async () => {
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx.load as (data: unknown) => Promise<unknown>)(fixtureBuffer);
    workbook.getWorksheet('MẪU BÁO GIÁ')!.getCell('A8').value = `expiry-${suffix}`;
    const source = Buffer.from(await workbook.xlsx.writeBuffer());
    const beforeAnalyze = Date.now();
    const analyzed = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: source,
      filename: 'fixture-expiry.xlsx',
    });
    assert.equal(analyzed.status, 201);
    const batch = analyzed.body.batch as { id: number };
    await trackBatch(batch.id);
    const [persisted] = await db.select({ key: s.masterImportBatches.privateStorageKey })
      .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batch.id)).limit(1);
    assert.ok(persisted!.key);
    const jobs = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE));
    const expiryJob = jobs.find((job) => (
      job.dedupeKey.startsWith(`master-import-source-expiry:${batch.id}:`)
      && job.payload.storageKey === persisted!.key
    ));
    assert.ok(expiryJob);
    assert.equal(expiryJob.status, DURABLE_EFFECT_STATUS.PENDING);
    assert.ok(expiryJob.nextAttemptAt.getTime() >= beforeAnalyze + MASTER_IMPORT_SOURCE_RETENTION_MS);

    const [claimed] = await db.update(s.durableEffectJobs).set({
      status: DURABLE_EFFECT_STATUS.RUNNING,
      attemptCount: 1,
      leaseToken: `master-import-expiry-${suffix}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(s.durableEffectJobs.id, expiryJob.id)).returning();
    const expired = await processDurableEffectJob(claimed!);
    assert.equal(expired.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(persisted!.key!), false);

    const restored = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: source,
      filename: 'fixture-expiry-reupload.xlsx',
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.replayed, true);
    assert.equal(await storageService.exists(persisted!.key!), true);
    const [rescheduled] = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.id, expiryJob.id)).limit(1);
    assert.equal(rescheduled!.status, DURABLE_EFFECT_STATUS.PENDING);
    assert.ok(rescheduled!.nextAttemptAt.getTime() > Date.now());
  });

  test('never evaluates formula cells used by an importable row', async () => {
    const formulaWorkbook = await reviseFixture((workbook) => {
      workbook.getWorksheet('NHÀ MÁY')!.getCell('D3').value = {
        formula: '1+1',
        result: 'Nội dung không được tin cậy',
      };
    });
    const response = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: formulaWorkbook,
      filename: 'formula.xlsx',
    });
    assert.equal(response.status, 201);
    const batch = response.body.batch as { id: number; rows: Array<Record<string, unknown>> };
    await trackBatch(batch.id);
    assert.ok(batch.rows.some((row) => row.sheetName === 'NHÀ MÁY'
      && row.rowNumber === 3
      && row.classification === 'BLOCKED'
      && row.reasonCode === 'FORMULA_NOT_ALLOWED'));
    assert.equal(JSON.stringify(batch.rows).includes('Nội dung không được tin cậy'), false);
  });

  test('blocks an explicitly unsupported operational-site type instead of silently importing it as a factory', async () => {
    const invalidTypeWorkbook = await reviseFixture((workbook) => {
      const sites = workbook.getWorksheet('NHÀ MÁY')!;
      sites.getCell('H2').value = 'LOẠI ĐIỂM';
      sites.getCell('H3').value = 'BÃI TRUNG CHUYỂN';
    });
    const response = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: invalidTypeWorkbook,
      filename: 'invalid-site-type.xlsx',
    });
    assert.equal(response.status, 201);
    const batch = response.body.batch as { id: number; rows: Array<Record<string, unknown>> };
    await trackBatch(batch.id);
    assert.ok(batch.rows.some((row) => row.sheetName === 'NHÀ MÁY'
      && row.rowNumber === 3
      && row.classification === 'BLOCKED'
      && row.reasonCode === 'INVALID_OPERATIONAL_SITE_TYPE'));
  });

  test('blocks every fleet row when a driver or trailer is assigned more than once', async () => {
    const duplicateAssignments = await reviseFixture((workbook) => {
      const fleet = workbook.getWorksheet('LOẠI HÌNH XE')!;
      setRow(fleet, 5, ['NẶNG 2 CẦU', unknownDriverTruckPlate, trailerPlate, '', driverName]);
    });
    const response = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: duplicateAssignments,
      filename: 'duplicate-assignments.xlsx',
    });
    assert.equal(response.status, 201);
    const batch = response.body.batch as { id: number; rows: Array<Record<string, unknown>> };
    await trackBatch(batch.id);
    const conflictRows = batch.rows.filter((row) => (
      row.reasonCode === 'DUPLICATE_DRIVER_ASSIGNMENT'
      || row.reasonCode === 'DUPLICATE_TRAILER_ASSIGNMENT'
    ));
    assert.equal(conflictRows.length, 2);
    assert.ok(conflictRows.every((row) => row.classification === 'BLOCKED'));
  });
});

describe('master-data apply', () => {
  test('does not apply unresolved rows and lets Admin reject the batch idempotently', async () => {
    const analyze = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: fixtureBuffer,
      filename: 'fixture.xlsx',
    });
    const batch = analyze.body.batch as { id: number; version: number };
    await trackBatch(batch.id);
    const [sourceBeforeReject] = await db.select({ key: s.masterImportBatches.privateStorageKey })
      .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batch.id)).limit(1);
    assert.ok(sourceBeforeReject!.key);
    const blockedApply = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      body: { expectedVersion: batch.version },
      idempotencyKey: `master-blocked-apply-${suffix}`,
    });
    assert.equal(blockedApply.status, 409);
    assert.equal((await db.select().from(s.operationalSites).where(eq(s.operationalSites.name, siteName))).length, 0);
    assert.equal((await db.select().from(s.trucks).where(eq(s.trucks.licensePlate, truckPlate))).length, 0);

    const rejectKey = `master-reject-${suffix}`;
    const rejected = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/reject`, {
      body: { expectedVersion: batch.version, reason: 'Tệp còn dữ liệu chưa được xác nhận.' },
      idempotencyKey: rejectKey,
    });
    assert.equal(rejected.status, 200);
    const rejectedBatch = rejected.body.batch as {
      status: string;
      rejectedBy: number;
      rejectedAt: string;
      rejectionReason: string;
    };
    assert.equal(rejectedBatch.status, 'REJECTED');
    assert.equal(rejectedBatch.rejectedBy, adminUserId);
    assert.ok(Number.isFinite(Date.parse(rejectedBatch.rejectedAt)));
    assert.equal(rejectedBatch.rejectionReason, 'Tệp còn dữ liệu chưa được xác nhận.');
    assert.equal(rejected.body.replayed, false);
    const replay = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/reject`, {
      body: { expectedVersion: batch.version, reason: 'Tệp còn dữ liệu chưa được xác nhận.' },
      idempotencyKey: rejectKey,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    const deniedReplay = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/reject`, {
      role: Role.MANAGER,
      userId: adminUserId,
      body: { expectedVersion: batch.version, reason: 'Tệp còn dữ liệu chưa được xác nhận.' },
      idempotencyKey: rejectKey,
    });
    assert.equal(deniedReplay.status, 403);
    const rejectedStatus = await requestJson('GET', `/api/config/master-data-imports/${batch.id}`);
    assert.equal(rejectedStatus.body.rejectedBy, adminUserId);
    assert.equal(rejectedStatus.body.rejectionReason, 'Tệp còn dữ liệu chưa được xác nhận.');
    const [persisted] = await db.select({ key: s.masterImportBatches.privateStorageKey })
      .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batch.id)).limit(1);
    assert.equal(persisted!.key, null);
    const rejectJobs = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE));
    const rejectCleanup = rejectJobs.find((job) => (
      job.dedupeKey.startsWith(`master-import-source-final:${batch.id}:`)
      && job.payload.entityType === 'master_import_batches'
      && job.payload.entityId === batch.id
      && job.payload.storageKey === sourceBeforeReject!.key
    ));
    assert.ok(rejectCleanup);
    const [claimedRejectCleanup] = await db.update(s.durableEffectJobs).set({
      status: DURABLE_EFFECT_STATUS.RUNNING,
      attemptCount: 1,
      leaseToken: `master-import-reject-${suffix}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(s.durableEffectJobs.id, rejectCleanup.id)).returning();
    const rejectCleanupResult = await processDurableEffectJob(claimedRejectCleanup!);
    assert.equal(rejectCleanupResult.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(sourceBeforeReject!.key!), false);

    const terminalReplay = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: fixtureBuffer,
      filename: 'fixture-retry-after-reject.xlsx',
    });
    assert.equal(terminalReplay.status, 200);
    assert.equal(terminalReplay.body.replayed, true);
    assert.equal((terminalReplay.body.batch as { status: string }).status, 'REJECTED');
    assert.equal(await storageService.exists(sourceBeforeReject!.key!), false);
  });

  test('applies accepted canonical masters once and replays the same command without creating logins', async () => {
    const analyze = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: applyFixtureBuffer,
      filename: 'fixture-approved.xlsx',
    });
    const batch = analyze.body.batch as { id: number; version: number };
    await trackBatch(batch.id);
    const idempotencyKey = `master-apply-${suffix}`;
    const first = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      body: { expectedVersion: batch.version },
      idempotencyKey,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.replayed, false);
    assert.deepEqual(first.body.appliedCounts, {
      operational_site: 2,
      port: 1,
      driver: 1,
      fleet: 1,
    });
    const replay = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      body: { expectedVersion: batch.version },
      idempotencyKey,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.appliedCounts, first.body.appliedCounts);
    const deniedReplay = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      role: Role.MANAGER,
      userId: adminUserId,
      body: { expectedVersion: batch.version },
      idempotencyKey,
    });
    assert.equal(deniedReplay.status, 403);

    const [sites, ports, trucks, drivers, trailers, matchedUsers] = await Promise.all([
      db.select().from(s.operationalSites).where(and(
        eq(s.operationalSites.customerId, customerId),
        inArray(s.operationalSites.name, [siteName, warehouseName]),
      )),
      db.select().from(s.ports).where(eq(s.ports.name, portName)),
      db.select().from(s.trucks).where(eq(s.trucks.licensePlate, truckPlate)),
      db.select().from(s.drivers).where(and(eq(s.drivers.name, driverName), eq(s.drivers.phone, driverPhone))),
      db.select().from(s.trailers).where(eq(s.trailers.licensePlate, trailerPlate)),
      db.select({ id: s.users.id }).from(s.users).where(or(
        eq(s.users.phone, driverPhone),
        eq(s.users.fullName, driverName),
      )),
    ]);
    assert.equal(sites.length, 2);
    assert.deepEqual(
      sites.map((site) => [site.name, site.siteType]).sort((left, right) => left[0]!.localeCompare(right[0]!)),
      [[siteName, 'FACTORY'], [warehouseName, 'WAREHOUSE']]
        .sort((left, right) => left[0]!.localeCompare(right[0]!)),
    );
    assert.equal(ports.length, 1);
    assert.equal(trucks.length, 1);
    assert.equal(drivers.length, 1);
    assert.equal(trailers.length, 1);
    assert.equal(drivers[0]!.userId, null);
    assert.equal(drivers[0]!.assignedTruckId, trucks[0]!.id);
    assert.equal(matchedUsers.length, 0);

    const status = await requestJson('GET', `/api/config/master-data-imports/${batch.id}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'APPLIED');
    assert.equal(status.body.version, batch.version + 1);
    const [sourceAfterApply] = await db.select({ key: s.masterImportBatches.privateStorageKey })
      .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batch.id)).limit(1);
    assert.equal(sourceAfterApply!.key, null);

    const stale = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      body: { expectedVersion: batch.version },
      idempotencyKey: `${idempotencyKey}-stale`,
    });
    assert.equal(stale.status, 409);

    const missingKey = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      body: { expectedVersion: batch.version + 1 },
    });
    assert.equal(missingKey.status, 400);

    const revisedWorkbook = new ExcelJS.Workbook();
    await (revisedWorkbook.xlsx.load as (data: unknown) => Promise<unknown>)(applyFixtureBuffer);
    revisedWorkbook.getWorksheet('MẪU BÁO GIÁ')!.getCell('A2').value = `revision-${suffix}`;
    const revisedBuffer = Buffer.from(await revisedWorkbook.xlsx.writeBuffer());
    const revisedAnalysis = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: revisedBuffer,
      filename: 'fixture-revised.xlsx',
    });
    assert.equal(revisedAnalysis.status, 201);
    const revisedBatch = revisedAnalysis.body.batch as { id: number; version: number };
    assert.notEqual(revisedBatch.id, batch.id);
    await trackBatch(revisedBatch.id);
    const revisedApply = await requestJson('POST', `/api/config/master-data-imports/${revisedBatch.id}/apply`, {
      body: { expectedVersion: revisedBatch.version },
      idempotencyKey: `${idempotencyKey}-revision`,
    });
    assert.equal(revisedApply.status, 200);

    const [siteCount, portCount, truckCount, driverCount, trailerCount] = await Promise.all([
      db.select({ id: s.operationalSites.id }).from(s.operationalSites).where(and(
        eq(s.operationalSites.customerId, customerId),
        inArray(s.operationalSites.name, [siteName, warehouseName]),
      )),
      db.select({ id: s.ports.id }).from(s.ports).where(eq(s.ports.name, portName)),
      db.select({ id: s.trucks.id }).from(s.trucks).where(eq(s.trucks.licensePlate, truckPlate)),
      db.select({ id: s.drivers.id }).from(s.drivers).where(and(eq(s.drivers.name, driverName), eq(s.drivers.phone, driverPhone))),
      db.select({ id: s.trailers.id }).from(s.trailers).where(eq(s.trailers.licensePlate, trailerPlate)),
    ]);
    assert.deepEqual(
      [siteCount.length, portCount.length, truckCount.length, driverCount.length, trailerCount.length],
      [2, 1, 1, 1, 1],
    );

    await db.update(s.trucks).set({ status: 'INACTIVE' }).where(eq(s.trucks.licensePlate, truckPlate));
    const inactiveWorkbook = new ExcelJS.Workbook();
    await (inactiveWorkbook.xlsx.load as (data: unknown) => Promise<unknown>)(applyFixtureBuffer);
    inactiveWorkbook.getWorksheet('MẪU BÁO GIÁ')!.getCell('A3').value = `inactive-${suffix}`;
    const inactiveAnalysis = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: Buffer.from(await inactiveWorkbook.xlsx.writeBuffer()),
      filename: 'fixture-inactive.xlsx',
    });
    const inactiveBatch = inactiveAnalysis.body.batch as { id: number; version: number };
    await trackBatch(inactiveBatch.id);
    const inactiveApply = await requestJson('POST', `/api/config/master-data-imports/${inactiveBatch.id}/apply`, {
      body: { expectedVersion: inactiveBatch.version },
      idempotencyKey: `${idempotencyKey}-inactive`,
    });
    assert.equal(inactiveApply.status, 409);
    const [preservedTruck] = await db.select({ status: s.trucks.status })
      .from(s.trucks).where(eq(s.trucks.licensePlate, truckPlate)).limit(1);
    assert.equal(preservedTruck!.status, 'INACTIVE');
  });

  test('keeps a committed apply successful when private source deletion is temporarily unavailable', async () => {
    await db.update(s.trucks).set({ status: 'ACTIVE' }).where(eq(s.trucks.licensePlate, truckPlate));
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx.load as (data: unknown) => Promise<unknown>)(applyFixtureBuffer);
    workbook.getWorksheet('MẪU BÁO GIÁ')!.getCell('A4').value = `storage-failure-${suffix}`;
    const source = Buffer.from(await workbook.xlsx.writeBuffer());
    const analyze = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: source,
      filename: 'fixture-storage-failure.xlsx',
    });
    const batch = analyze.body.batch as { id: number; version: number };
    await trackBatch(batch.id);
    const [sourceBeforeApply] = await db.select({ key: s.masterImportBatches.privateStorageKey })
      .from(s.masterImportBatches).where(eq(s.masterImportBatches.id, batch.id)).limit(1);
    assert.ok(sourceBeforeApply!.key);

    const deleteSource = storageService.delete.bind(storageService);
    storageService.delete = async () => {
      throw new Error('storage temporarily unavailable');
    };
    try {
      const applied = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
        body: { expectedVersion: batch.version },
        idempotencyKey: `master-storage-failure-${suffix}`,
      });
      assert.equal(applied.status, 200);
    } finally {
      storageService.delete = deleteSource;
    }

    const jobs = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE));
    const cleanup = jobs.find((job) => (
      job.dedupeKey.startsWith(`master-import-source-final:${batch.id}:`)
      && job.payload.entityType === 'master_import_batches'
      && job.payload.entityId === batch.id
      && job.payload.storageKey === sourceBeforeApply!.key
    ));
    assert.ok(cleanup);
    const [firstClaim] = await db.update(s.durableEffectJobs).set({
      status: DURABLE_EFFECT_STATUS.RUNNING,
      attemptCount: 1,
      leaseToken: `master-import-failure-${suffix}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(s.durableEffectJobs.id, cleanup.id)).returning();
    const retry = await processDurableEffectJob(firstClaim!, {
      storageDelete: async () => {
        throw new Error('storage temporarily unavailable');
      },
    });
    assert.equal(retry.status, DURABLE_EFFECT_STATUS.RETRY);
    assert.equal(await storageService.exists(sourceBeforeApply!.key!), true);

    const [secondClaim] = await db.update(s.durableEffectJobs).set({
      status: DURABLE_EFFECT_STATUS.RUNNING,
      attemptCount: 2,
      leaseToken: `master-import-retry-${suffix}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(s.durableEffectJobs.id, cleanup.id)).returning();
    const succeeded = await processDurableEffectJob(secondClaim!);
    assert.equal(succeeded.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(sourceBeforeApply!.key!), false);
  });

  test('applies a legacy A:G site sheet as a factory', async () => {
    await db.update(s.trucks).set({ status: 'ACTIVE' }).where(eq(s.trucks.licensePlate, truckPlate));
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx.load as (data: unknown) => Promise<unknown>)(applyFixtureBuffer);
    const sites = workbook.getWorksheet('NHÀ MÁY')!;
    sites.getCell('H2').value = null;
    sites.getCell('H3').value = null;
    setRow(sites, 4, ['', '', '', '', '', '', '', '']);
    workbook.getWorksheet('MẪU BÁO GIÁ')!.getCell('A7').value = `legacy-sites-${suffix}`;
    const source = Buffer.from(await workbook.xlsx.writeBuffer());
    const analyzed = await requestJson('POST', '/api/config/master-data-imports/analyze', {
      file: source,
      filename: 'legacy-sites.xlsx',
    });
    assert.equal(analyzed.status, 201);
    const batch = analyzed.body.batch as { id: number; version: number };
    await trackBatch(batch.id);
    const applied = await requestJson('POST', `/api/config/master-data-imports/${batch.id}/apply`, {
      body: { expectedVersion: batch.version },
      idempotencyKey: `master-legacy-sites-${suffix}`,
    });
    assert.equal(applied.status, 200);
    const [site] = await db.select({ siteType: s.operationalSites.siteType })
      .from(s.operationalSites)
      .where(and(eq(s.operationalSites.customerId, customerId), eq(s.operationalSites.name, siteName)))
      .limit(1);
    assert.equal(site!.siteType, 'FACTORY');
  });
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const drivers = await db.select({ id: s.drivers.id }).from(s.drivers)
    .where(and(eq(s.drivers.name, driverName), eq(s.drivers.phone, driverPhone)));
  if (drivers.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, drivers.map((row) => row.id)));
  const trucks = await db.select({ id: s.trucks.id }).from(s.trucks).where(eq(s.trucks.licensePlate, truckPlate));
  if (trucks.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, trucks.map((row) => row.id)));
  const trailers = await db.select({ id: s.trailers.id }).from(s.trailers).where(eq(s.trailers.licensePlate, trailerPlate));
  if (trailers.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, trailers.map((row) => row.id)));
  await db.delete(s.operationalSites).where(and(
    eq(s.operationalSites.customerId, customerId),
    inArray(s.operationalSites.name, [siteName, warehouseName]),
  ));
  await db.delete(s.ports).where(eq(s.ports.name, portName));

  if (batchIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(and(
      inArray(s.idempotencyKeys.endpoint, ['master-data-import.apply', 'master-data-import.reject']),
      inArray(s.idempotencyKeys.createdBy, userIds),
    ));
    const storageJobs = await db.select({
      id: s.durableEffectJobs.id,
      payload: s.durableEffectJobs.payload,
    }).from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE));
    const ownedJobIds = storageJobs
      .filter((job) => (
        job.payload.entityType === 'master_import_batches'
        && typeof job.payload.entityId === 'number'
        && batchIds.includes(job.payload.entityId)
      ))
      .map((job) => job.id);
    if (ownedJobIds.length > 0) {
      await db.delete(s.durableEffectJobs).where(inArray(s.durableEffectJobs.id, ownedJobIds));
    }
    await db.delete(s.masterImportBatches).where(inArray(s.masterImportBatches.id, batchIds));
  }
  await Promise.all(batchStorageKeys.map((key) => storageService.delete(key).catch(() => undefined)));
  if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
  if (userIds.length > 0) {
    await db.transaction(async (tx) => {
      await tx.select({ id: s.users.id }).from(s.users)
        .where(inArray(s.users.id, userIds)).for('update');
      await tx.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
      await tx.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
      await tx.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.userId, userIds));
      await tx.delete(s.users).where(inArray(s.users.id, userIds));
    });
  }
  await disconnectRedis();
  await client.end();
});
