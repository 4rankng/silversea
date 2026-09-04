/**
 * Order-exchange start/complete and paper-order collection commands.
 * Handler bodies + the updateOrderExchange command moved verbatim from
 * routes/forwarder.ts; tx logic stays in the leaf per the annotated
 * db-client baseline entry.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as s from '../../db/schema';
import { eq, sql } from 'drizzle-orm';

import { ApiError } from '../../errors';
import { throwValidation } from '../../lib/validation';
import {
  assertForwarderMutableTripScope, assertForwarderMutableShipmentScope,
} from '../../services/forwarder.service';
import {
  assertShipmentAccountingUnlocked, assertTripShipmentAccountingUnlocked,
} from '../../services/shipment-accounting-lock.service';
import {
  withMaterialWriteAuditContext, requireForwarderIdempotencyKey,
  paperOrderCollectionSchema, orderExchangeSchema, FORWARDER_IDEMPOTENCY_ENDPOINTS,
} from './forwarder-shared';
import { runIdempotent } from '../../services/idempotency.service';

const router = Router();

async function updateOrderExchange(
  req: Request,
  res: Response,
  action: 'start' | 'complete',
) {
  const forwarder = req.forwarder!;
  const shipmentId = parseInt(req.params.shipmentId as string, 10);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new ApiError(400, 'ID lô hàng không hợp lệ.');
  }
  const parsed = orderExchangeSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwValidation(parsed.error);
  const endpoint = action === 'start'
    ? FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_START
    : FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_COMPLETE;
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await withMaterialWriteAuditContext(req, res, endpoint, () => runIdempotent({
    endpoint,
    idempotencyKey,
    payload: { shipmentId, forwarderId: forwarder.id, expectedVersion: parsed.data.expectedVersion },
    createdBy: forwarder.id,
    entityType: 'shipment',
    responseStatusCode: 200,
    create: async (tx) => {
      await assertForwarderMutableShipmentScope(shipmentId, forwarder.id, tx);
      await assertShipmentAccountingUnlocked(tx, shipmentId);
      const [shipment] = await tx.select({
        id: s.shipments.id,
        version: s.shipments.version,
        orderExchangeStartedAt: s.shipments.orderExchangeStartedAt,
        orderExchangeStartedBy: s.shipments.orderExchangeStartedBy,
        orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
        orderExchangeCompletedBy: s.shipments.orderExchangeCompletedBy,
      }).from(s.shipments)
        .where(eq(s.shipments.id, shipmentId))
        .limit(1)
        .for('update');
      if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
      const alreadyDone = action === 'start'
        ? shipment.orderExchangeStartedAt != null
        : shipment.orderExchangeCompletedAt != null;
      if (alreadyDone) return shipment;
      if (shipment.version !== parsed.data.expectedVersion) {
        throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
      }
      if (action === 'complete' && !shipment.orderExchangeStartedAt) {
        throw new ApiError(409, 'Cần bắt đầu đổi lệnh trước khi xác nhận hoàn tất.');
      }
      const now = new Date();
      const [updated] = await tx.update(s.shipments)
        .set(action === 'start' ? {
          orderExchangeStartedAt: now,
          orderExchangeStartedBy: forwarder.id,
          version: sql`${s.shipments.version} + 1`,
          updatedAt: now,
          updatedBy: forwarder.id,
        } : {
          orderExchangeCompletedAt: now,
          orderExchangeCompletedBy: forwarder.id,
          version: sql`${s.shipments.version} + 1`,
          updatedAt: now,
          updatedBy: forwarder.id,
        })
        .where(eq(s.shipments.id, shipmentId))
        .returning({
          id: s.shipments.id,
          version: s.shipments.version,
          orderExchangeStartedAt: s.shipments.orderExchangeStartedAt,
          orderExchangeStartedBy: s.shipments.orderExchangeStartedBy,
          orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
          orderExchangeCompletedBy: s.shipments.orderExchangeCompletedBy,
        });
      return updated;
    },
  }));
  res.json(outcome.result);
}

router.post('/shipments/:shipmentId/order-exchange/start', asyncHandler(
  async (req: Request, res: Response) => updateOrderExchange(req, res, 'start'),
));

router.post('/shipments/:shipmentId/order-exchange/complete', asyncHandler(
  async (req: Request, res: Response) => updateOrderExchange(req, res, 'complete'),
));

router.post('/trips/:tripId/paper-order-collection', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    throw new ApiError(400, 'ID chuyến đi không hợp lệ.');
  }
  const parsed = paperOrderCollectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    FORWARDER_IDEMPOTENCY_ENDPOINTS.PAPER_ORDER_COLLECTION,
    () => runIdempotent({
      endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.PAPER_ORDER_COLLECTION,
      idempotencyKey,
      payload: {
        tripId,
        forwarderId: forwarder.id,
        expectedVersion: parsed.data.expectedVersion ?? null,
      },
      createdBy: forwarder.id,
      entityType: 'trip',
      responseStatusCode: 200,
      create: async (tx) => {
        await assertForwarderMutableTripScope(tripId, forwarder.id, tx);
        await assertTripShipmentAccountingUnlocked(tx, tripId);
        const [trip] = await tx.select({
          id: s.trips.id,
          version: s.trips.version,
          truckId: s.trips.truckId,
          shipmentId: s.trips.shipmentId,
          orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
          paperOrderCollectedAt: s.trips.paperOrderCollectedAt,
          paperOrderCollectedBy: s.trips.paperOrderCollectedBy,
        }).from(s.trips)
          .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
          .where(eq(s.trips.id, tripId))
          .limit(1)
          .for('update');
        if (!trip) {
          throw new ApiError(404, 'Không tìm thấy chuyến đi.');
        }
        if (parsed.data.expectedVersion != null && trip.version !== parsed.data.expectedVersion) {
          throw new ApiError(409, 'Chuyến đi đã thay đổi. Vui lòng tải lại.');
        }
        if (!trip.truckId) {
          throw new ApiError(409, 'Chưa thể bàn giao lệnh gốc khi điều vận chưa phân xe.');
        }
        if (!trip.orderExchangeCompletedAt) {
          throw new ApiError(409, 'Chưa thể bàn giao lệnh gốc khi Ops chưa hoàn tất đổi lệnh.');
        }
        if (trip.paperOrderCollectedAt || trip.paperOrderCollectedBy) {
          throw new ApiError(409, 'Lệnh gốc đã được giao nhận xác nhận trước đó.');
        }
        const [updated] = await tx.update(s.trips)
          .set({
            paperOrderCollectedAt: new Date(),
            paperOrderCollectedBy: forwarder.id,
            version: sql`${s.trips.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(s.trips.id, tripId))
          .returning({
            tripId: s.trips.id,
            version: s.trips.version,
            paperOrderCollectedAt: s.trips.paperOrderCollectedAt,
            paperOrderCollectedBy: s.trips.paperOrderCollectedBy,
          });
        return updated;
      },
    }),
  );
  res.json(outcome.result);
}));


export default router;
