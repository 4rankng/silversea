import { date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const shipmentInvoiceRecords = pgTable('shipment_invoice_records', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  supplierId: integer('supplier_id').notNull(),
  invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
  invoiceDate: date('invoice_date').notNull(),
  faceAmount: numeric('face_amount', { precision: 15, scale: 0 }).notNull(),
  supplierFeeAmount: numeric('supplier_fee_amount', { precision: 15, scale: 0 }).notNull(),
  sourceExpenseId: integer('source_expense_id'),
  version: integer('version').notNull().default(1),
  note: text('note'),
  createdBy: integer('created_by').notNull(),
  updatedBy: integer('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('shipment_invoice_records_identity_uniq').on(table.shipmentId, table.supplierId, table.invoiceNumber),
  uniqueIndex('shipment_invoice_records_source_expense_uniq').on(table.sourceExpenseId),
  index('shipment_invoice_records_date_idx').on(table.invoiceDate, table.shipmentId),
]);

// Documentary tracking only. Recording a refund date does not create a cash
// receipt, customer recovery or transport revenue.
export const containerDepositRecords = pgTable('container_deposit_records', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  billNumber: varchar('bill_number', { length: 100 }).notNull(),
  shippingLineName: varchar('shipping_line_name', { length: 255 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  depositDate: date('deposit_date').notNull(),
  documentsSubmittedDate: date('documents_submitted_date'),
  refundReceivedDate: date('refund_received_date'),
  recoveredAmount: numeric('recovered_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  version: integer('version').notNull().default(1),
  note: text('note'),
  createdBy: integer('created_by').notNull(),
  updatedBy: integer('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('container_deposit_records_shipment_idx').on(table.shipmentId),
  index('container_deposit_records_date_idx').on(table.depositDate),
]);
