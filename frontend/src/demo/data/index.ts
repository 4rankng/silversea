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
  DEMO_TODAY,
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
