/**
 * CUS shipment workspace — write commands.
 *
 * The container-line update command (`updateCusShipmentContainerLine`) plus
 * its write-side helpers: workspace writer gate, catalog validity asserts,
 * inline external-carrier/vehicle creation, and operational-site/port record
 * loading. Read models, formatting helpers, and SQL fragment builders come
 * from `cus-shipment-workspace-reads.service.ts` — writes → reads only,
 * never the reverse.
 */
import {
  Role,
  ShipmentStatus,
  canonicalShipmentStatus,
  normalizeContainerNumber,
  validateContainerNumber,
  type ShipmentCusContainerLineUpdateInput,
  type ShipmentCusContainerLineUpdateResult,
} from '@tingting/shared';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import { ensureReadyShipmentHandoff, isDirectlyEditableIntakeStatus } from './shipment-intake.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import {
  CUSTOMER_OPERATIONAL_NAME,
  SITE_OPERATIONAL_NAME,
  assertCusShipmentScope,
  buildWorkspaceDetail,
  deriveTransportDateFromContainerAppointments,
  formatPlate,
  loadShipmentRow,
  normalizeCarrierName,
  normalizePlate,
  trimOrNull,
  type ShipmentFulfillmentRow,
} from './cus-shipment-workspace-reads.service';

function requireWorkspaceWriter(actor: AuthUser) {
  if (actor.role !== Role.CUS && actor.role !== Role.DISPATCHER) {
    throw new ApiError(403, 'Chỉ CUS hoặc Điều vận được cập nhật dòng container trong workspace này.');
  }
}

async function assertActiveContainerType(containerTypeId: number, tx: Tx) {
  const [row] = await tx.select({ id: s.containerTypes.id }).from(s.containerTypes)
    .where(and(eq(s.containerTypes.id, containerTypeId), isNull(s.containerTypes.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(409, 'Loại container không còn hiệu lực.');
}

async function assertActiveContainerRoute(routeId: number, tx: Tx) {
  const [row] = await tx.select({ id: s.routes.id }).from(s.routes)
    .where(and(eq(s.routes.id, routeId), isNull(s.routes.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(409, 'Tuyến đường container không còn hiệu lực.');
}


async function loadExternalCarrier(
  carrierId: number,
  tx: Tx,
) {
  const [carrier] = await tx.select({
    id: s.customers.id,
    name: CUSTOMER_OPERATIONAL_NAME,
    isCarrier: s.customers.isCarrier,
    status: s.customers.status,
    deletedAt: s.customers.deletedAt,
  }).from(s.customers).where(eq(s.customers.id, carrierId)).limit(1);
  if (!carrier || carrier.deletedAt != null || carrier.status !== 'ACTIVE' || !carrier.isCarrier) {
    throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
  }
  return carrier;
}

async function loadCarrierVehicle(
  carrierId: number,
  vehicleId: number,
  tx: Tx,
) {
  const [vehicle] = await tx.select({
    id: s.carrierFleetVehicles.id,
    carrierId: s.carrierFleetVehicles.carrierId,
    licensePlate: s.carrierFleetVehicles.licensePlate,
  }).from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.id, vehicleId),
      eq(s.carrierFleetVehicles.carrierId, carrierId),
      eq(s.carrierFleetVehicles.isActive, true),
      isNull(s.carrierFleetVehicles.deletedAt),
    ))
    .limit(1)
    .for('update');
  if (!vehicle) throw new ApiError(409, 'Xe nhà xe không còn hiệu lực hoặc không thuộc nhà xe đã chọn.');
  return vehicle;
}

async function resolveInlineExternalCarrier(
  input: { name: string; plateNumber: string },
  actor: AuthUser,
  tx: Tx,
) {
  const normalizedCarrierName = normalizeCarrierName(input.name);
  const displayCarrierName = trimOrNull(input.name);
  if (displayCarrierName == null) {
    throw new ApiError(400, 'Tên nhà xe là bắt buộc.');
  }
  const licensePlate = formatPlate(input.plateNumber);
  const normalizedPlate = normalizePlate(input.plateNumber);
  if (normalizedPlate.length < 5) {
    throw new ApiError(400, 'Biển số xe không hợp lệ.');
  }

  await lockApplicationOwnedUniqueness(tx, 'cus-inline-carrier', [normalizedCarrierName]);

  const [matchedCarrier] = await tx.select({
    id: s.customers.id,
    name: CUSTOMER_OPERATIONAL_NAME,
    status: s.customers.status,
    isCarrier: s.customers.isCarrier,
    deletedAt: s.customers.deletedAt,
  }).from(s.customers)
    .where(or(
      sql`lower(btrim(${CUSTOMER_OPERATIONAL_NAME})) = ${normalizedCarrierName}`,
      sql`lower(btrim(${s.customers.name})) = ${normalizedCarrierName}`,
    ))
    .limit(1)
    .for('update');

  if (matchedCarrier && (matchedCarrier.deletedAt != null || matchedCarrier.status !== 'ACTIVE' || !matchedCarrier.isCarrier)) {
    throw new ApiError(409, 'Tên nhà xe đã tồn tại nhưng không ở trạng thái nhà xe hoạt động.');
  }

  let carrier = matchedCarrier ?? null;
  if (carrier == null) {
    [carrier] = await tx.insert(s.customers).values({
      name: displayCarrierName,
      shortName: displayCarrierName,
      status: 'ACTIVE',
      isCarrier: true,
    }).onConflictDoNothing().returning({
      id: s.customers.id,
      name: CUSTOMER_OPERATIONAL_NAME,
      status: s.customers.status,
      isCarrier: s.customers.isCarrier,
      deletedAt: s.customers.deletedAt,
    });
    if (!carrier) {
      [carrier] = await tx.select({
        id: s.customers.id,
        name: CUSTOMER_OPERATIONAL_NAME,
        status: s.customers.status,
        isCarrier: s.customers.isCarrier,
        deletedAt: s.customers.deletedAt,
      }).from(s.customers)
        .where(or(
          sql`lower(btrim(${CUSTOMER_OPERATIONAL_NAME})) = ${normalizedCarrierName}`,
          sql`lower(btrim(${s.customers.name})) = ${normalizedCarrierName}`,
        ))
        .limit(1)
        .for('update');
      if (!carrier || carrier.deletedAt != null || carrier.status !== 'ACTIVE' || !carrier.isCarrier) {
        throw new ApiError(409, 'Tên nhà xe vừa được dùng bởi bản ghi không hợp lệ cho workspace.');
      }
    }
  }

  await lockApplicationOwnedUniqueness(tx, 'cus-inline-carrier-vehicle', [carrier.id, normalizedPlate]);

  const matchingVehicles = await tx.select({
    id: s.carrierFleetVehicles.id,
    licensePlate: s.carrierFleetVehicles.licensePlate,
    isActive: s.carrierFleetVehicles.isActive,
    deletedAt: s.carrierFleetVehicles.deletedAt,
  }).from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.carrierId, carrier.id),
      eq(s.carrierFleetVehicles.normalizedPlate, normalizedPlate),
    ))
    .for('update');

  const blockedVehicle = matchingVehicles.find((vehicle) => (
    vehicle.deletedAt != null || vehicle.isActive !== true
  ));
  if (blockedVehicle) {
    throw new ApiError(
      409,
      'Biển số nhà xe đã tồn tại nhưng không còn hiệu lực. Vui lòng liên hệ ADMIN hoặc Quản lý để xử lý danh mục xe.',
    );
  }

  const activeVehicles = matchingVehicles.filter((vehicle) => (
    vehicle.deletedAt == null && vehicle.isActive === true
  ));
  if (activeVehicles.length > 1) {
    throw new ApiError(
      409,
      'Biển số nhà xe đang có dữ liệu trùng lặp trong danh mục. Vui lòng liên hệ ADMIN hoặc Quản lý để xử lý trước khi tiếp tục.',
    );
  }

  const existingVehicle = activeVehicles[0] ?? null;
  if (existingVehicle) {
    if (existingVehicle.licensePlate !== licensePlate) {
      throw new ApiError(
        409,
        'Biển số nhà xe đã tồn tại với định dạng khác trong danh mục hoạt động. Vui lòng chọn xe hiện có hoặc liên hệ ADMIN hoặc Quản lý để cập nhật.',
      );
    }
    return {
      carrierId: carrier.id,
      carrierVehicleId: existingVehicle.id,
      plateNumber: licensePlate,
    };
  }

  let [vehicle] = await tx.insert(s.carrierFleetVehicles).values({
    carrierId: carrier.id,
    licensePlate,
    normalizedPlate,
    isActive: true,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  }).onConflictDoNothing().returning({
    id: s.carrierFleetVehicles.id,
  });
  if (!vehicle) {
    const rows = await tx.select({
      id: s.carrierFleetVehicles.id,
      licensePlate: s.carrierFleetVehicles.licensePlate,
      isActive: s.carrierFleetVehicles.isActive,
      deletedAt: s.carrierFleetVehicles.deletedAt,
    }).from(s.carrierFleetVehicles)
      .where(and(
        eq(s.carrierFleetVehicles.carrierId, carrier.id),
        eq(s.carrierFleetVehicles.normalizedPlate, normalizedPlate),
      ))
      .limit(2)
      .for('update');

    const blocked = rows.find((row) => row.deletedAt != null || row.isActive !== true);
    if (blocked) {
      throw new ApiError(
        409,
        'Biển số nhà xe đã tồn tại nhưng không còn hiệu lực. Vui lòng liên hệ ADMIN hoặc Quản lý để xử lý danh mục xe.',
      );
    }
    const active = rows.filter((row) => row.deletedAt == null && row.isActive === true);
    if (active.length === 1 && active[0]!.licensePlate === licensePlate) {
      vehicle = { id: active[0]!.id };
    } else {
      throw new ApiError(
        409,
        'Biển số nhà xe đã tồn tại trong danh mục hoạt động. Vui lòng chọn xe hiện có hoặc liên hệ ADMIN hoặc Quản lý để xử lý.',
      );
    }
  }

  return {
    carrierId: carrier.id,
    carrierVehicleId: vehicle.id,
    plateNumber: licensePlate,
  };
}

export async function updateCusShipmentContainerLine(args: {
  shipmentId: number;
  containerId: number;
  input: ShipmentCusContainerLineUpdateInput;
  actor: AuthUser;
  transaction?: Tx;
}): Promise<ShipmentCusContainerLineUpdateResult> {
  requireWorkspaceWriter(args.actor);

  const execute = async (tx: Tx) => {
    const shipment = await assertShipmentAccountingUnlocked(tx, args.shipmentId);
    await assertCusShipmentScope(args.actor, shipment, tx);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật dòng container.');
    }

    const [container] = await tx.select().from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.id, args.containerId),
        eq(s.shipmentContainers.shipmentId, args.shipmentId),
      ))
      .limit(1)
      .for('update');
    if (!container) throw new ApiError(404, 'Không tìm thấy container của lô hàng.');

    // Historical intake rows can predate the explicit shipment cargo-mode
    // field while already owning real container records. A container-scoped
    // write is unambiguously FCL (LCL is forbidden from owning containers), so
    // repair only that legacy null case inside this locked transaction before
    // creating its canonical fulfillment. Explicit FCL/LCL values still flow
    // through the strict decomposition checks unchanged.
    const repairedLegacyCargoMode = shipment.cargoMode == null;
    if (repairedLegacyCargoMode) {
      await tx.update(s.shipments).set({ cargoMode: 'FCL' })
        .where(eq(s.shipments.id, shipment.id));
      shipment.cargoMode = 'FCL';
    }

    let fulfillment: ShipmentFulfillmentRow | null = (await tx.select().from(s.shipmentFulfillments)
      .where(and(
        eq(s.shipmentFulfillments.shipmentId, args.shipmentId),
        eq(s.shipmentFulfillments.shipmentContainerId, args.containerId),
        isNull(s.shipmentFulfillments.canceledAt),
      ))
      .limit(1)
      .for('update'))[0] ?? null;
    if (!fulfillment) {
      const ensured = await ensureShipmentFulfillmentsInTx(tx, {
        shipmentId: args.shipmentId,
        actorId: args.actor.userId,
        allowClerkIntake: true,
      });
      fulfillment = ensured.find((row) => row.shipmentContainerId === args.containerId) ?? null;
    }
    if (!fulfillment) {
      throw new ApiError(409, 'Container chưa có tác vụ thực hiện chuẩn hóa để cập nhật từ workspace.');
    }

    const [trip] = await tx.select().from(s.trips)
      .where(and(
        eq(s.trips.fulfillmentId, fulfillment.id),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, 'CANCELED'),
      ))
      .limit(1)
      .for('update');

    const requestedOperationalMutation = (
      args.input.containerTypeId !== undefined
      || args.input.containerNumber !== undefined
      || args.input.cargoWeightKg !== undefined
      || args.input.cargoVolumeCbm !== undefined
      || args.input.routeId !== undefined
      || args.input.liftSiteId !== undefined
      || args.input.dropoffSiteId !== undefined
      || args.input.customerAppointmentAt !== undefined
      || args.input.carrierType !== undefined
      || args.input.externalCarrierId !== undefined
      || args.input.externalCarrierVehicleId !== undefined
      || args.input.plateNumber !== undefined
      || args.input.newExternalCarrier !== undefined
    );
    if (trip && requestedOperationalMutation) {
      throw new ApiError(409, 'Tác vụ đã điều xe; hãy dùng luồng điều chỉnh hiện có thay vì ghi đè trực tiếp lịch sử thực hiện.');
    }
    // Three-way edit routing (SILVER L1 P3): once the container has been
    // decomposed (fulfillment exists) the shipment has left direct-intake
    // territory — identity/schedule/factory edits flow through the governed
    // container change request, never a direct overwrite. Live-trip denial
    // above stays the strictest gate.
    const governedOperationalMutation = (
      args.input.containerTypeId !== undefined
      || args.input.containerNumber !== undefined
      || args.input.cargoWeightKg !== undefined
      || args.input.cargoVolumeCbm !== undefined
      || (args.input.routeId !== undefined && args.input.routeId !== container.routeId)
      || args.input.customerAppointmentAt !== undefined
    );
    if (governedOperationalMutation && !isDirectlyEditableIntakeStatus(shipment.status)) {
      throw new ApiError(409, 'Lô hàng đã bàn giao điều phối. Thay đổi container phải đi qua yêu cầu thay đổi để phê duyệt.');
    }

    let touched = repairedLegacyCargoMode;
    const now = new Date();

    if (args.input.containerNumber !== undefined) {
      const requestedContainerNumber = trimOrNull(args.input.containerNumber);
      const nextContainerNumber = requestedContainerNumber == null
        ? null
        : normalizeContainerNumber(requestedContainerNumber);
      if (nextContainerNumber !== container.containerNumber) {
        if (nextContainerNumber != null) {
          const [valid, message] = validateContainerNumber(nextContainerNumber);
          if (!valid) throw new ApiError(400, `Số container "${nextContainerNumber}" không hợp lệ: ${message}`);
          const shipmentContainers = await tx.select({
            id: s.shipmentContainers.id,
            containerNumber: s.shipmentContainers.containerNumber,
          }).from(s.shipmentContainers)
            .where(eq(s.shipmentContainers.shipmentId, args.shipmentId))
            .for('update');
          const duplicate = shipmentContainers.some((candidate) => (
            candidate.id !== container.id
            && candidate.containerNumber != null
            && normalizeContainerNumber(candidate.containerNumber) === nextContainerNumber
          ));
          if (duplicate) {
            throw new ApiError(400, `Số container "${nextContainerNumber}" đã tồn tại trong lô hàng.`);
          }
        }
        await tx.update(s.shipmentContainers).set({
          containerNumber: nextContainerNumber,
          updatedAt: now,
        }).where(eq(s.shipmentContainers.id, container.id));
        touched = true;
      }
    }

    if (
      args.input.cargoWeightKg !== undefined
      || args.input.cargoVolumeCbm !== undefined
    ) {
      const nextCargoWeightKg = args.input.cargoWeightKg === undefined
        ? container.cargoWeightKg
        : args.input.cargoWeightKg;
      const nextCargoVolumeCbm = args.input.cargoVolumeCbm === undefined
        ? container.cargoVolumeCbm
        : args.input.cargoVolumeCbm;
      if (nextCargoWeightKg !== container.cargoWeightKg || nextCargoVolumeCbm !== container.cargoVolumeCbm) {
        await tx.update(s.shipmentContainers).set({
          cargoWeightKg: nextCargoWeightKg,
          cargoVolumeCbm: nextCargoVolumeCbm,
          updatedAt: now,
        }).where(eq(s.shipmentContainers.id, container.id));
        touched = true;
      }
    }

    if (args.input.containerTypeId !== undefined && args.input.containerTypeId !== container.containerTypeId) {
      if (args.input.containerTypeId != null) await assertActiveContainerType(args.input.containerTypeId, tx);
      await tx.update(s.shipmentContainers).set({
        containerTypeId: args.input.containerTypeId ?? null,
        updatedAt: now,
      }).where(eq(s.shipmentContainers.id, container.id));
      touched = true;
    }

    if (args.input.routeId !== undefined && args.input.routeId !== container.routeId) {
      if (args.input.routeId == null && shipment.cargoMode === CARGO_MODE.FCL) {
        throw new ApiError(409, 'Mỗi container FCL phải có tuyến đường riêng trước khi điều xe.');
      }
      if (args.input.routeId != null) await assertActiveContainerRoute(args.input.routeId, tx);
      await tx.update(s.shipmentContainers).set({
        routeId: args.input.routeId ?? null,
        updatedAt: now,
      }).where(eq(s.shipmentContainers.id, container.id));
      touched = true;
    }

    if (args.input.liftSiteId !== undefined || args.input.dropoffSiteId !== undefined) {
      // Lift/drop editors pick from the Master-Data port catalog: validate the
      // ids against active ports and persist them on the per-container port
      // columns — the same authority the create form writes. Only persist
      // when the value actually changed; an identical no-op save must not
      // bump `shipment.version` (which would 409-conflict the user's next
      // identical save through the CUS route editor).
      const portIds = [...new Set(
        [args.input.liftSiteId, args.input.dropoffSiteId]
          .filter((value): value is number => value != null),
      )];
      const portsByIdIn = portIds.length === 0
        ? new Map<number, { id: number; code: string; name: string }>()
        : new Map((await tx.select({
          id: s.ports.id,
          code: s.ports.code,
          name: s.ports.name,
        }).from(s.ports)
          .where(and(inArray(s.ports.id, portIds), isNull(s.ports.deletedAt))))
          .map((port) => [port.id, port]));
      if (portsByIdIn.size !== portIds.length) {
        throw new ApiError(409, 'Cảng nâng/hạ không còn hiệu lực trong danh mục cảng, bãi.');
      }
      const nextContainerPortUpdate: Record<string, unknown> = {};
      if (args.input.liftSiteId !== undefined && args.input.liftSiteId !== container.pickupPortId) {
        nextContainerPortUpdate.pickupPortId = args.input.liftSiteId;
      }
      if (args.input.dropoffSiteId !== undefined && args.input.dropoffSiteId !== container.dropoffPortId) {
        nextContainerPortUpdate.dropoffPortId = args.input.dropoffSiteId;
      }
      const portValueChanged = Object.keys(nextContainerPortUpdate).length > 0;
      if (portValueChanged) {
        await tx.update(s.shipmentContainers).set({
          ...nextContainerPortUpdate,
          updatedAt: now,
        }).where(eq(s.shipmentContainers.id, container.id));
        // Keep the fulfillment site-snapshot aligned for legacy projections
        // (dispatch drawer, driver app) that still read the snapshot halves.
        const snapshotPort = (portId: number | null) => portId == null ? null : ({
          id: portsByIdIn.get(portId)!.id,
          code: portsByIdIn.get(portId)!.code,
          name: portsByIdIn.get(portId)!.name,
          siteType: 'PORT',
        });
        const nextSnapshot = { ...((fulfillment.siteSnapshot ?? {}) as Record<string, unknown>) };
        if (args.input.liftSiteId !== undefined) {
          nextSnapshot.pickupWarehouse = snapshotPort(args.input.liftSiteId);
        }
        if (args.input.dropoffSiteId !== undefined) {
          nextSnapshot.deliverySite = snapshotPort(args.input.dropoffSiteId);
        }
        await tx.update(s.shipmentFulfillments).set({
          siteSnapshot: nextSnapshot,
          version: fulfillment.version + 1,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
        touched = true;
      }
    }

    if (args.input.customerAppointmentAt !== undefined) {
      await tx.update(s.shipmentContainers).set({
        customerAppointmentAt: args.input.customerAppointmentAt == null
          ? null
          : new Date(args.input.customerAppointmentAt),
        updatedAt: now,
      }).where(eq(s.shipmentContainers.id, container.id));
      touched = true;
    }

    if (
      args.input.carrierType !== undefined
      || args.input.externalCarrierId !== undefined
      || args.input.externalCarrierVehicleId !== undefined
      || args.input.plateNumber !== undefined
      || args.input.newExternalCarrier !== undefined
    ) {
      const nextCarrierType = args.input.carrierType ?? fulfillment.plannedCarrierType ?? null;
      if (nextCarrierType === 'EXTERNAL') {
        const inlineCarrier = args.input.newExternalCarrier == null
          ? null
          : await resolveInlineExternalCarrier(args.input.newExternalCarrier, args.actor, tx);
        const nextCarrierId = inlineCarrier?.carrierId
          ?? args.input.externalCarrierId
          ?? fulfillment.plannedExternalCarrierId
          ?? null;
        if (nextCarrierId == null) throw new ApiError(400, 'Cần chọn hoặc nhập nhà xe ngoài hợp lệ.');
        await loadExternalCarrier(nextCarrierId, tx);
        const nextCarrierVehicleId = inlineCarrier?.carrierVehicleId
          ?? (args.input.externalCarrierVehicleId !== undefined
            ? args.input.externalCarrierVehicleId
            : fulfillment.plannedExternalCarrierVehicleId);
        const requestedPlate = inlineCarrier?.plateNumber
          ?? (args.input.plateNumber !== undefined
            ? trimOrNull(args.input.plateNumber)
            : fulfillment.plannedVehiclePlateNumber);
        const carrierVehicle = nextCarrierVehicleId == null
          ? null
          : await loadCarrierVehicle(nextCarrierId, nextCarrierVehicleId, tx);
        const nextPlateNumber = requestedPlate ?? carrierVehicle?.licensePlate ?? null;
        if (nextPlateNumber == null) {
          throw new ApiError(400, 'Cần chọn xe nhà xe hoặc nhập biển số kế hoạch trước khi cập nhật.');
        }
        await tx.update(s.shipmentFulfillments).set({
          plannedCarrierType: 'EXTERNAL',
          plannedExternalCarrierId: nextCarrierId,
          plannedExternalCarrierVehicleId: nextCarrierVehicleId ?? null,
          plannedVehiclePlateNumber: nextPlateNumber,
          version: fulfillment.version + 1,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      } else if (nextCarrierType === 'OWN') {
        // CUS may plan an internal-fleet plate (customer ask, Cap_nhat_UI_va_logic
        // 1.3). It is a plan only — the official dispatch trip remains the
        // confirming source once assigned.
        const nextPlateNumber = args.input.plateNumber !== undefined
          ? trimOrNull(args.input.plateNumber)
          : fulfillment.plannedVehiclePlateNumber;
        await tx.update(s.shipmentFulfillments).set({
          plannedCarrierType: 'OWN',
          plannedExternalCarrierId: null,
          plannedExternalCarrierVehicleId: null,
          plannedVehiclePlateNumber: nextPlateNumber,
          version: fulfillment.version + 1,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      } else if (nextCarrierType != null) {
        throw new ApiError(400, 'Loại nhà xe không hợp lệ.');
      }
      touched = true;
    }

    const derivedTransportDate = args.input.customerAppointmentAt === undefined
      ? undefined
      : deriveTransportDateFromContainerAppointments((await tx.select({
        customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
      }).from(s.shipmentContainers)
        .where(eq(s.shipmentContainers.shipmentId, args.shipmentId)))
        .map((row) => row.customerAppointmentAt));
    const canonicalStatus = canonicalShipmentStatus(shipment.status);
    if (
      shipment.cargoMode === CARGO_MODE.FCL
      && derivedTransportDate == null
      && canonicalStatus === ShipmentStatus.READY_FOR_DISPATCH
      && container.customerAppointmentAt != null
    ) {
      throw new ApiError(409, 'Không thể xóa lịch hẹn cuối cùng của container khi lô đã sẵn sàng điều xe.');
    }
    const becomesReady = shipment.cargoMode === CARGO_MODE.FCL
      && derivedTransportDate != null
      && canonicalStatus === ShipmentStatus.PENDING_DATE;

    if (touched) {
      const [updatedShipment] = await tx.update(s.shipments).set({
        ...(derivedTransportDate !== undefined ? { expectedDeliveryDate: derivedTransportDate } : {}),
        ...(becomesReady ? { status: ShipmentStatus.READY_FOR_DISPATCH } : {}),
        version: shipment.version + 1,
        updatedAt: now,
        updatedBy: args.actor.userId,
      }).where(and(
        eq(s.shipments.id, shipment.id),
        eq(s.shipments.version, shipment.version),
      )).returning();
      if (!updatedShipment) {
        throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại và thử lại.');
      }
      if (becomesReady) {
        await tx.insert(s.shipmentStatusHistory).values({
          shipmentId: shipment.id,
          fromStatus: ShipmentStatus.PENDING_DATE,
          toStatus: ShipmentStatus.READY_FOR_DISPATCH,
          reason: 'Đã cập nhật lịch theo container và sẵn sàng điều xe.',
          changedBy: args.actor.userId,
        });
        await ensureReadyShipmentHandoff(tx, updatedShipment, args.actor.userId);
      }
    }

    const detail = await buildWorkspaceDetail(await loadShipmentRow(args.shipmentId, args.actor, tx), args.actor, tx);
    const line = detail.containers.find((item) => item.id === args.containerId);
    if (!line) throw new ApiError(500, 'Không thể tải lại dòng container vừa cập nhật.');
    return { line };
  };

  return runInTx(args.transaction, execute);
}
