/**
 * Demo fixture types (SIL-155, spec 2026.10.24_Demo_layout.docx).
 *
 * Shapes cover what the five demo lanes after the shell need to render:
 * the dispatch grid + fleet timeline, the UNC / hoàn ứng queues, AR/AP
 * billing sheets, master-data catalogs and the driver app trip cards.
 * All money is whole VND (no decimals — house currency rule).
 */

/** Kích cỡ container (feet). */
export type DemoContainerSize = 20 | 40;

/** Loại hình hàng: Hàng Xuất / Hàng Nhập. */
export type DemoCargoFlow = 'export' | 'import';

/** Nguồn xe: đội xe nhà / thuê ngoài. */
export type DemoVehicleSource = 'inhouse' | 'vendor';

/** Loại phí tại cảng: Phí Nâng / Phí Hạ / Phụ phí cảng - vé bãi. */
export type DemoPortFeeKind = 'lift' | 'drop' | 'surcharge';

/** Hình thức thanh toán phí cảng: công ty UNC / lái xe chi tiền mặt. */
export type DemoPortFeeMethod = 'unc' | 'driver-cash';

/** Cảng / bãi. */
export interface DemoPort {
  id: string;
  /** Mã ngắn hiển thị trên lưới (vd CL, CM). */
  code: string;
  name: string;
  area: string;
  /** Đơn vị nhận hóa đơn mặc định tại cảng (Invoice To). */
  invoiceTo: string;
}

/** Khách hàng / chủ hàng, kèm nhà máy giao nhận chính. */
export interface DemoCustomer {
  id: string;
  code: string;
  name: string;
  factory: string;
  factoryArea: string;
}

/** Tài xế đội xe nhà. */
export interface DemoDriver {
  id: string;
  fullName: string;
  phone: string;
  /** CCCD. */
  idNumber: string;
  /** Hạng giấy phép lái xe (đầu kéo rơ-moóc = E). */
  licenseClass: 'C' | 'E';
}

/** Đầu kéo đội xe nhà + cấu hình ghép cặp mặc định. */
export interface DemoTruck {
  id: string;
  plate: string;
  model: string;
  /** Rơ moóc mặc định. */
  trailerPlate: string;
  /** Tài xế mặc định (ghép cặp mặc định theo spec /master-data). */
  defaultDriverId: string;
}

/** Nhà xe phụ (vendor) — chỉ xuất hiện khi source = 'vendor'. */
export interface DemoVendor {
  id: string;
  name: string;
  phone: string;
}

/** Một khoản phí cảng gắn với chuyến. */
export interface DemoPortFee {
  id: string;
  kind: DemoPortFeeKind;
  portId: string;
  /** VND, nguyên. */
  amountVnd: number;
  method: DemoPortFeeMethod;
  /** Mã/Tên đơn vị nhận hóa đơn (thường = port.invoiceTo). */
  invoiceTo: string;
  /** UNC: đang chờ / đã chuyển khoản. */
  uncStatus?: 'pending' | 'paid';
  /** Lái xe chi tiền mặt: chờ duyệt / đã hoàn tiền. */
  reimbursed?: 'pending' | 'done';
}

/** Khối thời gian trên lịch trình đầu xe (chế độ Timeline, 00:00–24:00). */
export interface DemoTripTimelineBlock {
  /** 'HH:mm' — đêm muộn qua 24:00 chưa hỗ trợ trong demo seed. */
  start: string;
  end: string;
  label: string;
}

/** Thông số vỏ container do lái xe cập nhật tại bãi (missing → cảnh báo). */
export interface DemoContainerSpec {
  sealNo: string;
  maxGrossKg: number;
  tareKg: number;
}

/** Một chuyến container (Trip). */
export interface DemoTrip {
  id: string;
  /** Mã chuyến hiển thị (vd CH-2410-01). */
  code: string;
  /** Ngày làm việc 'YYYY-MM-DD'. */
  date: string;
  bookingNo: string;
  /** Số Bill (chủ chốt với hàng nhập; hàng xuất có thể chưa có). */
  billNo?: string;
  contNo: string;
  size: DemoContainerSize;
  flow: DemoCargoFlow;
  source: DemoVehicleSource;
  customerId: string;
  /** Xe nhà: đầu kéo + tài xế; xe ngoài: vendor. */
  truckId?: string;
  driverId?: string;
  vendorId?: string;
  /** Cảng nâng (lấy hàng) — mỗi chuyến có 1 cảng nâng. */
  liftPortId: string;
  /** Cảng hạ (trả vỏ); trống khi trả tại bãi nâng. */
  dropPortId?: string;
  /** Tuyến hiển thị: 'Cát Lái ➔ Samsung SEHC ➔ Cát Lái'. */
  routeText: string;
  /** Cước vận chuyển (VND, nguyên) — lấy từ bảng giá chuẩn theo tuyến. */
  freightVnd: number;
  /** Đủ khi lái xe đã cập nhật tại bãi; thiếu → cảnh báo vận hành. */
  containerSpec?: DemoContainerSpec;
  fees: DemoPortFee[];
  timeline: DemoTripTimelineBlock[];
  /** Ghi chú lưu ý hiện trường (khung cảnh báo đỏ trên thẻ lệnh lái xe). */
  note?: string;
}
