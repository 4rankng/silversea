// Portal catalog reads — customer-scope resolution and customer-facing debit
// note listing, extracted from routes/portal so route handlers hold only HTTP
// concerns (auth shape, validation, response mapping).
import { and, count, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

export interface CustomerScopeCustomer {
  id: number;
  name: string;
}

/**
 * Customers visible to a portal user: linked customers (join through
 * user_customer_links) plus the user's primary customer if not already
 * included. Soft-deleted customers are excluded.
 */
export async function listCustomerScopeCustomers(
  userId: number,
  primaryCustomerId: number | null,
): Promise<CustomerScopeCustomer[]> {
  const customers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
  }).from(s.userCustomerLinks)
    .innerJoin(s.customers, eq(s.userCustomerLinks.customerId, s.customers.id))
    .where(and(
      eq(s.userCustomerLinks.userId, userId),
      isNull(s.customers.deletedAt),
    ))
    .orderBy(s.userCustomerLinks.customerId);
  if (primaryCustomerId != null && !customers.some((customer) => customer.id === primaryCustomerId)) {
    const [primaryCustomer] = await db.select({
      id: s.customers.id,
      name: s.customers.name,
    }).from(s.customers)
      .where(and(eq(s.customers.id, primaryCustomerId), isNull(s.customers.deletedAt)))
      .limit(1);
    if (primaryCustomer) {
      customers.unshift(primaryCustomer);
    }
  }
  return customers;
}

/** Column set the portal debit-note list exposes (subset of billing_documents). */
async function listCustomerDebitNoteRows(customerId: number, page: number, limit: number) {
  const condition = and(
    eq(s.billingDocuments.entityType, 'CUSTOMER'),
    eq(s.billingDocuments.entityId, customerId),
    eq(s.billingDocuments.type, 'DEBIT_NOTE'),
    isNull(s.billingDocuments.deletedAt),
    isNotNull(s.billingDocuments.debitNoteStatus),
    ne(s.billingDocuments.debitNoteStatus, 'DRAFT'),
  );
  const [items, totalRows] = await Promise.all([
    db.select({
      id: s.billingDocuments.id,
      version: s.billingDocuments.version,
      entityId: s.billingDocuments.entityId,
      entityName: s.billingDocuments.entityName,
      rangeFrom: s.billingDocuments.rangeFrom,
      rangeTo: s.billingDocuments.rangeTo,
      totalInclVat: s.billingDocuments.totalInclVat,
      originalDueDate: s.billingDocuments.originalDueDate,
      processingDueDate: s.billingDocuments.processingDueDate,
      paymentTermDaysApplied: s.billingDocuments.paymentTermDaysApplied,
      paymentDatePolicyApplied: s.billingDocuments.paymentDatePolicyApplied,
      debitNoteStatus: s.billingDocuments.debitNoteStatus,
      customerConfirmedAt: s.billingDocuments.customerConfirmedAt,
      customerConfirmedBy: s.billingDocuments.customerConfirmedBy,
      legalInvoiceRef: s.billingDocuments.legalInvoiceRef,
      createdAt: s.billingDocuments.createdAt,
      updatedAt: s.billingDocuments.updatedAt,
    }).from(s.billingDocuments)
      .where(condition)
      .orderBy(desc(s.billingDocuments.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(s.billingDocuments).where(condition),
  ]);
  return { items, total: Number(totalRows[0]?.value ?? 0) };
}

/** Paginated, customer-visible debit notes (non-DRAFT) for the portal list. */
export async function listCustomerDebitNotes(customerId: number, page: number, limit: number) {
  return listCustomerDebitNoteRows(customerId, page, limit);
}
