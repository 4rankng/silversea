/**
 * Demo fixtures barrel (SIL-155). Everything the demo lanes render comes
 * from this module — typed, static, fake. No API, no persistence.
 */
export type {
  DemoCargoFlow,
  DemoContainerSize,
  DemoContainerSpec,
  DemoCustomer,
  DemoDriver,
  DemoPort,
  DemoPortFee,
  DemoPortFeeKind,
  DemoPortFeeMethod,
  DemoTrip,
  DemoTripTimelineBlock,
  DemoTruck,
  DemoVehicleSource,
  DemoVendor,
} from './types';
export {
  demoCustomers,
  demoDriverCashFees,
  demoDrivers,
  demoPorts,
  demoTrucks,
  demoTrips,
  demoTripsOnDate,
  demoUncFees,
  demoVendors,
} from './seed';
export type {
  DemoFactoryEntry,
  DemoFreightRateRow,
  DemoPortRateCellKey,
  DemoPortRateColumn,
  DemoPortRateRow,
  DemoRateOperation,
} from './master-data';
export {
  DEMO_PORT_RATE_COLUMNS,
  demoFactoryDirectory,
  demoFreightRates,
  demoPortRateMatrix,
  demoVendorTripCounts,
  freightRateForTrip,
  portRateCellKey,
} from './master-data';
