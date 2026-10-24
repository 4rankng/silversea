/**
 * Demo fixture seed (SIL-155, spec 2026.10.24_Demo_layout.docx).
 *
 * Static, in-memory, deliberately fake — demo pages never call the API.
 * Names are realistic Southern-Vietnam drayage data: Cát Lái / Cái Mép /
 * VICT / ICD Long Bình ports, factories within daily reach of those ports.
 *
 * Working days: most trips on 2026-10-24 (demo "hôm nay"), 2 yesterday and
 * 2 tomorrow so the dispatch date bar (Hôm qua | Hôm nay | Ngày mai) has
 * data on every tab. Two 20′ trips share a booking + truck (chạy kẹp) per
 * spec /driver-app. Vendor trips carry UNC-paid-by-company fees so the AP
 * cấn trừ rule (/billing) has seed rows to reconcile.
 */
import type {
  DemoCustomer,
  DemoDriver,
  DemoPort,
  DemoPortFee,
  DemoTrip,
  DemoTruck,
  DemoVendor,
} from './types';

/* ── Danh mục ─────────────────────────────────────────────────────────── */

export const demoPorts: readonly DemoPort[] = [
  { id: 'CL', code: 'CL', name: 'Cảng Cát Lái', area: 'Thủ Đức, TP.HCM', invoiceTo: 'Tổng CTY CP Cát Lái' },
  { id: 'CM', code: 'CM', name: 'Cái Mép Thị Vải', area: 'BR - Vũng Tàu', invoiceTo: 'CMIT - SSA Marine' },
  { id: 'VICT', code: 'VICT', name: 'Cảng VICT', area: 'Quận 7, TP.HCM', invoiceTo: 'Công ty CP VICT' },
  { id: 'LB', code: 'LB', name: 'ICD Long Bình', area: 'Biên Hòa, Đồng Nai', invoiceTo: 'Long Bình Ports' },
];

export const demoCustomers: readonly DemoCustomer[] = [
  { id: 'SAM', code: 'SAM', name: 'Samsung Electronics HCM CE', factory: 'KCN Hiệp Phước', factoryArea: 'Nhà Bè, TP.HCM' },
  { id: 'INT', code: 'INT', name: 'Intel Việt Nam', factory: 'SHTP', factoryArea: 'Thủ Đức, TP.HCM' },
  { id: 'UNI', code: 'UNI', name: 'Unilever Việt Nam', factory: 'KCN Củ Chi', factoryArea: 'Củ Chi, TP.HCM' },
  { id: 'VED', code: 'VED', name: 'Vedan Việt Nam', factory: 'KCN Long Thành', factoryArea: 'Đồng Nai' },
  { id: 'HSG', code: 'HSG', name: 'Tập đoàn Hoa Sen', factory: 'Nhơn Trạch', factoryArea: 'Đồng Nai' },
  { id: 'MAV', code: 'MAV', name: 'Mavin Foods', factory: 'KCN Mỹ Phước 2', factoryArea: 'Bình Dương' },
  { id: 'CTP', code: 'CTP', name: 'Châu Thành Plastic', factory: 'KCN Bến Lức', factoryArea: 'Long An' },
  { id: 'DUT', code: 'DUT', name: 'Nhựa Duy Tan', factory: 'KCN VSIP II', factoryArea: 'Bình Dương' },
];

export const demoDrivers: readonly DemoDriver[] = [
  { id: 'DRV-01', fullName: 'Nguyễn Văn Tâm', phone: '0903 715 204', idNumber: '034201001234', licenseClass: 'E' },
  { id: 'DRV-02', fullName: 'Lê Minh Tuấn', phone: '0907 662 118', idNumber: '034202002567', licenseClass: 'E' },
  { id: 'DRV-03', fullName: 'Trần Văn Hậu', phone: '0913 405 883', idNumber: '034203003910', licenseClass: 'E' },
  { id: 'DRV-04', fullName: 'Phạm Quốc Dũng', phone: '0905 227 469', idNumber: '034204004258', licenseClass: 'E' },
  { id: 'DRV-05', fullName: 'Võ Thành Lộc', phone: '0938 511 702', idNumber: '034205005601', licenseClass: 'E' },
  { id: 'DRV-06', fullName: 'Đặng Văn Bảy', phone: '0977 346 055', idNumber: '034206006944', licenseClass: 'E' },
];

export const demoTrucks: readonly DemoTruck[] = [
  { id: 'TRK-01', plate: '51C-138.65', model: 'Shacman X3000', trailerPlate: '51R-072.44', defaultDriverId: 'DRV-01' },
  { id: 'TRK-02', plate: '51C-469.80', model: 'Hyundai HD370', trailerPlate: '51R-118.03', defaultDriverId: 'DRV-02' },
  { id: 'TRK-03', plate: '60C-229.15', model: 'Howo TX', trailerPlate: '60R-041.90', defaultDriverId: 'DRV-03' },
  { id: 'TRK-04', plate: '72L-846.30', model: 'Foton Auman', trailerPlate: '72R-097.51', defaultDriverId: 'DRV-04' },
  { id: 'TRK-05', plate: '73K-517.94', model: 'Hino 700', trailerPlate: '73R-063.27', defaultDriverId: 'DRV-05' },
  { id: 'TRK-06', plate: '50H-362.58', model: 'Dongfeng KX', trailerPlate: '50R-028.16', defaultDriverId: 'DRV-06' },
];

export const demoVendors: readonly DemoVendor[] = [
  { id: 'VND-01', name: 'Giao Nhận Nam Hải', phone: '0908 103 447' },
  { id: 'VND-02', name: 'HTD Vận Tải', phone: '0914 256 703' },
  { id: 'VND-03', name: 'Minh Quân Logistics', phone: '0902 558 912' },
];

/* ── Helpers nội bộ cho seed ──────────────────────────────────────────── */

const LIFT_20 = 1_250_000;
const LIFT_40 = 2_150_000;
const DROP_20 = 1_150_000;
const DROP_40 = 1_850_000;

const fee = (
  id: string,
  kind: DemoPortFee['kind'],
  portId: string,
  amountVnd: number,
  method: DemoPortFee['method'],
  extra?: Partial<Pick<DemoPortFee, 'uncStatus' | 'reimbursed'>>,
): DemoPortFee => ({
  id,
  kind,
  portId,
  amountVnd,
  method,
  invoiceTo: demoPorts.find((p) => p.id === portId)!.invoiceTo,
  ...extra,
});

/* ── Chuyến — 2026-10-24 (ngày demo chính) ────────────────────────────── */

const TODAY = '2026-10-24';

/** Ngày demo chính (SIL-155): các lane /driver-app v.v. lọc chuyến theo ngày này. */
export const DEMO_TODAY = TODAY;

export const demoTrips: readonly DemoTrip[] = [
  /* TRK-01 — Tâm: ca sáng Samsung, ca chiều Duy Tan */
  {
    id: 'T-2401', code: 'CH-2410-01', date: TODAY,
    bookingNo: 'MSKU7648291', billNo: undefined,
    contNo: 'MSKU 7648291', size: 40, flow: 'export', source: 'inhouse',
    customerId: 'SAM', truckId: 'TRK-01', driverId: 'DRV-01',
    liftPortId: 'CL', dropPortId: 'CL',
    routeText: 'Cát Lái ➔ Samsung SEHC ➔ Cát Lái',
    freightVnd: 4_800_000,
    containerSpec: { sealNo: 'SL-88124', maxGrossKg: 32500, tareKg: 3900 },
    fees: [
      fee('F-2401a', 'lift', 'CL', LIFT_40, 'unc', { uncStatus: 'paid' }),
      fee('F-2401b', 'drop', 'CL', DROP_40, 'unc', { uncStatus: 'pending' }),
      fee('F-2401c', 'surcharge', 'CL', 250_000, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '05:30', end: '07:00', label: 'Lấy lệnh & nâng vỏ @ Cát Lái' },
      { start: '07:00', end: '08:30', label: 'Cát Lái ➔ Samsung SEHC' },
      { start: '08:30', end: '09:30', label: 'Hạ hàng @ Samsung SEHC' },
      { start: '10:00', end: '11:30', label: 'SEHC ➔ Cát Lái trả vỏ' },
    ],
  },
  {
    id: 'T-2402', code: 'CH-2410-02', date: TODAY,
    bookingNo: 'ONEU4410782', billNo: 'ONEYVN441078',
    contNo: 'OOLU 9120345', size: 20, flow: 'import', source: 'inhouse',
    customerId: 'DUT', truckId: 'TRK-01', driverId: 'DRV-01',
    liftPortId: 'VICT',
    routeText: 'VICT ➔ Nhựa Duy Tan (VSIP II)',
    freightVnd: 2_900_000,
    containerSpec: { sealNo: 'VN-04517', maxGrossKg: 30480, tareKg: 2230 },
    fees: [
      fee('F-2402a', 'lift', 'VICT', LIFT_20, 'driver-cash', { reimbursed: 'pending' }),
      fee('F-2402b', 'surcharge', 'VICT', 180_000, 'driver-cash', { reimbursed: 'pending' }),
    ],
    timeline: [
      { start: '13:00', end: '14:00', label: 'Lấy lệnh & nâng vỏ @ VICT' },
      { start: '14:00', end: '15:00', label: 'VICT ➔ VSIP II' },
      { start: '15:00', end: '16:00', label: 'Hạ hàng @ Duy Tan' },
    ],
    note: 'Chờ CCP đỗ cổng số 3, cân vỏ trước khi vào kho.',
  },

  /* TRK-02 — Tuấn: chạy kẹp 2 vỏ 20′ sáng, Vedan chiều */
  {
    id: 'T-2403', code: 'CH-2410-03', date: TODAY,
    bookingNo: 'SITVBM9911455',
    contNo: 'TCLU 5583027', size: 20, flow: 'export', source: 'inhouse',
    customerId: 'CTP', truckId: 'TRK-02', driverId: 'DRV-02',
    liftPortId: 'CL', dropPortId: 'CL',
    routeText: 'Cát Lái ➔ Châu Thành Plastic ➔ Cát Lái (kẹp đôi)',
    freightVnd: 3_200_000,
    containerSpec: { sealNo: 'SL-77210', maxGrossKg: 30480, tareKg: 2200 },
    fees: [
      fee('F-2403a', 'lift', 'CL', LIFT_20, 'unc', { uncStatus: 'paid' }),
      fee('F-2403b', 'drop', 'CL', DROP_20, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '04:30', end: '05:45', label: 'Nâng kẹp 2 vỏ @ Cát Lái' },
      { start: '05:45', end: '07:15', label: 'Cát Lái ➔ Bến Lức' },
      { start: '07:15', end: '09:00', label: 'Hạ 2 vỏ @ Châu Thành' },
      { start: '09:30', end: '11:00', label: 'Bến Lức ➔ Cát Lái trả vỏ' },
    ],
    note: 'CHẠY KẸP 2 vỏ 20′ — cùng booking SITVBM9911455.',
  },
  {
    id: 'T-2404', code: 'CH-2410-04', date: TODAY,
    bookingNo: 'SITVBM9911455',
    contNo: 'GLDU 3395018', size: 20, flow: 'export', source: 'inhouse',
    customerId: 'CTP', truckId: 'TRK-02', driverId: 'DRV-02',
    liftPortId: 'CL', dropPortId: 'CL',
    routeText: 'Cát Lái ➔ Châu Thành Plastic ➔ Cát Lái (kẹp đôi)',
    freightVnd: 3_200_000,
    fees: [
      fee('F-2404a', 'lift', 'CL', LIFT_20, 'unc', { uncStatus: 'paid' }),
      fee('F-2404b', 'drop', 'CL', DROP_20, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '04:30', end: '05:45', label: 'Nâng kẹp 2 vỏ @ Cát Lái' },
      { start: '05:45', end: '07:15', label: 'Cát Lái ➔ Bến Lức' },
      { start: '07:15', end: '09:00', label: 'Hạ 2 vỏ @ Châu Thành' },
      { start: '09:30', end: '11:30', label: 'Bến Lức ➔ Cát Lái trả vỏ' },
    ],
    note: 'CHẠY KẸP 2 vỏ 20′ — vỏ 2 của booking SITVBM9911455.',
  },
  {
    id: 'T-2405', code: 'CH-2410-05', date: TODAY,
    bookingNo: 'EGLV5062219', billNo: 'EGLV5062219',
    contNo: 'EGLV 4450162', size: 40, flow: 'import', source: 'inhouse',
    customerId: 'VED', truckId: 'TRK-02', driverId: 'DRV-02',
    liftPortId: 'CM',
    routeText: 'Cái Mép ➔ Vedan Long Thành',
    freightVnd: 4_100_000,
    containerSpec: { sealNo: 'CM-31288', maxGrossKg: 30480, tareKg: 3880 },
    fees: [
      fee('F-2405a', 'lift', 'CM', LIFT_40, 'unc', { uncStatus: 'paid' }),
      fee('F-2405b', 'surcharge', 'CM', 320_000, 'unc', { uncStatus: 'paid' }),
    ],
    timeline: [
      { start: '13:30', end: '14:45', label: 'Lấy lệnh & nâng vỏ @ Cái Mép' },
      { start: '14:45', end: '16:00', label: 'CM ➔ Vedan Long Thành' },
      { start: '16:00', end: '17:00', label: 'Hạ hàng @ Vedan' },
    ],
  },

  /* TRK-03 — Hậu: Intel sáng, Mavin chiều (Mavin thiếu thông số vỏ) */
  {
    id: 'T-2406', code: 'CH-2410-06', date: TODAY,
    bookingNo: 'HLCUVN7712043', billNo: 'HLCU7712043',
    contNo: 'HLXU 2294187', size: 40, flow: 'import', source: 'inhouse',
    customerId: 'INT', truckId: 'TRK-03', driverId: 'DRV-03',
    liftPortId: 'CL',
    routeText: 'Cát Lái ➔ Intel SHTP',
    freightVnd: 3_600_000,
    containerSpec: { sealNo: 'CL-90455', maxGrossKg: 32500, tareKg: 4050 },
    fees: [
      fee('F-2406a', 'lift', 'CL', LIFT_40, 'driver-cash', { reimbursed: 'done' }),
    ],
    timeline: [
      { start: '06:00', end: '07:15', label: 'Lấy lệnh & nâng vỏ @ Cát Lái' },
      { start: '07:15', end: '08:15', label: 'Cát Lái ➔ SHTP' },
      { start: '08:15', end: '09:30', label: 'Hạ hàng @ Intel' },
    ],
  },
  {
    id: 'T-2407', code: 'CH-2410-07', date: TODAY,
    bookingNo: 'CMAU1182749',
    contNo: 'CMAU 1182749', size: 20, flow: 'export', source: 'inhouse',
    customerId: 'MAV', truckId: 'TRK-03', driverId: 'DRV-03',
    liftPortId: 'CL', dropPortId: 'CL',
    routeText: 'Cát Lái ➔ Mavin Mỹ Phước ➔ Cát Lái',
    freightVnd: 3_400_000,
    fees: [
      fee('F-2407a', 'lift', 'CL', LIFT_20, 'unc', { uncStatus: 'pending' }),
      fee('F-2407b', 'drop', 'CL', DROP_20, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '12:30', end: '13:30', label: 'Nâng vỏ @ Cát Lái' },
      { start: '13:30', end: '14:30', label: 'Cát Lái ➔ Mỹ Phước' },
      { start: '14:30', end: '15:30', label: 'Hạ hàng @ Mavin' },
      { start: '16:00', end: '17:00', label: 'Mỹ Phước ➔ Cát Lái trả vỏ' },
    ],
    note: 'Chưa có số chì — chờ nhà máy đóng hàng update.',
  },

  /* TRK-04 — Dũng: Châu Thành sáng, Hoa Sen chiều */
  {
    id: 'T-2408', code: 'CH-2410-08', date: TODAY,
    bookingNo: 'MEDUQ6620184', billNo: 'MEDU6620184',
    contNo: 'BEAU 7720361', size: 20, flow: 'import', source: 'inhouse',
    customerId: 'CTP', truckId: 'TRK-04', driverId: 'DRV-04',
    liftPortId: 'VICT',
    routeText: 'VICT ➔ Châu Thành Plastic (Bến Lức)',
    freightVnd: 3_300_000,
    containerSpec: { sealNo: 'VT-12077', maxGrossKg: 30480, tareKg: 2210 },
    fees: [
      fee('F-2408a', 'lift', 'VICT', LIFT_20, 'unc', { uncStatus: 'pending' }),
      fee('F-2408b', 'surcharge', 'VICT', 200_000, 'driver-cash', { reimbursed: 'pending' }),
    ],
    timeline: [
      { start: '05:00', end: '06:00', label: 'Lấy lệnh & nâng vỏ @ VICT' },
      { start: '06:00', end: '07:30', label: 'VICT ➔ Bến Lức' },
      { start: '07:30', end: '09:00', label: 'Hạ hàng @ Châu Thành' },
    ],
  },
  {
    id: 'T-2409', code: 'CH-2410-09', date: TODAY,
    bookingNo: 'YMLU0348812',
    contNo: 'YMLU 8831240', size: 40, flow: 'export', source: 'inhouse',
    customerId: 'HSG', truckId: 'TRK-04', driverId: 'DRV-04',
    liftPortId: 'LB', dropPortId: 'LB',
    routeText: 'ICD Long Bình ➔ Hoa Sen Nhơn Trạch ➔ ICD LB',
    freightVnd: 4_200_000,
    containerSpec: { sealNo: 'LB-66199', maxGrossKg: 32500, tareKg: 3950 },
    fees: [
      fee('F-2409a', 'lift', 'LB', LIFT_40, 'unc', { uncStatus: 'paid' }),
      fee('F-2409b', 'drop', 'LB', DROP_40, 'unc', { uncStatus: 'paid' }),
    ],
    timeline: [
      { start: '13:00', end: '14:00', label: 'Nâng vỏ @ ICD Long Bình' },
      { start: '14:00', end: '15:30', label: 'LB ➔ Nhơn Trạch' },
      { start: '15:30', end: '16:30', label: 'Hạ hàng @ Hoa Sen' },
      { start: '17:00', end: '18:30', label: 'Nhơn Trạch ➔ ICD LB trả vỏ' },
    ],
  },

  /* TRK-05 — Lộc: Vedan sáng, Hoa Sen chiều */
  {
    id: 'T-2410', code: 'CH-2410-10', date: TODAY,
    bookingNo: 'GSLU2209177', billNo: 'GSLU2209177',
    contNo: 'SEGU 6073841', size: 40, flow: 'import', source: 'inhouse',
    customerId: 'VED', truckId: 'TRK-05', driverId: 'DRV-05',
    liftPortId: 'CM',
    routeText: 'Cái Mép ➔ Vedan Long Thành',
    freightVnd: 4_100_000,
    containerSpec: { sealNo: 'CM-55830', maxGrossKg: 32500, tareKg: 3900 },
    fees: [
      fee('F-2410a', 'lift', 'CM', LIFT_40, 'unc', { uncStatus: 'pending' }),
      fee('F-2410b', 'surcharge', 'CM', 350_000, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '06:00', end: '07:30', label: 'Lấy lệnh & nâng vỏ @ Cái Mép' },
      { start: '07:30', end: '09:00', label: 'CM ➔ Vedan Long Thành' },
      { start: '09:00', end: '10:30', label: 'Hạ hàng @ Vedan' },
    ],
    note: 'Xe tải nặng — đi tuyến tránh cầu Đồng Nai.',
  },
  {
    id: 'T-2411', code: 'CH-2410-11', date: TODAY,
    bookingNo: 'MSKU4405917', billNo: 'MAEU440591',
    contNo: 'MSKU 1185266', size: 20, flow: 'import', source: 'inhouse',
    customerId: 'HSG', truckId: 'TRK-05', driverId: 'DRV-05',
    liftPortId: 'CM',
    routeText: 'Cái Mép ➔ Hoa Sen Nhơn Trạch',
    freightVnd: 3_000_000,
    containerSpec: { sealNo: 'CM-77012', maxGrossKg: 30480, tareKg: 2240 },
    fees: [
      fee('F-2411a', 'lift', 'CM', LIFT_20, 'driver-cash', { reimbursed: 'pending' }),
    ],
    timeline: [
      { start: '13:30', end: '14:45', label: 'Lấy lệnh & nâng vỏ @ Cái Mép' },
      { start: '14:45', end: '16:00', label: 'CM ➔ Nhơn Trạch' },
      { start: '16:00', end: '17:00', label: 'Hạ hàng @ Hoa Sen' },
    ],
  },

  /* TRK-06 — Bảy: Duy Tan sáng (ICD LB), Unilever trưa */
  {
    id: 'T-2412', code: 'CH-2410-12', date: TODAY,
    bookingNo: 'TGHU9340528',
    contNo: 'TGHU 9340528', size: 40, flow: 'export', source: 'inhouse',
    customerId: 'DUT', truckId: 'TRK-06', driverId: 'DRV-06',
    liftPortId: 'LB', dropPortId: 'LB',
    routeText: 'ICD Long Bình ➔ Nhựa Duy Tan (VSIP II) ➔ ICD LB',
    freightVnd: 3_900_000,
    containerSpec: { sealNo: 'LB-33041', maxGrossKg: 32500, tareKg: 3900 },
    fees: [
      fee('F-2412a', 'lift', 'LB', LIFT_40, 'unc', { uncStatus: 'pending' }),
      fee('F-2412b', 'drop', 'LB', DROP_40, 'driver-cash', { reimbursed: 'done' }),
    ],
    timeline: [
      { start: '05:00', end: '06:00', label: 'Nâng vỏ @ ICD Long Bình' },
      { start: '06:00', end: '07:00', label: 'LB ➔ VSIP II' },
      { start: '07:00', end: '08:00', label: 'Hạ hàng @ Duy Tan' },
      { start: '08:30', end: '09:30', label: 'VSIP II ➔ ICD LB trả vỏ' },
    ],
  },
  {
    id: 'T-2413', code: 'CH-2410-13', date: TODAY,
    bookingNo: 'SITVBM5510836', billNo: 'SITV5510836',
    contNo: 'SEGU 4581207', size: 20, flow: 'import', source: 'inhouse',
    customerId: 'UNI', truckId: 'TRK-06', driverId: 'DRV-06',
    liftPortId: 'CL',
    routeText: 'Cát Lái ➔ Unilever Củ Chi',
    freightVnd: 3_500_000,
    containerSpec: { sealNo: 'CL-12987', maxGrossKg: 30480, tareKg: 2200 },
    fees: [
      fee('F-2413a', 'lift', 'CL', LIFT_20, 'unc', { uncStatus: 'paid' }),
      fee('F-2413b', 'surcharge', 'CL', 150_000, 'driver-cash', { reimbursed: 'pending' }),
    ],
    timeline: [
      { start: '11:00', end: '12:00', label: 'Lấy lệnh & nâng vỏ @ Cát Lái' },
      { start: '12:00', end: '13:30', label: 'Cát Lái ➔ Củ Chi' },
      { start: '13:30', end: '14:30', label: 'Hạ hàng @ Unilever' },
    ],
  },

  /* Xe ngoài — Nam Hải ×2, HTD ×1 (công ty UNC hộ cho Nam Hải ➔ cấn trừ AP) */
  {
    id: 'T-2414', code: 'CH-2410-14', date: TODAY,
    bookingNo: 'OOLU6103307',
    contNo: 'OOLU 6103307', size: 40, flow: 'export', source: 'vendor',
    customerId: 'SAM', vendorId: 'VND-01',
    liftPortId: 'CL', dropPortId: 'CL',
    routeText: 'Cát Lái ➔ Samsung SEHC ➔ Cát Lái (xe ngoài)',
    freightVnd: 4_500_000,
    containerSpec: { sealNo: 'SL-99110', maxGrossKg: 32500, tareKg: 4000 },
    fees: [
      fee('F-2414a', 'lift', 'CL', LIFT_40, 'unc', { uncStatus: 'pending' }),
      fee('F-2414b', 'drop', 'CL', DROP_40, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '06:30', end: '07:45', label: 'Nâng vỏ @ Cát Lái (xe ngoài)' },
      { start: '07:45', end: '09:15', label: 'Cát Lái ➔ SEHC' },
      { start: '09:15', end: '10:15', label: 'Hạ hàng @ Samsung' },
      { start: '10:45', end: '12:15', label: 'SEHC ➔ Cát Lái trả vỏ' },
    ],
    note: 'Xe ngoài Nam Hải — công ty UNC hộ phí cảng, cấn trừ cuối kỳ.',
  },
  {
    id: 'T-2415', code: 'CH-2410-15', date: TODAY,
    bookingNo: 'MAEU7120654', billNo: 'MAEU7120654',
    contNo: 'MRKU 2058763', size: 20, flow: 'import', source: 'vendor',
    customerId: 'MAV', vendorId: 'VND-01',
    liftPortId: 'CM',
    routeText: 'Cái Mép ➔ Mavin Mỹ Phước (xe ngoài)',
    freightVnd: 3_600_000,
    containerSpec: { sealNo: 'CM-44190', maxGrossKg: 30480, tareKg: 2250 },
    fees: [
      fee('F-2415a', 'lift', 'CM', LIFT_20, 'unc', { uncStatus: 'paid' }),
    ],
    timeline: [
      { start: '08:00', end: '09:15', label: 'Lấy lệnh & nâng vỏ @ Cái Mép' },
      { start: '09:15', end: '10:45', label: 'CM ➔ Mỹ Phước' },
      { start: '10:45', end: '11:45', label: 'Hạ hàng @ Mavin' },
    ],
  },
  {
    id: 'T-2416', code: 'CH-2410-16', date: TODAY,
    bookingNo: 'GSLU8840236',
    contNo: 'GSLU 8840236', size: 40, flow: 'export', source: 'vendor',
    customerId: 'CTP', vendorId: 'VND-02',
    liftPortId: 'CM', dropPortId: 'CM',
    routeText: 'Cái Mép ➔ Châu Thành Bến Lức ➔ Cái Mép (xe ngoài)',
    freightVnd: 4_900_000,
    fees: [
      fee('F-2416a', 'lift', 'CM', LIFT_40, 'driver-cash', { reimbursed: 'pending' }),
      fee('F-2416b', 'drop', 'CM', DROP_40, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '09:00', end: '10:15', label: 'Nâng vỏ @ Cái Mép' },
      { start: '10:15', end: '11:45', label: 'CM ➔ Bến Lức' },
      { start: '11:45', end: '13:15', label: 'Hạ hàng @ Châu Thành' },
      { start: '14:00', end: '15:30', label: 'Bến Lức ➔ CM trả vỏ' },
    ],
    note: 'Chưa cập nhật đủ thông số vỏ (số chì / trọng lượng).',
  },

  /* ── Hôm qua 2026-10-23 — đã tất toán ────────────────────────────────── */
  {
    id: 'T-2301', code: 'CH-2310-01', date: '2026-10-23',
    bookingNo: 'MSKU3091775',
    contNo: 'MSKU 3091775', size: 40, flow: 'export', source: 'inhouse',
    customerId: 'SAM', truckId: 'TRK-01', driverId: 'DRV-01',
    liftPortId: 'CL', dropPortId: 'CL',
    routeText: 'Cát Lái ➔ Samsung SEHC ➔ Cát Lái',
    freightVnd: 4_800_000,
    containerSpec: { sealNo: 'SL-80011', maxGrossKg: 32500, tareKg: 3900 },
    fees: [
      fee('F-2301a', 'lift', 'CL', LIFT_40, 'unc', { uncStatus: 'paid' }),
      fee('F-2301b', 'drop', 'CL', DROP_40, 'unc', { uncStatus: 'paid' }),
    ],
    timeline: [
      { start: '05:30', end: '07:00', label: 'Lấy lệnh & nâng vỏ @ Cát Lái' },
      { start: '07:00', end: '08:30', label: 'Cát Lái ➔ Samsung SEHC' },
      { start: '08:30', end: '09:30', label: 'Hạ hàng @ Samsung SEHC' },
    ],
  },
  {
    id: 'T-2302', code: 'CH-2310-02', date: '2026-10-23',
    bookingNo: 'ONEU2208147', billNo: 'ONEY220814',
    contNo: 'OOLU 2208147', size: 20, flow: 'import', source: 'inhouse',
    customerId: 'UNI', truckId: 'TRK-05', driverId: 'DRV-05',
    liftPortId: 'VICT',
    routeText: 'VICT ➔ Unilever Củ Chi',
    freightVnd: 3_500_000,
    containerSpec: { sealNo: 'VT-20114', maxGrossKg: 30480, tareKg: 2210 },
    fees: [
      fee('F-2302a', 'lift', 'VICT', LIFT_20, 'driver-cash', { reimbursed: 'done' }),
    ],
    timeline: [
      { start: '06:00', end: '07:00', label: 'Lấy lệnh & nâng vỏ @ VICT' },
      { start: '07:00', end: '08:30', label: 'VICT ➔ Củ Chi' },
      { start: '08:30', end: '09:30', label: 'Hạ hàng @ Unilever' },
    ],
  },

  /* ── Ngày mai 2026-10-25 — kế hoạch ──────────────────────────────────── */
  {
    id: 'T-2501', code: 'CH-2510-01', date: '2026-10-25',
    bookingNo: 'HLCUVN3092754', billNo: 'HLCU3092754',
    contNo: 'HLXU 3092754', size: 40, flow: 'import', source: 'inhouse',
    customerId: 'INT', truckId: 'TRK-02', driverId: 'DRV-02',
    liftPortId: 'CL',
    routeText: 'Cát Lái ➔ Intel SHTP',
    freightVnd: 3_600_000,
    fees: [
      fee('F-2501a', 'lift', 'CL', LIFT_40, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '07:00', end: '08:15', label: 'Lấy lệnh & nâng vỏ @ Cát Lái' },
      { start: '08:15', end: '09:15', label: 'Cát Lái ➔ SHTP' },
      { start: '09:15', end: '10:30', label: 'Hạ hàng @ Intel' },
    ],
  },
  {
    id: 'T-2502', code: 'CH-2510-02', date: '2026-10-25',
    bookingNo: 'YMLU6657702',
    contNo: 'YMLU 6657702', size: 20, flow: 'export', source: 'inhouse',
    customerId: 'HSG', truckId: 'TRK-06', driverId: 'DRV-06',
    liftPortId: 'VICT', dropPortId: 'VICT',
    routeText: 'VICT ➔ Hoa Sen Nhơn Trạch ➔ VICT',
    freightVnd: 3_200_000,
    fees: [
      fee('F-2502a', 'lift', 'VICT', LIFT_20, 'unc', { uncStatus: 'pending' }),
      fee('F-2502b', 'drop', 'VICT', DROP_20, 'unc', { uncStatus: 'pending' }),
    ],
    timeline: [
      { start: '05:00', end: '06:00', label: 'Nâng vỏ @ VICT' },
      { start: '06:00', end: '07:30', label: 'VICT ➔ Nhơn Trạch' },
      { start: '07:30', end: '08:30', label: 'Hạ hàng @ Hoa Sen' },
      { start: '09:00', end: '10:30', label: 'Nhơn Trạch ➔ VICT trả vỏ' },
    ],
    note: 'Chưa cập nhật đủ thông số vỏ (số chì / trọng lượng).',
  },
];

/* ── Selectors nhỏ dùng chung các lane sau ────────────────────────────── */

/** Chuyến theo ngày làm việc. */
export function demoTripsOnDate(date: string): DemoTrip[] {
  return demoTrips.filter((t) => t.date === date);
}

/** Hàng đợi UNC: mọi phí method 'unc' (chưa lọc trạng thái). */
export function demoUncFees(): Array<{ trip: DemoTrip; fee: DemoPortFee }> {
  return demoTrips.flatMap((trip) =>
    trip.fees.filter((f) => f.method === 'unc').map((fee) => ({ trip, fee })),
  );
}

/** Sổ chi hộ: mọi phí lái xe tự chi tiền mặt. */
export function demoDriverCashFees(): Array<{ trip: DemoTrip; fee: DemoPortFee }> {
  return demoTrips.flatMap((trip) =>
    trip.fees.filter((f) => f.method === 'driver-cash').map((fee) => ({ trip, fee })),
  );
}
