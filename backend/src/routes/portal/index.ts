import { Router } from 'express';
import type { Request, Response } from 'express';
import { ShipmentStatus } from '@tingting/shared';
import { and, count, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '../../db';
import * as s from '../../db/schema';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { canAccessCustomer, scopedByCustomer } from '../../lib/scoped-by-customer';
import {
  buildLegacyXlsx,
  getDocument,
  renderTemplatedXlsx,
  resolveDebitNoteTemplateForDoc,
} from '../../services/billingDocument.service';
import { transitionDebitNoteStatus } from '../../services/debit-note-lifecycle.service';
import {
  attachmentDisposition,
  exportStatementXlsx,
  getStatementData,
  normalizeDateParam,
} from '../../services/statement.service';
import { getShipmentDetail, listShipmentsPaginated } from '../../services/shipment.service';
import { exportCustomerStatementPdf, exportDebitNotePdf } from '../../services/pdf-export.service';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../../errors';

const router = Router();

function toCustomerDebitNote(doc: Awaited<ReturnType<typeof getDocument>>) {
  return {
    id: doc.id,
    entityId: doc.entityId,
    entityName: doc.entityName,
    rangeFrom: doc.rangeFrom,
    rangeTo: doc.rangeTo,
    note: doc.note,
    totalInclVat: doc.totalInclVat,
    originalDueDate: doc.originalDueDate,
    processingDueDate: doc.processingDueDate,
    paymentTermDaysApplied: doc.paymentTermDaysApplied,
    paymentDatePolicyApplied: doc.paymentDatePolicyApplied,
    debitNoteStatus: doc.debitNoteStatus,
    customerConfirmedAt: doc.customerConfirmedAt,
    customerConfirmedBy: doc.customerConfirmedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lines: doc.lines.filter((line) => !line.excluded).map((line) => ({
      id: line.id,
      typeLabel: line.typeLabel,
      unit: line.unit,
      description: line.description,
      routeName: line.routeName,
      containerNumbers: line.containerNumbers,
      amount: line.amountOverride ?? line.baseAmount,
      sortOrder: line.sortOrder,
    })),
  };
}

function toCustomerShipmentDetail(detail: Awaited<ReturnType<typeof getShipmentDetail>>) {
  const { shipment } = detail;
  return {
    shipment: {
      id: shipment.id,
      shipmentCode: shipment.shipmentCode,
      status: shipment.status,
      bookingRef: shipment.bookingRef,
      blNumber: shipment.blNumber,
      expectedDeliveryDate: shipment.expectedDeliveryDate,
      pickupLocation: shipment.pickupLocation,
      deliveryLocation: shipment.deliveryLocation,
    },
    containers: detail.containers.map((container) => ({
      id: container.id,
      containerNumber: container.containerNumber,
      sealNumber: container.sealNumber,
      cargoWeightKg: container.cargoWeightKg,
    })),
    documents: detail.documents.map((document) => ({
      id: document.id,
      type: document.type,
      expiresAt: document.expiresAt,
      createdAt: document.createdAt,
    })),
    declarations: detail.declarations.map((declaration) => ({
      id: declaration.id,
      declarationNumber: declaration.declarationNumber,
      issuedAt: declaration.issuedAt,
      scope: declaration.scope,
      createdAt: declaration.createdAt,
    })),
    statusHistory: detail.statusHistory.map((history) => ({
      id: history.id,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      changedAt: history.changedAt,
    })),
  };
}

function parsePositiveId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${label} không hợp lệ`);
  }
  return id;
}

function resolveSelectedCustomerId(req: Request): number {
  const user = getUser(req);
  const requested = typeof req.query.customerId === 'string'
    ? parsePositiveId(req.query.customerId, 'Khách hàng')
    : undefined;
  if (requested !== undefined) {
    if (!canAccessCustomer(user, requested)) {
      throw new ApiError(404, 'Không tìm thấy khách hàng');
    }
    return requested;
  }
  const scoped = scopedByCustomer(user, { customerId: undefined });
  return scoped.customerId ?? -1;
}

router.get('/customer-scope', asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  if (user.role !== 'CUSTOMER') {
    return res.json({ primaryCustomerId: null, customers: [] });
  }
  const customers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
  }).from(s.userCustomerLinks)
    .innerJoin(s.customers, eq(s.userCustomerLinks.customerId, s.customers.id))
    .where(and(
      eq(s.userCustomerLinks.userId, user.userId),
      isNull(s.customers.deletedAt),
    ))
    .orderBy(s.userCustomerLinks.customerId);
  if (user.customerId != null && !customers.some((customer) => customer.id === user.customerId)) {
    const [primaryCustomer] = await db.select({
      id: s.customers.id,
      name: s.customers.name,
    }).from(s.customers)
      .where(and(eq(s.customers.id, user.customerId), isNull(s.customers.deletedAt)))
      .limit(1);
    if (primaryCustomer) {
      customers.unshift(primaryCustomer);
    }
  }
  res.json({
    primaryCustomerId: user.customerId ?? customers[0]?.id ?? null,
    customers,
  });
}));

async function getOwnDebitNote(req: Request) {
  const doc = await getDocument(parsePositiveId(String(req.params.id), 'ID giấy báo nợ'));
  const selectedCustomerId = resolveSelectedCustomerId(req);
  if (
    doc.type !== 'DEBIT_NOTE'
    || doc.entityType !== 'CUSTOMER'
    || doc.entityId !== selectedCustomerId
  ) {
    throw new ApiError(404, 'Không tìm thấy giấy báo nợ');
  }
  return doc;
}

router.get('/shipments', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const statusVal = req.query.status as string | undefined;

  let status: ShipmentStatus | undefined;
  if (statusVal !== undefined) {
    if (!Object.values(ShipmentStatus).includes(statusVal as ShipmentStatus)) {
      return res.status(400).json({ error: 'Trạng thái lô hàng không hợp lệ' });
    }
    status = statusVal as ShipmentStatus;
  }

  const customerId = resolveSelectedCustomerId(req);
  const result = await listShipmentsPaginated({
    page,
    limit,
    customerId,
    status,
  });

  res.json({
    ...result,
    items: result.items.map((shipment) => ({
      id: shipment.id,
      shipmentCode: shipment.shipmentCode,
      status: shipment.status,
      bookingRef: shipment.bookingRef,
      blNumber: shipment.blNumber,
      expectedDeliveryDate: shipment.expectedDeliveryDate,
    })),
  });
}));

router.get('/shipments/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parsePositiveId(String(req.params.id), 'ID lô hàng');

  const detail = await getShipmentDetail(id);
  if (detail.shipment.customerId !== resolveSelectedCustomerId(req)) {
    return res.status(404).json({ error: 'Không tìm thấy lô hàng' });
  }

  res.json(toCustomerShipmentDetail(detail));
}));

router.get('/debit-notes', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const customerId = resolveSelectedCustomerId(req);
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
      createdAt: s.billingDocuments.createdAt,
      updatedAt: s.billingDocuments.updatedAt,
    }).from(s.billingDocuments)
      .where(condition)
      .orderBy(desc(s.billingDocuments.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(s.billingDocuments).where(condition),
  ]);
  res.json({ items, total: Number(totalRows[0]?.value ?? 0), page, limit });
}));

router.get('/debit-notes/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json(toCustomerDebitNote(await getOwnDebitNote(req)));
}));

router.post('/debit-notes/:id/confirm', asyncHandler(async (req: Request, res: Response) => {
  const doc = await getOwnDebitNote(req);
  if (doc.debitNoteStatus !== 'PENDING_CONFIRM') {
    throw new ApiError(409, 'Chỉ giấy báo nợ đang chờ xác nhận mới có thể xác nhận.');
  }
  const user = getUser(req);
  await transitionDebitNoteStatus({
    documentId: doc.id,
    targetStatus: 'CONFIRMED',
    actorUserId: user.userId,
    confirmedBy: user.fullName ?? user.username ?? user.email ?? `Khách hàng #${doc.entityId}`,
  });
  res.json(toCustomerDebitNote(await getDocument(doc.id)));
}));

router.post('/debit-notes/:id/dispute', asyncHandler(async (req: Request, res: Response) => {
  const doc = await getOwnDebitNote(req);
  if (doc.debitNoteStatus !== 'PENDING_CONFIRM') {
    throw new ApiError(409, 'Chỉ giấy báo nợ đang chờ xác nhận mới có thể phản hồi.');
  }
  await transitionDebitNoteStatus({
    documentId: doc.id,
    targetStatus: 'REJECTED',
    actorUserId: getUser(req).userId,
  });
  res.json(toCustomerDebitNote(await getDocument(doc.id)));
}));

router.get('/debit-notes/:id/export', asyncHandler(async (req: Request, res: Response) => {
  const doc = await getOwnDebitNote(req);
  const format = String(req.query.format ?? 'xlsx').toLowerCase();

  if (format === 'pdf') {
    const buffer = await exportDebitNotePdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentDisposition(`giay-bao-no-${doc.entityName ?? doc.entityId}.pdf`));
    return res.send(buffer);
  }

  if (format !== 'xlsx') {
    throw new ApiError(400, 'Định dạng xuất không hợp lệ');
  }
  const snapshot = await resolveDebitNoteTemplateForDoc(doc);
  const buffer = snapshot
    ? await renderTemplatedXlsx(doc, snapshot)
    : await buildLegacyXlsx(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`giay-bao-no-${doc.entityName ?? doc.entityId}.xlsx`));
  res.send(buffer);
}));

router.get('/statement', asyncHandler(async (req: Request, res: Response) => {
  const customerId = resolveSelectedCustomerId(req);
  const data = await getStatementData(
    customerId,
    normalizeDateParam(req.query.dateFrom as string | undefined),
    normalizeDateParam(req.query.dateTo as string | undefined),
  );
  if (!data) {
    throw new ApiError(409, 'Tài khoản khách hàng chưa được liên kết');
  }
  res.json(data);
}));

router.get('/statement/export', asyncHandler(async (req: Request, res: Response) => {
  const customerId = resolveSelectedCustomerId(req);
  const data = await getStatementData(
    customerId,
    normalizeDateParam(req.query.dateFrom as string | undefined),
    normalizeDateParam(req.query.dateTo as string | undefined),
  );
  if (!data) {
    throw new ApiError(409, 'Tài khoản khách hàng chưa được liên kết');
  }

  const format = String(req.query.format ?? 'xlsx').toLowerCase();
  const dateStr = new Date().toLocaleDateString('vi-VN');
  if (format === 'pdf') {
    const buffer = await exportCustomerStatementPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentDisposition(`sao-ke-${data.customer.name}.pdf`));
    return res.send(buffer);
  }
  if (format !== 'xlsx') throw new ApiError(400, 'Định dạng xuất không hợp lệ');

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`sao-ke-${data.customer.name}.xlsx`));
  await exportStatementXlsx(data, dateStr, res);
}));

export default router;
