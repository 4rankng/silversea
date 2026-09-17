/** Financial workspace query domains, composed by the central query-key factory. */
export const expenseQueryKeys = {
  expenseAccounting: {
    all: ['expense-accounting'] as const,
    work: (filters: object) => ['expense-accounting', 'work', filters] as const,
    entries: (filters: object) => ['expense-accounting', 'entries', filters] as const,
    catalog: ['expense-accounting', 'catalog'] as const,
    vouchers: ['expense-accounting', 'vouchers'] as const,
    reconciliations: ['expense-accounting', 'reconciliations'] as const,
    report: (filters: object) => ['expense-accounting', 'report', filters] as const,
    assignments: ['expense-accounting', 'assignments'] as const,
  },
  shipmentFinance: {
    all: ['shipment-finance-records'] as const,
    list: (filters: object) => ['shipment-finance-records', filters] as const,
    options: (shipmentId: string) => ['shipment-finance-options', shipmentId] as const,
    lots: (search: string) => ['shipment-finance-lot-options', search] as const,
  },
  treasury: { all: ['treasury'] as const },
  recoverableCosts: { all: ['recoverable-costs'] as const },
};
