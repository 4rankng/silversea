import { date, index, integer, numeric, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { applicationEnum } from './_shared';

/** Card 20260921_19 — the container deposit refund tracker. One row per lot
 *  the customer declared as carrying a container deposit ("có cược"); KT
 *  completes the money and dates, and the ĐÃ-hoàn-cược tick posts the
 *  collection into the COMPANY (ACB) fund through the standing treasury
 *  engine. BILL + names are the display keys — never a bare internal id. */
export const depositRefundTrackers = pgTable('deposit_refund_trackers', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id'),
  billNumber: varchar('bill_number', { length: 80 }).notNull(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  carrierName: varchar('carrier_name', { length: 255 }).notNull(),
  /** The amount KT recorded as deposited/owed. Fill-only from the customer's
   *  expected amount; KT may enter or correct by hand. */
  depositAmount: numeric('deposit_amount', { precision: 15, scale: 0 }).notNull(),
  /** KT-entered day the refund petition (công văn) was submitted. */
  cvSubmittedDate: date('cv_submitted_date'),
  /** Defaults to cvSubmittedDate + 14 days server-side; editable (some
   *  carriers run longer). */
  expectedRefundDate: date('expected_refund_date'),
  status: applicationEnum(['CHUA_HOAN_CUOC', 'DA_HOAN_CUOC'])('status').default('CHUA_HOAN_CUOC').notNull(),
  /** The one treasury movement the tick posted — guards double-ticks. */
  refundPostedMovementId: integer('refund_posted_movement_id'),
  refundPostedAt: timestamp('refund_posted_at', { withTimezone: true }),
  refundPostedBy: integer('refund_posted_by'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('deposit_refund_trackers_status_idx').on(table.status, table.expectedRefundDate),
  index('deposit_refund_trackers_shipment_idx').on(table.shipmentId),
]);
