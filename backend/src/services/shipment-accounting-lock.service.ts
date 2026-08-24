// Shipment accounting-lock barrel: shared helpers in
// shipment-accounting-lock-shared, the finance snapshot in
// shipment-finance-snapshot, reads/guards in shipment-accounting-lock-reads,
// confirmation + proposal review in shipment-accounting-confirm, and custody +
// reopen governance in shipment-accounting-custody. This file is the
// compatibility barrel — named re-exports only, importers unchanged.
export type { ShipmentFinanceConfirmationSummary } from './shipment-accounting-lock-shared.service';
export { SHIPMENT_ACCOUNTING_LOCKED_MESSAGE } from './shipment-accounting-lock-shared.service';
export {
  getShipmentAccountingLock,
  getShipmentAccountingLockSummary,
  getLatestShipmentDocumentCustody,
  getShipmentFinanceConfirmationSummary,
  getShipmentFinanceConfirmationSummaries,
  assertShipmentAccountingUnlocked,
  assertTripShipmentAccountingUnlocked,
} from './shipment-accounting-lock-reads.service';
export {
  confirmShipmentFinance,
  reviewShipmentChargeProposal,
} from './shipment-accounting-confirm.service';
export {
  updateShipmentDocumentCustody,
  activateShipmentAccountingLock,
  requestShipmentReopen,
  decideShipmentReopen,
} from './shipment-accounting-custody.service';
