// Statement barrel: customer/supplier/carrier statements, the shared ledger
// helpers, and the renderers live in leaf modules (statement-shared /
// statement-export-render / statement-customer / statement-supplier). This file
// is the compatibility barrel — named re-exports only, importers unchanged.
export type {
  EnrichedLedgerRow,
  FuelTripStatementRow,
  SupplierExpenseStatementRow,
  CustomerStatementData,
  SupplierStatementData,
} from './statement-shared.service';
export {
  withPayableProjectionBalances,
  withReceivableProjectionBalances,
  attachFuelDetailsToLedgerRows,
  attachSupplierExpenseDetailsToLedgerRows,
  safeFilename,
  attachmentDisposition,
  normalizeDateParam,
  statementPeriodBounds,
  computePeriodSummary,
} from './statement-shared.service';
export {
  getStatementData,
  exportStatementXlsx,
  exportStatementHtml,
  exportReceivablesAgingXlsx,
} from './statement-customer.service';
export {
  getSupplierStatement,
  getCarrierPayableStatement,
  exportSupplierStatementXlsx,
  exportSupplierStatementHtml,
} from './statement-supplier.service';
