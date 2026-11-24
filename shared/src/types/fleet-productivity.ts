export type FleetProductivityClassification = 'KEP' | 'KET_HOP' | 'LAY_LE' | 'DON';

export interface FleetProductivityBreakdown {
  totalTrips: number;
  kepTrips: number;
  ketHopTrips: number;
  layLeTrips: number;
  donTrips: number;
  pctKep: number;
  pctKetHop: number;
  pctLayLe: number;
  pctDon: number;
  highEfficiencyPct: number;
}

export interface DailyFleetTruckRow {
  truckId: number;
  licensePlate: string;
  driverName: string | null;
  breakdown: FleetProductivityBreakdown;
  /** Distinct Bill/Booking references of the day's runs — business keys only,
   * internal TRP-* codes never reach this list (KB §1.4.3 / V25). */
  tripReferences: string[];
}

export interface DailyFleetProductivityResponse {
  date: string;
  totalInternalTrucks: number;
  activeInternalTrucks: number;
  fleetBreakdown: FleetProductivityBreakdown;
  trucks: DailyFleetTruckRow[];
}

export interface MonthlyFleetTruckRow {
  truckId: number;
  licensePlate: string;
  driverName: string | null;
  breakdown: FleetProductivityBreakdown;
}

export interface MonthlyFleetProductivityResponse {
  year: number;
  month: number;
  totalInternalTrucks: number;
  activeInternalTrucks: number;
  fleetBreakdown: FleetProductivityBreakdown;
  trucks: MonthlyFleetTruckRow[];
}
