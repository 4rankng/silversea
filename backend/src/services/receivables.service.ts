// backend/src/services/receivables.service.ts
// Thin re-export from unified aging.service — kept for backward compatibility.
// Consumers should migrate to importing directly from aging.service.
export { getReceivablesSummary, getTopOverdueCustomer, getCustomerAgingList } from './aging.service';
