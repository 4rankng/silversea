/**
 * Master-data fixtures (SIL-161, spec 2026.10.24_Demo_layout.docx §PHÂN HỆ 4):
 * the Rate Engine price lists — phí nâng/hạ theo cảng/bãi (cảng × cỡ cont ×
 * xuất/nhập × nâng/hạ) and giá cước vận chuyển (khách hàng × tuyến × cỡ
 * cont) — plus the derived factory directory for the Đối tác tab.
 *
 * Consistency contract with the shell trip seed (SIL-155): every lift/drop
 * fee on `demoTrips` quotes its cell from `demoPortRateMatrix`, and every
 * in-house trip whose routeText appears verbatim in `demoFreightRates`
 * charges that row's rate for its size. `master-data.test.ts` pins both.
 * All money is whole VND (no decimals — house currency rule).
 */
import { demoCustomers, demoPorts, demoTrips } from './seed';
import type { DemoCargoFlow, DemoContainerSize, DemoPortFeeKind, DemoTrip } from './types';

/* ── Ma trận phí Nâng / Hạ ────────────────────────────────────────────── */

/** Ô phí: cỡ cont × loại hình (Xuất/Nhập) × thao tác (Nâng/Hạ). */
export type DemoRateOperation = Exclude<DemoPortFeeKind, 'surcharge'>;

export type DemoPortRateCellKey =
  `${DemoContainerSize}-${DemoCargoFlow}-${DemoRateOperation}`;

/** Build the canonical cell key (kept in one place so UI and tests agree). */
export function portRateCellKey(
  size: DemoContainerSize,
  flow: DemoCargoFlow,
  operation: DemoRateOperation,
): DemoPortRateCellKey {
  return `${size}-${flow}-${operation}`;
}

/** One editable matrix column: 20′/40′ × Xuất/Nhập × Nâng/Hạ. */
export interface DemoPortRateColumn {
  key: DemoPortRateCellKey;
  size: DemoContainerSize;
  flow: DemoCargoFlow;
  operation: DemoRateOperation;
  /** Group header, e.g. "20′ · Xuất". */
  groupLabel: string;
  /** Leaf header: "Nâng" | "Hạ". */
  operationLabel: string;
}

const FLOW_LABELS: Record<DemoCargoFlow, string> = { export: 'Xuất', import: 'Nhập' };
const OPERATION_LABELS: Record<DemoRateOperation, string> = { lift: 'Nâng', drop: 'Hạ' };

/** Fixed column order: 20′ first, Xuất before Nhập, Nâng before Hạ. */
export const DEMO_PORT_RATE_COLUMNS: readonly DemoPortRateColumn[] = (
  [20, 40] as const
).flatMap((size) =>
  (['export', 'import'] as const).flatMap((flow) =>
    (['lift', 'drop'] as const).map((operation) => ({
      key: portRateCellKey(size, flow, operation),
      size,
      flow,
      operation,
      groupLabel: `${size}′ · ${FLOW_LABELS[flow]}`,
      operationLabel: OPERATION_LABELS[operation],
    })),
  ),
);

/** Một hàng ma trận — phí nâng/hạ của một cảng/bãi theo 8 cột. */
export interface DemoPortRateRow {
  portId: string;
  /** VND nguyên theo cột. */
  rates: Record<DemoPortRateCellKey, number>;
}

const LIFT_20 = 1_250_000;
const LIFT_40 = 2_150_000;
const DROP_20_EXPORT = 1_150_000;
const DROP_40_EXPORT = 1_850_000;

/**
 * Giá nền khớp fixtures chuyến (shell seed dùng 4 hằng số này ở mọi cảng);
 * cột Hạ nhập chưa có chuyến nên tách nhẹ theo cảng cho thực tế.
 */
function portRates(drop20Import: number, drop40Import: number): Record<DemoPortRateCellKey, number> {
  return {
    '20-export-lift': LIFT_20,
    '20-export-drop': DROP_20_EXPORT,
    '20-import-lift': LIFT_20,
    '20-import-drop': drop20Import,
    '40-export-lift': LIFT_40,
    '40-export-drop': DROP_40_EXPORT,
    '40-import-lift': LIFT_40,
    '40-import-drop': drop40Import,
  };
}

export const demoPortRateMatrix: readonly DemoPortRateRow[] = demoPorts.map((port) => ({
  portId: port.id,
  rates: portRates(
    { CL: 1_150_000, CM: 1_180_000, VICT: 1_160_000, LB: 1_120_000 }[port.id] ?? 1_150_000,
    { CL: 1_850_000, CM: 1_880_000, VICT: 1_870_000, LB: 1_820_000 }[port.id] ?? 1_850_000,
  ),
}));

/* ── Ma trận giá cước vận chuyển ──────────────────────────────────────── */

/** Giá cước chuẩn đội nhà: khách hàng × tuyến × cỡ cont (VND nguyên). */
export interface DemoFreightRateRow {
  id: string;
  customerId: string;
  /** Nhãn tuyến trùng định dạng routeText của fixtures chuyến. */
  route: string;
  rate20Vnd: number;
  rate40Vnd: number;
}

export const demoFreightRates: readonly DemoFreightRateRow[] = [
  { id: 'FR-01', customerId: 'SAM', route: 'Cát Lái ➔ Samsung SEHC ➔ Cát Lái', rate20Vnd: 3_000_000, rate40Vnd: 4_800_000 },
  { id: 'FR-02', customerId: 'DUT', route: 'VICT ➔ Nhựa Duy Tan (VSIP II)', rate20Vnd: 2_900_000, rate40Vnd: 4_300_000 },
  { id: 'FR-03', customerId: 'DUT', route: 'ICD Long Bình ➔ Nhựa Duy Tan (VSIP II) ➔ ICD LB', rate20Vnd: 2_700_000, rate40Vnd: 3_900_000 },
  { id: 'FR-04', customerId: 'CTP', route: 'Cát Lái ➔ Châu Thành Plastic ➔ Cát Lái', rate20Vnd: 3_200_000, rate40Vnd: 4_700_000 },
  { id: 'FR-05', customerId: 'CTP', route: 'VICT ➔ Châu Thành Plastic (Bến Lức)', rate20Vnd: 3_300_000, rate40Vnd: 4_800_000 },
  { id: 'FR-06', customerId: 'CTP', route: 'Cái Mép ➔ Châu Thành Plastic (Bến Lức) ➔ Cái Mép', rate20Vnd: 3_600_000, rate40Vnd: 4_900_000 },
  { id: 'FR-07', customerId: 'VED', route: 'Cái Mép ➔ Vedan Long Thành', rate20Vnd: 2_950_000, rate40Vnd: 4_100_000 },
  { id: 'FR-08', customerId: 'INT', route: 'Cát Lái ➔ Intel SHTP', rate20Vnd: 2_600_000, rate40Vnd: 3_600_000 },
  { id: 'FR-09', customerId: 'MAV', route: 'Cát Lái ➔ Mavin Mỹ Phước ➔ Cát Lái', rate20Vnd: 3_400_000, rate40Vnd: 4_900_000 },
  { id: 'FR-10', customerId: 'MAV', route: 'Cái Mép ➔ Mavin Mỹ Phước', rate20Vnd: 3_600_000, rate40Vnd: 5_100_000 },
  { id: 'FR-11', customerId: 'HSG', route: 'ICD Long Bình ➔ Hoa Sen Nhơn Trạch ➔ ICD LB', rate20Vnd: 3_000_000, rate40Vnd: 4_200_000 },
  { id: 'FR-12', customerId: 'HSG', route: 'Cái Mép ➔ Hoa Sen Nhơn Trạch', rate20Vnd: 3_000_000, rate40Vnd: 4_300_000 },
  { id: 'FR-13', customerId: 'HSG', route: 'VICT ➔ Hoa Sen Nhơn Trạch ➔ VICT', rate20Vnd: 3_200_000, rate40Vnd: 4_600_000 },
  { id: 'FR-14', customerId: 'UNI', route: 'Cát Lái ➔ Unilever Củ Chi', rate20Vnd: 3_500_000, rate40Vnd: 5_000_000 },
];

/* ── Danh mục phái sinh cho tab Đối tác ───────────────────────────────── */

/** Một nhà máy / KCN trong danh mục Đối tác (ghép từ khách hàng). */
export interface DemoFactoryEntry {
  name: string;
  area: string;
  /** Mã khách hàng chủ hàng gắn với nhà máy. */
  customerCodes: readonly string[];
}

/** Nhà máy/KCN suy ra từ danh mục khách hàng — mỗi KH thuộc đúng 1 nhà máy. */
export function demoFactoryDirectory(): readonly DemoFactoryEntry[] {
  const byFactory = new Map<string, DemoFactoryEntry>();
  for (const customer of demoCustomers) {
    const entry = byFactory.get(customer.factory) ?? {
      name: customer.factory,
      area: customer.factoryArea,
      customerCodes: [],
    };
    entry.customerCodes = [...entry.customerCodes, customer.code];
    byFactory.set(customer.factory, entry);
  }
  return [...byFactory.values()];
}

/** Số chuyến xe ngoài đang có trong fixtures theo nhà xe phụ. */
export function demoVendorTripCounts(): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const trip of demoTrips) {
    if (trip.source === 'vendor' && trip.vendorId) {
      counts.set(trip.vendorId, (counts.get(trip.vendorId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Cross-check nội bộ: chuyến nhà khớp giá cước chuẩn theo tuyến + cỡ. */
export function freightRateForTrip(trip: DemoTrip): DemoFreightRateRow | undefined {
  return demoFreightRates.find(
    (row) => row.customerId === trip.customerId && row.route === trip.routeText,
  );
}
