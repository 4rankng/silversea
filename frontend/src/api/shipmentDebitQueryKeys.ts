/** Chi phí - Quyết toán query domain, composed by the central query-key
 *  factory. Lives outside keys.ts because keys.ts sits under a frozen LOC
 *  ratchet; extracted domains spread into qk (expenseQueryKeys precedent). */
export const shipmentDebitQueryKeys = {
  shipmentDebit: {
    /** Broad prefix — invalidates every quyết-toàn query. */
    all: ['shipment-debit'] as const,
    /** The customer/directory bootstrap blob for the page header pickers. */
    bootstrap: ['shipment-debit-bootstrap'] as const,
    /** Broad prefix for just the lot-list summary family. */
    summaryAll: ['shipment-debit-summary'] as const,
    /** One summary per filter combination — the URL params are the identity. */
    summary: (customerId: string, deliveryFrom: string, deliveryTo: string, lockStatus: string) =>
      ['shipment-debit-summary', customerId, deliveryFrom, deliveryTo, lockStatus] as const,
  },
};
