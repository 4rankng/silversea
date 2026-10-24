/**
 * Unit tests for the demo dispatch pure model (SIL-156/157/158).
 * See testplan/2026-10-24-sil156-158-demo-dispatch.md — every number is
 * computed from the seed fixture, not hand-copied, so an accidental seed
 * edit fails loudly here instead of silently changing the demo.
 */
import { describe, expect, it } from 'vitest';
import {
  blockGeometry,
  copyVehicleText,
  dateTabs,
  dayLabel,
  deriveTripStatus,
  dispatchKpis,
  dropFee,
  EMPTY_FILTERS,
  exportSpecMissing,
  feeSignal,
  filterTrips,
  isPairedTrip,
  liftFee,
  minutesFromHHmm,
  nowLinePx,
  packLaneRows,
  tripWindow,
  truckLanes,
  type DispatchFilters,
} from './dispatch-model';
import { demoTrips, demoTripsOnDate, demoTrucks } from '../data/seed';

const TODAY = '2026-10-24';
const at = (hhmm: string) => new Date(`2026-10-24T${hhmm}:00`);

describe('gantt geometry (consult 24/10: 96px/h, min 48px)', () => {
  it('parses HH:mm to minutes', () => {
    expect(minutesFromHHmm('00:00')).toBe(0);
    expect(minutesFromHHmm('05:30')).toBe(330);
    expect(minutesFromHHmm('23:59')).toBe(1439);
  });

  it('trip window spans first timeline start to last end', () => {
    const t = demoTripsOnDate(TODAY).find((x) => x.id === 'T-2401')!;
    expect(tripWindow(t)).toEqual({ startMin: 330, endMin: 690 });
  });

  it('positions blocks at 96px/hour', () => {
    expect(blockGeometry({ startMin: 330, endMin: 690 })).toEqual({ leftPx: 528, widthPx: 576 });
  });

  it('enforces the 30-minute floor of 48px', () => {
    expect(blockGeometry({ startMin: 600, endMin: 630 })).toEqual({ leftPx: 960, widthPx: 48 });
  });

  it('guards a trip with an empty timeline', () => {
    const empty = { ...t('T-2401'), timeline: [] };
    expect(tripWindow(empty)).toEqual({ startMin: 0, endMin: 0 });
  });
});

describe('packLaneRows (khối chồng lấn chạy kẹp)', () => {
  const laneTrips = [t('T-2403'), t('T-2404'), t('T-2405')]; // TRK-02 hôm nay

  it('splits the overlapping kẹp pair into two sub-rows', () => {
    const packed = packLaneRows(laneTrips);
    expect(packed).toHaveLength(3);
    expect(packed.every((b) => b.rows === 2)).toBe(true);
    const rows = new Set(packed.filter((b) => b.trip.size === 20).map((b) => b.row));
    expect(rows).toEqual(new Set([0, 1]));
  });

  it('keeps non-overlapping trips on a single row', () => {
    const solo = packLaneRows([t('T-2401'), t('T-2402')]); // TRK-01: sáng / chiều
    expect(solo.every((b) => b.rows === 1 && b.row === 0)).toBe(true);
  });
});

describe('deriveTripStatus', () => {
  it('yesterday trips are always Hoàn thành', () => {
    const t = demoTripsOnDate('2026-10-23')[0];
    expect(deriveTripStatus(t, at('01:00'), TODAY)).toBe('done');
  });

  it('tomorrow trips with a truck are Đã phân xe', () => {
    const t = demoTripsOnDate('2026-10-25')[0];
    expect(deriveTripStatus(t, at('23:00'), TODAY)).toBe('assigned');
  });

  it('today: before the window → assigned, inside → running, after → done', () => {
    const t = demoTripsOnDate(TODAY).find((x) => x.id === 'T-2401')!; // 05:30–11:30
    expect(deriveTripStatus(t, at('05:00'), TODAY)).toBe('assigned');
    expect(deriveTripStatus(t, at('06:00'), TODAY)).toBe('running');
    expect(deriveTripStatus(t, at('11:31'), TODAY)).toBe('done');
  });

  it('unassigned trips read Mới tạo at every hour, even after their window', () => {
    const bare = { ...t('T-2401'), truckId: undefined, vendorId: undefined };
    expect(deriveTripStatus(bare, at('05:00'), TODAY)).toBe('new');
    expect(deriveTripStatus(bare, at('06:00'), TODAY)).toBe('new');
    expect(deriveTripStatus(bare, at('23:00'), TODAY)).toBe('new');
  });
});

const todayTrips = demoTripsOnDate(TODAY);
const t = (id: string) => demoTrips.find((x) => x.id === id)!;

describe('fee signals (ô 6)', () => {
  it('UNC paid / pending / driver-cash map to the three badges', () => {
    expect(feeSignal(liftFee(t('T-2401')))).toBe('unc-paid');
    expect(feeSignal(liftFee(t('T-2407')))).toBe('unc-pending');
    expect(feeSignal(liftFee(t('T-2402')))).toBe('driver-cash');
    expect(dropFee(t('T-2401')) && feeSignal(dropFee(t('T-2401')))).toBe('unc-pending');
  });
});

describe('export spec warnings (KPI 4 + ô 4)', () => {
  it('flags export trips missing containerSpec — exactly the seeded pair-plus-vendor', () => {
    const flagged = todayTrips.filter(exportSpecMissing).map((x) => x.id);
    expect(flagged).toEqual(['T-2404', 'T-2407', 'T-2416']);
  });

  it('import trips without spec are not warnings', () => {
    expect(exportSpecMissing(t('T-2402'))).toBe(false); // import + has spec
    expect(exportSpecMissing({ ...t('T-2402'), containerSpec: undefined })).toBe(false);
  });
});

describe('isPairedTrip (chạy kẹp)', () => {
  it('pairs the two 20′ trips sharing booking SITVBM9911455 on TRK-02', () => {
    expect(isPairedTrip(todayTrips, t('T-2403'))).toBe(true);
    expect(isPairedTrip(todayTrips, t('T-2404'))).toBe(true);
  });

  it('a lone 20′ trip is not paired', () => {
    expect(isPairedTrip(todayTrips, t('T-2402'))).toBe(false);
  });
});

describe('dispatchKpis', () => {
  const kpis = dispatchKpis(todayTrips);

  it('counts total trips and the 20′/40′ split from the seed', () => {
    expect(kpis.total).toBe(16);
    expect(kpis.size20 + kpis.size40).toBe(16);
    expect(kpis.size20).toBe(todayTrips.filter((x) => x.size === 20).length);
  });

  it('splits in-house vs vendor and counts active trucks', () => {
    expect(kpis.inhouseTrips).toBe(13);
    expect(kpis.vendorTrips).toBe(3);
    expect(kpis.activeTrucks).toBe(6);
    expect(kpis.totalTrucks).toBe(demoTrucks.length);
  });

  it('spec warnings match the flagged trips', () => {
    expect(kpis.specWarnings).toBe(3);
  });
});

describe('filterTrips', () => {
  const withFilters = (patch: Partial<DispatchFilters>) =>
    filterTrips(todayTrips, { ...EMPTY_FILTERS, ...patch });

  it('returns every trip with empty filters', () => {
    expect(withFilters({})).toHaveLength(16);
  });

  it('filters by customer (SAM has 2 trips today)', () => {
    expect(withFilters({ customerId: 'SAM' }).map((x) => x.id)).toEqual(['T-2401', 'T-2414']);
  });

  it('filters by flow and source', () => {
    expect(withFilters({ flow: 'export' })).toHaveLength(
      todayTrips.filter((x) => x.flow === 'export').length,
    );
    expect(withFilters({ source: 'vendor' })).toHaveLength(3);
  });

  it('searches cont / booking / bill / plate / driver / vendor / code', () => {
    expect(withFilters({ query: 'MSKU 7648291' }).map((x) => x.id)).toEqual(['T-2401']);
    expect(withFilters({ query: 'SITVBM9911455' })).toHaveLength(2);
    expect(withFilters({ query: '51C-138.65' }).map((x) => x.id)).toEqual(['T-2401', 'T-2402']);
    expect(withFilters({ query: 'nam hải' }).map((x) => x.id)).toEqual(['T-2414', 'T-2415']);
    expect(withFilters({ query: 'oneyvn441078' }).map((x) => x.id)).toEqual(['T-2402']);
  });
});

describe('copyVehicleText', () => {
  it('builds the standard clipboard string for an in-house trip', () => {
    const trip = t('T-2401');
    const text = copyVehicleText({
      truck: demoTrucks.find((x) => x.id === trip.truckId),
      driver: undefined,
      vendor: undefined,
    });
    expect(text).toBe('51C-138.65 / 51R-072.44');
  });

  it('includes driver name, phone and CCCD when present', () => {
    const trip = t('T-2401');
    const text = copyVehicleText({
      truck: demoTrucks.find((x) => x.id === trip.truckId),
      driver: { id: 'DRV-01', fullName: 'Nguyễn Văn Tâm', phone: '0903 715 204', idNumber: '034201001234', licenseClass: 'E' },
      vendor: undefined,
    });
    expect(text).toBe('51C-138.65 / 51R-072.44 / Nguyễn Văn Tâm / 0903 715 204 / 034201001234');
  });

  it('falls back to vendor name + phone for subcontracted trips', () => {
    const text = copyVehicleText({
      truck: undefined,
      driver: undefined,
      vendor: { id: 'VND-01', name: 'Giao Nhận Nam Hải', phone: '0908 103 447' },
    });
    expect(text).toBe('Giao Nhận Nam Hải / 0908 103 447');
  });
});

describe('truckLanes (gantt trục dọc)', () => {
  const lanes = truckLanes(todayTrips);

  it('lists every in-house truck with its default driver', () => {
    expect(lanes).toHaveLength(6);
    expect(lanes[0].driver?.fullName).toBe('Nguyễn Văn Tâm');
  });

  it('buckets trips onto their truck lane', () => {
    const trk02 = lanes.find((l) => l.truck.id === 'TRK-02')!;
    expect(trk02.trips.map((x) => x.id)).toEqual(['T-2403', 'T-2404', 'T-2405']);
  });
});

describe('date bar', () => {
  it('builds Hôm qua | Hôm nay | Ngày mai around the demo today', () => {
    expect(dateTabs(TODAY)).toEqual([
      { key: 'yesterday', date: '2026-10-23', label: 'Hôm qua' },
      { key: 'today', date: TODAY, label: 'Hôm nay' },
      { key: 'tomorrow', date: '2026-10-25', label: 'Ngày mai' },
    ]);
  });

  it('labels the demo day in Vietnamese (2026-10-24 is a Saturday)', () => {
    expect(dayLabel(TODAY)).toBe('Thứ Bảy, 24/10');
  });
});

describe('now line', () => {
  it('positions at 96px per hour', () => {
    expect(nowLinePx(at('12:00'))).toBe(1152);
    expect(nowLinePx(at('00:00'))).toBe(0);
  });
});
