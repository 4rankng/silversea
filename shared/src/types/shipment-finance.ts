export interface ShipmentInvoiceRecord {
  tripId?: number | null;
  id: number;
  shipmentId: number;
  shipmentCode: string | null;
  customerName: string | null;
  supplierId: number;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  faceAmount: string;
  supplierFeeAmount: string;
  sourceExpenseId: number | null;
  version: number;
  note: string | null;
}

export interface ContainerDepositRecord {
  id: number;
  shipmentId: number;
  shipmentCode: string | null;
  customerName: string | null;
  billNumber: string;
  shippingLineName: string;
  amount: string;
  depositDate: string;
  documentsSubmittedDate: string | null;
  refundReceivedDate: string | null;
  recoveredAmount: string;
  outstandingAmount: string;
  status: 'WAITING_DOCUMENTS' | 'WAITING_REFUND' | 'PARTIAL' | 'REFUNDED';
  version: number;
  note: string | null;
}

export interface ShipmentFinanceRecords {
  invoices: ShipmentInvoiceRecord[];
  deposits: ContainerDepositRecord[];
  canWrite: boolean;
  invoiceTotal: number;
  depositTotal: number;
  page: number;
  pageSize: number;
}
