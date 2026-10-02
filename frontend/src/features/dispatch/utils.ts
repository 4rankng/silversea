export interface Driver {
  id: number;
  name: string;
  assignedTruckId?: number | null;
  status: string;
}

export interface Truck {
  id: number;
  licensePlate: string;
  status: string;
}

export interface ReassignState {
  carrierType: 'OWN' | 'EXTERNAL';
  truckId: string;
  driverId: string;
  externalCarrierId: string;
  externalPlateNumber: string;
  externalDriverName: string;
  externalDriverPhone: string;
  /** Mandatory per card 20260922_79 — persisted to the audit trail with actor+timestamp. */
  reason: string;
  loading: boolean;
  error: string;
}

export type FleetFilter = 'all' | 'running' | 'ready' | 'noassign' | 'maint';

export interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

export interface PairTripDraftState {
  plannedStartAt: string;
  plannedEndAt: string;
  canonicalOrigin: string;
  canonicalDestination: string;
  cargoWeightKg: string;
  vehicleCapacityKg: string;
  expectedVersion?: number;
}

export interface PairingState {
  secondTripId: string;
  /** Ghép chuyến kind: KEP = 2×20' đồng thời; KET_HOP = tái dùng vỏ, nối tiếp. */
  pairKind: 'KEP' | 'KET_HOP';
  firstTrip: PairTripDraftState;
  secondTrip: PairTripDraftState;
  loading: boolean;
  error: string;
}

const VN_WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const VN_MONTHS = ['tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'];

export { VN_WEEKDAYS, VN_MONTHS };



