/**
 * Shared helpers cho REGRESSION PACK (local-only Playwright specs).
 *
 * Nguyên tắc (brief 2026-10-21):
 * - Mọi verify trên LOCAL dev stack (frontend :7175 · api :3002 = `make dev`).
 * - KHÔNG đụng staging — staging data immutable (user rule 21/10).
 * - Fixture data tạo qua API local, không phụ thuộc data staging; mọi lô mang
 *   prefix `REGPK-` + serial mỗi lần chạy để idempotent giữa các run.
 * - Auth: login qua API, inject `localStorage.token` TRƯỚC khi page load
 *   (SPA bounce-to-login contract — cùng pattern puppeteer-spa-auth).
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Browser, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const execFileAsync = promisify(execFile);

export const API = process.env.REG_API_URL ?? 'http://localhost:3002/api';
export const BASE = process.env.REG_BASE_URL ?? 'http://localhost:7175';
export const PASSWORD = process.env.REG_PASSWORD ?? 'Abc123';
/** Evidence dir — repo-root qa/<date>-regpack/ (AGENTS §7). */
export const SHOTS = path.resolve(process.cwd(), '..', 'qa', '2026-10-21-regpack');

mkdirSync(SHOTS, { recursive: true });

// ─── API client ───────────────────────────────────────────────────────────────

export interface Session {
  token: string;
  user: { userId?: number; id?: number; username: string; role: string };
}

export async function login(identifier: string, password = PASSWORD): Promise<Session> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`login ${identifier}: HTTP ${res.status}`);
  const body = (await res.json()) as { token: string; user: Session['user'] };
  if (!body.token) throw new Error(`login ${identifier}: no token`);
  return { token: body.token, user: body.user };
}

/** Fetch với Idempotency-Key cho mọi mutation (backend write contract). */
export async function api<T = unknown>(
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  p: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T };
}

// ─── Evidence helpers ─────────────────────────────────────────────────────────

/** Screenshot evidence vào qa/2026-10-21-regpack/. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<string> {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage !== false, timeout: 30_000 });
  return file;
}

/** Ghi text/JSON evidence (DOM dump, driver log, DB proof) vào shots dir. */
export function evidence(name: string, content: string): string {
  const file = path.join(SHOTS, name);
  writeFileSync(file, content);
  return file;
}

/** Post-click DOM/text assertion: trả về text thật của root selector. */
export async function visibleText(page: Page, selector: string): Promise<string> {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  return (await el.innerText()).trim();
}

/** DB side-effect proof qua docker exec (local dev DB :5441, AGENTS §9.3). */
export async function psql(sql: string): Promise<string> {
  const { stdout } = await execFileAsync('docker', [
    'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-tAc', sql,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

// ─── Page factory (token trước khi SPA load) ─────────────────────────────────

export interface AuthedPage {
  page: Page;
  session: Session;
  close(): Promise<void>;
}

export async function authedPage(
  browser: Browser,
  identifier: string,
  opts: { viewport?: { width: number; height: number }; storage?: Record<string, string> } = {},
): Promise<AuthedPage> {
  const session = await login(identifier);
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  const entries = { token: session.token, ...(opts.storage ?? {}) };
  await context.addInitScript((storage) => {
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }, entries);
  const page = await context.newPage();
  return {
    page,
    session,
    close: () => context.close(),
  };
}

// ─── Fixture builders ─────────────────────────────────────────────────────────

/** Mã container hợp lệ ISO 6346 (check digit đúng) từ seed. */
export function isoContainerNumber(seed: string): string {
  const serial = seed.replace(/[^0-9]/g, '').padStart(6, '0').slice(-6);
  const base = `REGU${serial}`;
  const letterValues = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38];
  const sum = [...`${base}000000`.slice(0, 10)].reduce((acc, ch, i) => {
    const code = ch.charCodeAt(0);
    const v = code >= 48 && code <= 57 ? code - 48 : letterValues[code - 65];
    return acc + v * 2 ** i;
  }, 0);
  return `${base}${sum % 11 % 10}`;
}

/** Serial duy nhất mỗi run — mọi fixture mang dấu vết này. */
export function runSerial(prefix = ''): string {
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e4)}`;
}

/**
 * Cửa sổ thời gian duy nhất mỗi run cho plannedStartAt/appointment: ngày năm
 * 2027 + giờ + PHÚT hash từ serial. Bề rộng 2h (đủ语义 KEP/chạy chuyến, hẹp
 * để không đâm head vào guard trùng lịch của các fixture run trước còn live
 * trong DB local).
 */
export function runWindow(serial: string): { start: string; end: string; appointment: string } {
  let h = 0;
  for (const ch of serial) h = (h * 131 + ch.charCodeAt(0)) % 100_000_007;
  const month = String((h % 12) + 1).padStart(2, '0');
  const day = String((Math.floor(h / 12) % 28) + 1).padStart(2, '0');
  const hour = String((Math.floor(h / 7) % 20) + 1).padStart(2, '0');
  const minute = String((Math.floor(h / 11) % 60)).padStart(2, '0');
  const start = `2027-${month}-${day}T${hour}:${minute}:00+07:00`;
  const endDate = new Date(new Date(start).getTime() + 2 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const end = `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}T${pad(endDate.getUTCHours())}:${pad(endDate.getUTCMinutes())}:00+00:00`;
  return { start, end, appointment: start };
}

/** Gán N xe nội bộ ACTIVE + lái xe tương ứng, TRỪ các xe đã loại — mỗi spec
 *  dùng xe riêng để guard trùng lịch không đụng fixture spec khác chạy song
 *  song trong cùng pack. */
export async function claimTrucks(
  token: string,
  count: number,
  excludeIds: number[] = [],
): Promise<Array<{ truckId: number; driverId: number; plate: string; driverName: string }>> {
  const [trucks, drivers] = await Promise.all([
    api<{ items: Array<{ id: number; licensePlate: string; status: string }> }>(token, 'GET', '/trucks'),
    api<{ items: Array<{ id: number; name: string; assignedTruckId: number | null }> }>(token, 'GET', '/drivers?page=1&limit=200'),
  ]);
  const active = (trucks.body.items ?? []).filter((t) => t.status === 'ACTIVE' && !excludeIds.includes(t.id));
  const byDriver = new Map((drivers.body.items ?? []).map((d) => [d.assignedTruckId, d]));
  const fallbackDriver = (drivers.body.items ?? [])[0];
  const claimed: Array<{ truckId: number; driverId: number; plate: string; driverName: string }> = [];
  for (const truck of active) {
    if (claimed.length >= count) break;
    const driver = byDriver.get(truck.id) ?? fallbackDriver;
    if (!driver) continue;
    claimed.push({ truckId: truck.id, driverId: driver.id, plate: truck.licensePlate, driverName: driver.name });
  }
  if (claimed.length < count) throw new Error(`claimTrucks: cần ${count} xe, chỉ có ${claimed.length}`);
  return claimed;
}

export interface CatalogIds {
  customerId: number;
  containerTypeId40: number;
  containerTypeId20: number;
  routeId: number;
  pickupPortId: number;
  dropoffPortId: number;
  truckId: number;
  driverId: number;
  driverUserId: number;
}

/** Catalog ids dùng chung từ dev-seed (đọc động, không hard-code). */
export async function loadCatalogs(token: string): Promise<CatalogIds> {
  const [customers, ctypes, routes, ports, trucks, drivers] = await Promise.all([
    api<{ items: Array<{ id: number }> }>(token, 'GET', '/customers?page=1&limit=5'),
    api<{ items: Array<{ id: number; code: string }> }>(token, 'GET', '/container-types'),
    api<{ items: Array<{ id: number }> }>(token, 'GET', '/routes'),
    api<{ items: Array<{ id: number }> }>(token, 'GET', '/ports'),
    api<{ items: Array<{ id: number }> }>(token, 'GET', '/trucks'),
    api<{ items: Array<{ id: number; userId: number; assignedTruckId: number | null }> }>(token, 'GET', '/drivers?page=1&limit=50'),
  ]);
  const firstTruck = (trucks.body.items ?? []).find((t) => t.id != null);
  if (!firstTruck) throw new Error('no trucks in catalog');
  const driverOnTruck = (drivers.body.items ?? []).find((d) => d.assignedTruckId === firstTruck.id)
    ?? (drivers.body.items ?? [])[0];
  if (!driverOnTruck) throw new Error('no drivers in catalog');
  const c40 = (ctypes.body.items ?? []).find((c) => c.code === '40DC');
  const c20 = (ctypes.body.items ?? []).find((c) => c.code === '20DC');
  return {
    customerId: (customers.body.items ?? [])[0]?.id ?? 1,
    containerTypeId40: c40?.id ?? 2,
    containerTypeId20: c20?.id ?? 1,
    routeId: (routes.body.items ?? [])[0]?.id ?? 1,
    pickupPortId: (ports.body.items ?? [])[0]?.id ?? 1,
    dropoffPortId: (ports.body.items ?? [])[1]?.id ?? (ports.body.items ?? [])[0]?.id ?? 2,
    truckId: firstTruck.id,
    driverId: driverOnTruck.id,
    driverUserId: driverOnTruck.userId,
  };
}

export interface ContainerSeed {
  containerTypeId: number;
  containerNumber: string | null;
  operationalSiteId?: number | null;
  routeId?: number | null;
  pickupPortId?: number | null;
  dropoffPortId?: number | null;
  cargoWeightKg?: number | null;
  customerAppointmentAt?: string | null;
  declarationNumber?: string | null;
}

export interface LotFixture {
  shipment: { id: number; version: number; status: string; shipmentCode: string };
  bill: string;
  planRow: PlanRow;
}

export interface PlanRow {
  fulfillmentId: number;
  version: number;
  shipmentVersion: number;
  shipmentId: number;
  taskStatus: string;
  dispatch: {
    tripId: number | null;
    tripStatus: string | null;
    carrierType: string | null;
    carrierName: string | null;
    assignedPlate: string | null;
    pairKind: string | null;
    assignedDriverName?: string | null;
  } | null;
  docs?: { billNumber: string | null; declarationNumbers: string[] } | null;
  container?: { containerNumber: string | null; containerTypeLabel: string | null } | null;
  customerRoute?: { customerName: string | null; factoryName: string | null } | null;
  time?: { deliveryDate: string | null; runAt: string | null } | null;
}

/** Tạo lô FCL qua POST /shipments/quick (root + containers một idempotent call). */
export async function createFclLot(
  token: string,
  opts: {
    bill: string;
    containers: ContainerSeed[];
    customerId?: number;
    cargoMode?: 'FCL' | 'LCL';
    tradeDirection?: 'IMPORT' | 'EXPORT';
    factoryName?: string;
    shippingLineName?: string;
  },
): Promise<LotFixture['shipment']> {
  const res = await api<{ id: number; version: number; status: string; shipmentCode: string }>(
    token, 'POST', '/shipments/quick', {
      customerId: opts.customerId ?? 1,
      blNumber: opts.bill,
      tradeDirection: opts.tradeDirection ?? 'IMPORT',
      cargoMode: opts.cargoMode ?? 'FCL',
      ...(opts.factoryName ? { factoryName: opts.factoryName } : {}),
      ...(opts.shippingLineName ? { shippingLineName: opts.shippingLineName } : {}),
      containers: opts.containers.map((c) => ({
        containerTypeId: c.containerTypeId,
        containerNumber: c.containerNumber ?? undefined,
        ...(c.operationalSiteId != null ? { operationalSiteId: c.operationalSiteId } : {}),
        ...(c.routeId != null ? { routeId: c.routeId } : {}),
        ...(c.pickupPortId != null ? { pickupPortId: c.pickupPortId } : {}),
        ...(c.dropoffPortId != null ? { dropoffPortId: c.dropoffPortId } : {}),
        ...(c.cargoWeightKg != null ? { cargoWeightKg: c.cargoWeightKg } : {}),
        ...(c.customerAppointmentAt ? { customerAppointmentAt: c.customerAppointmentAt } : {}),
        ...(c.declarationNumber ? { declarationNumber: c.declarationNumber } : {}),
      })),
    });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createFclLot ${opts.bill}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body;
}

/** Tạo lô LCL (routeId + ngày giao + quy cách) — READY_FOR_DISPATCH ngay. */
export async function createLclLot(
  token: string,
  opts: {
    bill: string;
    customerId?: number;
    routeId?: number;
    expectedDeliveryDate?: string;
    closingAt?: string;
    packageType?: string;
    packageCount?: number;
    cargoWeightKg?: number;
    tradeDirection?: 'IMPORT' | 'EXPORT';
  },
): Promise<{ id: number; version: number; status: string }> {
  const res = await api<{ id: number; version: number; status: string }>(token, 'POST', '/shipments/quick', {
    customerId: opts.customerId ?? 1,
    blNumber: opts.bill,
    tradeDirection: opts.tradeDirection ?? 'IMPORT',
    cargoMode: 'LCL',
    routeId: opts.routeId ?? 1,
    expectedDeliveryDate: opts.expectedDeliveryDate ?? '2027-06-07',
    packageType: opts.packageType ?? 'PALLET',
    packageCount: opts.packageCount ?? 8,
    cargoWeightKg: opts.cargoWeightKg ?? 4000,
    ...(opts.closingAt ? { closingAt: opts.closingAt } : {}),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createLclLot ${opts.bill}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body;
}

/** Tìm plan row theo query (q match bill/shipment code trên /dispatch-detail). */
export async function findPlanRow(token: string, q: string): Promise<PlanRow | null> {
  const res = await api<{ items: PlanRow[] }>(token, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=${encodeURIComponent(q)}`);
  return (res.body.items ?? [])[0] ?? null;
}

/** Lưu kế hoạch điều xe cho một fulfillment (Phân loại / nhà xe / estimates). */
export async function planRowSave(
  token: string,
  fulfillmentId: number,
  input: {
    expectedFulfillmentVersion: number;
    expectedShipmentVersion: number;
    carrierType: 'OWN' | 'EXTERNAL';
    truckId?: number | null;
    externalCarrierId?: number | null;
    classification?: 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL' | 'LCL_PICKUP';
    plannedRevenue?: number | null;
    plannedCarrierCost?: number | null;
    rigOverlapCompletedConfirmed?: boolean;
  },
): Promise<{ status: number; body: { fulfillmentVersion?: number; shipmentVersion?: number } & Record<string, unknown> }> {
  return api(token, 'PATCH', `/shipments/dispatch-detail-plan-rows/${fulfillmentId}/plan`, {
    expectedFulfillmentVersion: input.expectedFulfillmentVersion,
    expectedShipmentVersion: input.expectedShipmentVersion,
    carrierType: input.carrierType,
    ...(input.truckId != null ? { truckId: input.truckId } : {}),
    ...(input.externalCarrierId != null ? { externalCarrierId: input.externalCarrierId } : {}),
    ...(input.classification ? { classification: input.classification } : {}),
    plannedRevenue: input.plannedRevenue ?? null,
    plannedCarrierCost: input.plannedCarrierCost ?? null,
    ...(input.rigOverlapCompletedConfirmed ? { rigOverlapCompletedConfirmed: true } : {}),
  });
}

/** Phát lệnh điều xe → trip CREATED gắn truck + driver. */
export async function issueDispatch(
  token: string,
  shipmentId: number,
  input: {
    fulfillmentId: number;
    expectedVersion: number;
    plannedStartAt: string;
    plannedEndAt: string;
    carrierType: 'OWN' | 'EXTERNAL';
    truckId?: number;
    driverId?: number;
  },
): Promise<{ status: number; body: { trip?: { id: number; status: string; driverId: number | null } } & Record<string, unknown> }> {
  return api(token, 'POST', `/shipments/${shipmentId}/dispatch`, {
    fulfillmentId: input.fulfillmentId,
    expectedVersion: input.expectedVersion,
    plannedStartAt: input.plannedStartAt,
    plannedEndAt: input.plannedEndAt,
    endTimeConfirmed: false,
    carrierType: input.carrierType,
    ...(input.truckId != null ? { truckId: input.truckId } : {}),
    ...(input.driverId != null ? { driverId: input.driverId } : {}),
  });
}

/** Tạo (hoặc tái dùng) operational site riêng cho run — nhà máy có địa chỉ. */
export async function ensureSite(
  token: string,
  serial: string,
  routeId: number,
  customerId = 1,
): Promise<number> {
  const code = `REGPK-SITE-${serial}`;
  const existing = await api<{ items: Array<{ id: number; code: string }> }>(token, 'GET', `/shipments/operational-sites?customerId=${customerId}`);
  const hit = (existing.body.items ?? []).find((s) => s.code === code);
  if (hit) return hit.id;
  const res = await api<{ id: number }>(token, 'POST', '/shipments/operational-sites', {
    customerId,
    code,
    name: `NM REGPK ${serial}`,
    shortName: `NM REGPK ${serial}`,
    siteType: 'FACTORY',
    routeId,
    address: 'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh',
    isActive: true,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`ensureSite: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body.id;
}

/** Map userId → username qua admin /users surface (ADMIN token). */
export async function usernameOfUser(token: string, userId: number): Promise<string> {
  const res = await api<{ items?: Array<{ id: number; username: string }>; users?: Array<{ id: number; username: string }> }>(
    token, 'GET', '/auth/users?limit=500');
  const rows = res.body.items ?? res.body.users ?? [];
  const hit = rows.find((u) => u.id === userId);
  if (!hit) throw new Error(`usernameOfUser: no user id ${userId}`);
  return hit.username;
}

/** Chờ SPA load xong app shell (không bị bounce /login). */
export async function appReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
}
