// backend/src/services/payables.service.ts
// Thin re-export from unified aging.service — kept for backward compatibility.
// Consumers should migrate to importing directly from aging.service.
export { getPayablesSummary } from './aging.service';
