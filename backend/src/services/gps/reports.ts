import { portalPost, isPortalConfigured } from './portalClient';
import { portalProvider } from './providers/portalProvider';
import { normalizePlate } from './parse';

/**
 * Bách Khoa report service — typed access to every web-portal report endpoint.
 * All reports share one call pattern (POST form `{ carId, dateF, timeF, dateT,
 * timeT, ... }` → HTML table); this module turns each into structured data.
 *
 * `carId` is the portal CarID (NOT the DeviceId). Resolve it from a plate via
 * `resolveCarId()`, which reads it from the live get_AllTIBase payload.
 */

export interface ReportRange {
  /** YYYY-MM-DD inclusive */
  dateFrom: string;
  /** YYYY-MM-DD inclusive (defaults to dateFrom) */
  dateTo?: string;
}

// ─── HTML table parsing ──────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Extract <tr><td>…</td></tr> rows into cell-text arrays. */
function parseTable(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()),
    );
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}

/** "HH:mm:ss - dd/MM/yyyy" | "HH:mm dd/MM/yyyy" | "HH:mm:ss -- dd/MM/yyyy" → Date (UTC+7). */
function parsePortalDateTime(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2}):(\d{2}):?(\d{2})?\s*[-—\s]+\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, hh, mm, ss, dd, mo, yyyy] = m;
  const utcMs = Date.UTC(+yyyy, +mo - 1, +dd, +hh, +mm, +(ss ?? 0)) - 7 * 60 * 60 * 1000;
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d;
}

/** "HH:mm:ss" | "01:42:10" → seconds. Also handles "MMm" style loosely. */
function durationToSec(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

/** Parse a number. NOTE: the portal outputs decimals with a '.' (e.g. "327.97"
 *  km, "106.72185" coords), so '.' is treated as the decimal separator. */
function toNum(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.toString().trim().replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function dateToPortal(iso: string): string {
  // YYYY-MM-DD → dd/MM/yyyy
  const [, y, m, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? [];
  if (!y) return iso;
  return `${d}/${m}/${y}`;
}

async function fetchReport(
  carId: number,
  path: string,
  range: ReportRange,
  opts: { extra?: Record<string, string>; omitTimes?: boolean; referer?: string } = {},
): Promise<string> {
  const dateFrom = dateToPortal(range.dateFrom);
  const dateTo = dateToPortal(range.dateTo ?? range.dateFrom);
  const fields: Record<string, string> = opts.omitTimes
    ? { carId: String(carId), dateF: dateFrom, dateE: dateTo }
    : { carId: String(carId), dateF: dateFrom, timeF: '00:00', dateT: dateTo, timeT: '23:59', timeS: '0', ...(opts.extra ?? {}) };
  const body = new URLSearchParams(fields).toString();
  const { status, text } = await portalPost(path, body, { referer: opts.referer ?? 'Home/Index' });
  if (status !== 200) throw new Error(`${path} → HTTP ${status}`);
  return text;
}

/** Keep only data rows — drop header rows ("#", "STT", "Biển số", …) and totals. */
function dataRows(rows: string[][]): string[][] {
  return rows.filter((r) => {
    const c0 = (r[0] ?? '').trim();
    if (!c0 || /^tổng/i.test(c0)) return false;
    return !/^(#|stt|biển\s*số|ngày|thời điểm|báo cáo)/i.test(c0);
  });
}

/** True if the table's header row matches `re` — guards fixed-index parsers
 *  against silently misattributing fields if the vendor changes column layout. */
function headerOk(rows: string[][], re: RegExp): boolean {
  return Boolean(rows[0]) && re.test(rows[0].join(' '));
}

// ─── carId resolution ────────────────────────────────────────────────────────

/**
 * Resolve a vehicle's portal CarID from its plate (read from live data).
 * Returns null if not configured / not found.
 */
export async function resolveCarId(plate: string): Promise<number | null> {
  if (!(await isPortalConfigured())) return null;
  const vehicles = await portalProvider.fetchVehicles();
  const norm = normalizePlate(plate);
  const v = vehicles.find((x) => normalizePlate(x.numberPlate) === norm);
  return v?.carId ?? null;
}

// ─── Report result types + methods ───────────────────────────────────────────

export interface StopEvent { startTime: string | null; endTime: string | null; durationSec: number | null; address: string | null; lat: number | null; lng: number | null; }
export interface StopDetailReport { stops: StopEvent[]; totals: { stopSec: number | null; moveSec: number | null; activeSec: number | null; }; }

/** Detail stop report — each stop with start/end/duration/address + totals. = "how long stopped". */
export async function getStopDetail(carId: number, range: ReportRange): Promise<StopDetailReport> {
  const html = await fetchReport(carId, '/ReportDN/_ResultReportsDetailStop', range, { referer: 'ReportDN/DetailStop' });
  const rows = parseTable(html);
  // columns: #, Biển số, Bắt đầu, Kết thúc, Thời gian dừng, Địa điểm, Kinh độ,Vĩ độ, Lộ trình
  const joinedAll = rows.map((r) => r.join(' ')).join(' | ');
  const findDur = (label: string): number | null => {
    const m = joinedAll.match(new RegExp(`${label}[^:]*:\\s*(\\d{1,2}:\\d{2}:\\d{2})`, 'i'));
    return m ? durationToSec(m[1]) : null;
  };
  const totals = {
    stopSec: findDur('thời gian dừng'),
    moveSec: findDur('thời gian di chuyển'),
    activeSec: findDur('thời gian hoạt động'),
  };
  const stops: StopEvent[] = dataRows(rows)
    .filter((r) => /\d/.test(r[0] ?? '') && r.length >= 6)
    .map((r) => {
      const ll = (r[6] ?? '').split(',');
      return {
        startTime: toIso(parsePortalDateTime(r[2] ?? '')),
        endTime: toIso(parsePortalDateTime(r[3] ?? '')),
        durationSec: durationToSec(r[4]),
        address: r[5] ?? null,
        lat: toNum(ll[0]?.trim()),
        lng: toNum(ll[1]?.trim()),
      };
    });
  return { stops, totals };
}

export interface TripSegment { startTime: string | null; endTime: string | null; durationSec: number | null; distanceKm: number | null; fromAddress: string | null; toAddress: string | null; driver: string | null; }
/** Trip segments — each drive leg between stops with distance/duration/from-to. */
export async function getTripSegments(carId: number, range: ReportRange): Promise<TripSegment[]> {
  const html = await fetchReport(carId, '/ReportDN/_ResultReportsGetTrip', range, { referer: 'ReportDN/GetTrip' });
  const rows = dataRows(parseTable(html));
  // #, Biển số, Lái xe, Bắt đầu, Kết thúc, Thời gian, Quãng đường, Địa điểm bắt đầu, Địa điểm kết thúc
  return rows
    .filter((r) => /\d/.test(r[0] ?? '') && r.length >= 8)
    .map((r) => ({
      startTime: toIso(parsePortalDateTime(r[3] ?? '')),
      endTime: toIso(parsePortalDateTime(r[4] ?? '')),
      durationSec: durationToSec(r[5]),
      distanceKm: toNum(r[6]),
      fromAddress: r[7] ?? null,
      toAddress: r[8] ?? null,
      driver: r[2] || null,
    }));
}

export interface JourneyPoint { time: string | null; lat: number | null; lng: number | null; address: string | null; }
/** Full 10s breadcrumb trail (can be large — ~one row per 10s). */
export async function getJourney(carId: number, range: ReportRange, maxPoints = 5000): Promise<JourneyPoint[]> {
  const html = await fetchReport(carId, '/ReportBGTVT/_ResultReportsDetailJourney', range, { referer: 'ReportBGTVT/ReportsDetailJourney' });
  const rows = dataRows(parseTable(html));
  // STT, Biển số, Thời điểm, Tọa độ (lat,lng), Địa điểm, Ghi chú
  const points = rows
    .filter((r) => r.length >= 3)
    .map((r) => {
      // Cells aren't at fixed indices (empty Biển số/Ghi chú cells are omitted),
      // so locate by pattern.
      const timeCell = r.find((c) => /\d{1,2}:\d{2}:\d{2}/.test(c)) ?? '';
      const coordCell = r.find((c) => /^\d+\.\d+\s*,\s*\d+\.\d+/.test(c.trim())) ?? '';
      const ll = coordCell.split(',');
      const coordIdx = r.indexOf(coordCell);
      const address = coordIdx >= 0 && coordIdx + 1 < r.length ? r[coordIdx + 1] : null;
      return {
        time: toIso(parsePortalDateTime(timeCell)),
        lat: toNum(ll[0]?.trim()),
        lng: toNum(ll[1]?.trim()),
        address,
      };
    })
    .filter((p) => p.lat !== null && p.lng !== null);
  return points.slice(0, maxPoints);
}

/** Full breadcrumb trail across a multi-day range (day-paginated, deduped,
 *  time-sorted). `getJourney` is single-day; this concatenates days so long
 *  trips aren't truncated by the per-call cap. */
export async function getJourneyRange(carId: number, fromDay: string, toDay: string, maxPoints = 50000): Promise<JourneyPoint[]> {
  const seen = new Set<string>();
  const all: JourneyPoint[] = [];
  for (let t = new Date(fromDay + 'T00:00:00Z').getTime(); t <= new Date(toDay + 'T00:00:00Z').getTime(); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    for (const p of await getJourney(carId, { dateFrom: day, dateTo: day }, maxPoints)) {
      const k = `${p.time}|${p.lat}|${p.lng}`;
      if (!seen.has(k)) { seen.add(k); all.push(p); }
    }
  }
  all.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  return all;
}

export interface OverSpeedEvent { time: string | null; avgSpeed: number | null; driver: string | null; license: string | null; }
/** Overspeed events (empty array if none in range). */
export async function getOverSpeed(carId: number, range: ReportRange): Promise<OverSpeedEvent[]> {
  const html = await fetchReport(carId, '/ReportBGTVT/_ResultReportsOverSpeed', range, { referer: 'ReportBGTVT/ReportsOverSpeed' });
  const rows = dataRows(parseTable(html));
  // #, Biển số, Biển số xe, Lái xe, GPLX, Loại hình, Thời điểm, Tốc độ TB...
  return rows
    .filter((r) => /\d/.test(r[0] ?? '') && r.length >= 7 && !/không có dữ liệu/i.test(r.join(' ')))
    .map((r) => ({
      time: toIso(parsePortalDateTime(r[6] ?? '')),
      avgSpeed: toNum(r[7]),
      driver: r[3] || null,
      license: r[4] || null,
    }));
}

export interface SummaryByCar { totalKm: number | null; overSpeedPct: { band5to10: number | null; band10to20: number | null; bandOver20: number | null; }; bounds: { minLat: number | null; minLng: number | null; maxLat: number | null; maxLng: number | null; }; }
/** Per-car summary: total km, overspeed distribution, geo bounds. */
export async function getSummaryByCar(carId: number, range: ReportRange): Promise<SummaryByCar> {
  const html = await fetchReport(carId, '/ReportBGTVT/_ResultReportsSummaryByCar', range, { referer: 'ReportBGTVT/ReportSummaryByCar' });
  const rows = parseTable(html);
  if (!headerOk(rows, /tổng km|loại hình/i)) {
    return { totalKm: null, overSpeedPct: { band5to10: null, band10to20: null, bandOver20: null }, bounds: { minLat: null, minLng: null, maxLat: null, maxLng: null } };
  }
  const r = rows.find((x) => /\d{2}[A-Z]-/i.test(x[0] ?? '')) ?? rows[0];
  // cols: Biển số, Loại hình, Tổng km, %5-10, %10-20, %>20, ... , bbox (last)
  const bboxRaw = r?.[r.length - 1] ?? '';
  const b = bboxRaw.split(',').map((x) => toNum(x.trim()));
  return {
    totalKm: toNum(r?.[2]),
    overSpeedPct: { band5to10: toNum(r?.[3]), band10to20: toNum(r?.[4]), bandOver20: toNum(r?.[5]) },
    bounds: { minLat: b[0] ?? null, maxLat: b[1] ?? null, minLng: b[2] ?? null, maxLng: b[3] ?? null },
  };
}

export interface OilRow { date: string | null; startTime: string | null; endTime: string | null; fuelStart: number | null; fuelEnd: number | null; litersDrained: number | null; litersFilled: number | null; consumed: number | null; co2Kg: number | null; totalKm: number | null; efficiencyL100: number | null; }
/** Fuel/oil report: fill/drain/consumption/efficiency per day + totals. */
export async function getOilManage(carId: number, range: ReportRange): Promise<{ rows: OilRow[]; totals: Partial<OilRow> }> {
  const html = await fetchReport(carId, '/ReportDN/_ResultReportsOilManage', range, { referer: 'ReportDN/OilManage' });
  const rows = parseTable(html);
  if (!headerOk(rows, /dầu (bắt đầu|kết thúc)|tổng tiêu thụ/i)) return { rows: [], totals: {} };
  // Ngày, Biển, Bắt đầu, Kết thúc, Dầu đầu, Dầu cuối, Rút, Đổ, Tiêu thụ, CO2, TổngKM, TG dừng, ..., L/100km
  const toOil = (r: string[]): OilRow => ({
    date: r[0] ?? null,
    startTime: toIso(parsePortalDateTime(r[2] ?? '')),
    endTime: toIso(parsePortalDateTime(r[3] ?? '')),
    fuelStart: toNum(r[4]), fuelEnd: toNum(r[5]),
    litersDrained: toNum(r[6]), litersFilled: toNum(r[7]),
    consumed: toNum(r[8]), co2Kg: toNum(r[9]), totalKm: toNum(r[10]),
    efficiencyL100: toNum((r.find((c) => /lít\s*\/\s*100/i.test(c)) ?? '').match(/[\d.]+/)?.[0] ?? null),
  });
  const data = dataRows(rows).filter((r) => /\d{2}\/\d{2}\/\d{4}/.test(r[0] ?? '')).map(toOil);
  const sum = (sel: (r: OilRow) => number | null): number | null =>
    data.reduce<number | null>((s, r) => { const v = sel(r); return v == null ? s : (s ?? 0) + v; }, null);
  return {
    rows: data,
    totals: {
      litersDrained: sum((r) => r.litersDrained),
      litersFilled: sum((r) => r.litersFilled),
      consumed: sum((r) => r.consumed),
      co2Kg: sum((r) => r.co2Kg),
      totalKm: sum((r) => r.totalKm),
    },
  };
}

export interface CarSpeedSample { time: string | null; speeds: number[]; }
/** Per-10s speed samples (can be large). */
export async function getCarSpeed(carId: number, range: ReportRange, maxSamples = 5000): Promise<CarSpeedSample[]> {
  const html = await fetchReport(carId, '/ReportBGTVT/_ResultReportsCarSpeed', range, { referer: 'ReportBGTVT/ReportsCarSpeed' });
  const rows = dataRows(parseTable(html));
  // #, Thời điểm, Các tốc độ (comma-separated), Ghi chú
  const out = rows
    .filter((r) => r.length >= 3)
    .map((r) => ({
      time: toIso(parsePortalDateTime(r[1] ?? '')),
      speeds: (r[2] ?? '').split(',').map((s) => toNum(s.trim())).filter((x): x is number => x !== null),
    }));
  return out.slice(0, maxSamples);
}

export interface ActivitySummary { startTime: string | null; endTime: string | null; km: number | null; stopSec: number | null; parkSec: number | null; driveSec: number | null; }
/** Daily activity: km + stop/park/drive time (params: dateF + dateE, no times). */
export async function getActivitySummary(carId: number, range: ReportRange): Promise<ActivitySummary | null> {
  const html = await fetchReport(carId, '/ReportDN/_ResultReportActivitySummary', range, { omitTimes: true, referer: 'ReportDN/ReportActivitySummary' });
  const rows = parseTable(html);
  // Biển số, Bắt đầu, Kết thúc, Số km, Thời gian dừng, Thời gian đỗ, Thời gian chạy
  const r = rows.find((x) => /\d{2}[A-Z]-/i.test(x[0] ?? ''));
  if (!r) return null;
  return {
    startTime: toIso(parsePortalDateTime(r[1] ?? '')),
    endTime: toIso(parsePortalDateTime(r[2] ?? '')),
    km: toNum(r[3]),
    stopSec: durationToSec(r[4]),
    parkSec: durationToSec(r[5]),
    driveSec: durationToSec(r[6]),
  };
}

export interface FuelEvent { startTime: string | null; endTime: string | null; event: string | null; liters: number | null; address: string | null; }
/** Fuel events (fill/drain) — useful for theft detection. Empty if none. */
export async function getFuelEvents(carId: number, range: ReportRange): Promise<{ events: FuelEvent[]; increaseCount: number | null; increaseLiters: number | null; decreaseCount: number | null; decreaseLiters: number | null; }> {
  const html = await fetchReport(carId, '/ReportDN/_ReportFuelEventsReturn', range, { referer: 'ReportDN/FuelEvents' });
  const rows = parseTable(html);
  if (!headerOk(rows, /sự kiện|số lần tăng/i)) {
    return { events: [], increaseCount: null, increaseLiters: null, decreaseCount: null, decreaseLiters: null };
  }
  const result = { events: [] as FuelEvent[], increaseCount: null as number | null, increaseLiters: null as number | null, decreaseCount: null as number | null, decreaseLiters: null as number | null };
  for (const r of rows) {
    const joined = r.join(' ');
    let m = joined.match(/Số lần tăng:\s*(\d+)/); if (m) result.increaseCount = +m[1];
    m = joined.match(/Tổng số lít tăng:\s*([\d.,]+)/); if (m) result.increaseLiters = toNum(m[1]);
    m = joined.match(/Số lần giảm:\s*(\d+)/); if (m) result.decreaseCount = +m[1];
    m = joined.match(/Tổng số lít giảm:\s*([\d.,]+)/); if (m) result.decreaseLiters = toNum(m[1]);
  }
  // STT, Biển số, Bắt đầu, Kết thúc, Sự kiện, Số lượng, Từ->đến, Địa điểm, Ghi chú
  result.events = dataRows(rows)
    .filter((r) => /\d/.test(r[0] ?? '') && r.length >= 8 && !/sự kiện/i.test(r[4] ?? ''))
    .map((r) => ({
      startTime: toIso(parsePortalDateTime(r[2] ?? '')),
      endTime: toIso(parsePortalDateTime(r[3] ?? '')),
      event: r[4] || null,
      liters: toNum(r[5]),
      address: r[7] || null,
    }));
  return result;
}

export interface OfficialStop { time: string | null; durationMin: number | null; lat: number | null; lng: number | null; address: string | null; }
/** Official BGTVT stop report (params: numberMinute, not timeS). */
export async function getStopCar(carId: number, range: ReportRange): Promise<OfficialStop[]> {
  const html = await fetchReport(carId, '/ReportBGTVT/_ResultReportsStopCar', range, { extra: { numberMinute: '0' }, referer: 'ReportBGTVT/StopCar' });
  const rows = dataRows(parseTable(html));
  // STT, Biển số, Lái xe, GPLX, Loại hình, Thời điểm, Thời gian dừng(min), Tọa độ, Địa điểm
  return rows
    .filter((r) => /\d/.test(r[0] ?? '') && r.length >= 9)
    .map((r) => {
      const ll = (r[7] ?? '').split(',');
      return {
        time: toIso(parsePortalDateTime(r[5] ?? '')),
        durationMin: toNum(r[6]),
        lat: toNum(ll[0]?.trim()),
        lng: toNum(ll[1]?.trim()),
        address: r[8] ?? null,
      };
    });
}

export const reportService = {
  resolveCarId,
  getStopDetail,
  getTripSegments,
  getJourney,
  getOverSpeed,
  getSummaryByCar,
  getOilManage,
  getCarSpeed,
  getActivitySummary,
  getFuelEvents,
  getStopCar,
};
