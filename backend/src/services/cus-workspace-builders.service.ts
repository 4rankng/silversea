/**
 * CUS workspace row builders — operational summary, list-item, and container
 * line/missing-field builders that turn loaded rows into workspace DTOs.
 * Moved verbatim from cus-shipment-workspace-reads.service.ts (main file
 * keeps the query readers). Type-only imports from the main file keep the
 * module graph runtime-acyclic: main → builders → {sql, mapping}.
 */
import {
  Role, ShipmentCusBucket, ShipmentStatus, canonicalShipmentStatus,
  SHIPMENT_CUS_BUCKET_LABELS, SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  SHIPMENT_CUS_MISSING_FIELD_LABELS, localDateInBusinessZone,
  ShipmentDocumentCustody,
  TripStatus,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceFieldAccess,
  type ShipmentCusMissingField,
  type ShipmentCusMissingFieldCode,
} from '@tingting/shared';

import { CARGO_MODE } from '../db/schema';
import {
  trimOrNull, businessDateNow, sumMoney, sumDecimal, toNumber,
  effectiveBillingLineAmount, billOrBookNumberFor,
} from './cus-workspace-mapping.service';
import { getShipmentFinanceConfirmationSummary } from './shipment-accounting-lock.service';
import { filterContainersByDateRange } from './container-date-filter';
import type { AuthUser } from '../middleware/auth';
import { ShipmentRow, ShipmentListRow, WorkspaceSupport, ContainerRow, AssignmentRow } from './cus-shipment-workspace-reads.service';

/**
 * Current-assignment identity: the planned allocation (the dispatch plan's
 * own fields) is the ONLY carrier-identity source for the CUS workspace,
 * mirroring dispatch-planning-detail-plan.service. Trip resources are
 * execution records — they feed status only and never present a carrier or
 * vehicle as current — so a stale, historical, or canceled trip can no longer
 * disagree with the dispatch plan's "Chưa phân nhà xe, CUS sẽ bổ sung".
 * (Supersedes the 2026-09-08 executed-plate-wins wording decision: unifying
 * the two workspaces on one source outranks execution-first display, and the
 * badge, counter, and Phân xe column still cannot disagree — they now all
 * derive from the same planned value.)
 */
function currentAssignmentIdentity(assignment?: AssignmentRow | null): {
  carrierType: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId: number | null;
  externalCarrierVehicleId: number | null;
  carrierName: string | null;
  plateNumber: string | null;
} {
  const carrierType = (assignment?.plannedCarrierType as 'OWN' | 'EXTERNAL' | null) ?? null;
  return {
    carrierType,
    externalCarrierId: assignment?.plannedExternalCarrierId ?? null,
    externalCarrierVehicleId: assignment?.plannedExternalCarrierVehicleId ?? null,
    carrierName: carrierType == null
      ? null
      : carrierType === 'OWN'
        ? 'SilverSea'
        : (assignment?.plannedCarrierShortName?.trim() || assignment?.plannedCarrierName) ?? null,
    plateNumber: trimOrNull(assignment?.plannedVehiclePlateNumber),
  };
}

function buildOperationalSummary(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  bucket: ShipmentCusBucket,
  actor: AuthUser,
): ShipmentCusWorkspaceListItem['operational'] {
  const containers = support.containersByShipment.get(row.shipment.id) ?? [];
  let assignedContainers = 0;
  let externalContainers = 0;
  let plateAssignedContainers = 0;
  let missingCarrierContainers = 0;
  let missingPlateContainers = 0;
  let orderIssuedContainers = 0;

  for (const container of containers) {
    const assignment = support.assignmentsByContainer.get(container.id) ?? null;
    const { carrierType, plateNumber } = currentAssignmentIdentity(assignment);
    // "Issued" mirrors the driver-notification gate exactly: a live (not
    // canceled) trips row is the only thing the driver's task list and
    // tap-through match against — planned plates alone never count.
    if (assignment?.tripId != null && assignment.tripStatus !== 'CANCELED') {
      orderIssuedContainers += 1;
    }
    if (carrierType == null) {
      missingCarrierContainers += 1;
      continue;
    }
    const hasAssignedVehicle = carrierType === 'EXTERNAL'
      ? assignment?.plannedExternalCarrierId != null
      : plateNumber != null;
    if (hasAssignedVehicle) assignedContainers += 1;
    if (carrierType === 'EXTERNAL') {
      externalContainers += 1;
    }
    if (!plateNumber) missingPlateContainers += 1;
    else plateAssignedContainers += 1;
  }

  const totalContainers = containers.length;
  // An LCL lot allocates at the fulfillment level: transport readiness is
  // real even with zero container rows. No lot-level carrier = WAITING_CARRIER,
  // carrier without a planned plate = WAITING_PLATE, both = READY. Only a row
  // with no fulfillment at all keeps NO_CONTAINERS ("Không áp dụng điều xe").
  const lotLevelAssignment = row.shipment.cargoMode === CARGO_MODE.FCL
    ? null
    : support.assignmentsByShipment.get(row.shipment.id) ?? null;
  const lotIdentity = currentAssignmentIdentity(lotLevelAssignment);
  const vehicleReadiness = totalContainers === 0
    ? (lotIdentity.carrierType == null
      ? 'WAITING_CARRIER' as const
      : lotIdentity.plateNumber == null
        ? 'WAITING_PLATE' as const
        : 'READY' as const)
    : missingCarrierContainers > 0
      ? 'WAITING_CARRIER' as const
      : missingPlateContainers > 0
        ? 'WAITING_PLATE' as const
        : 'READY' as const;
  // Customer feedback 2026-09-07 (BL `JJCTCHPDY260305`): FCL delivery date
  // lives on `shipment_containers.customerAppointmentAt`, not on the
  // shipment row's `expectedDeliveryDate`. The previous rule surfaced
  // "Chưa chốt ngày" for FCL shipments whose containers already had an
  // appointment, leaving the row unable to be edited and the detail page
  // showing a different (correct) date. Treat the earliest container
  // appointment as the effective schedule for FCL.
  // Customer feedback 2026-09-08: the earliest-appointment rule let one
  // dated cont mask its undated siblings — a 2-cont lot with a single
  // appointment read "Sẵn sàng điều xe" with no warning. FCL readiness is
  // per-container: the lot only counts as scheduled once EVERY cont has its
  // ngày đóng/trả; any missing appointment keeps WAITING_DATE ("Chưa chốt
  // ngày"), the same per-cont rule containerMissingFields() already applies
  // to TRANSPORT_DATE. Lots without container rows keep the shipment-level
  // expectedDeliveryDate fallback — and when that is unset, the lot-level
  // closing/planned-return timestamp, which is exactly the field pair the
  // "Chỉnh sửa Lịch trình" dialog writes (card 20260914_35, lead ruling:
  // those timestamps ARE the lot's schedule for container-less lots).
  const fclAppointmentValues = row.shipment.cargoMode === 'FCL' && totalContainers > 0
    ? containers.map((container) => container.customerAppointmentAt)
    : null;
  const undatedFclContainers = fclAppointmentValues
    ? fclAppointmentValues.filter((value) => value == null).length
    : 0;
  const earliestFclAppointment = fclAppointmentValues
    ? fclAppointmentValues
      .filter((value): value is Date => value != null)
      .sort((left, right) => left.getTime() - right.getTime())[0]
    : null;
  const lotLevelTimestamp = row.shipment.closingAt ?? row.shipment.plannedReturnAt;
  const effectiveScheduleDate = fclAppointmentValues != null
    ? (undatedFclContainers === 0 && earliestFclAppointment != null
      ? localDateInBusinessZone(earliestFclAppointment)
      : null)
    : row.shipment.expectedDeliveryDate
      ?? (lotLevelTimestamp != null ? localDateInBusinessZone(lotLevelTimestamp) : null);
  const scheduleReadiness = effectiveScheduleDate == null
    ? 'WAITING_DATE' as const
    : bucket === ShipmentCusBucket.NEW && effectiveScheduleDate < businessDateNow()
      ? 'OVERDUE' as const
      : 'SCHEDULED' as const;
  const transportDateEditable = actor.role === Role.CUS
    && support.locksByShipment.get(row.shipment.id) == null;

  // Some trips link to a shipment directly (`trips.shipmentId`, e.g. a
  // combined/consolidated trip created outside the per-container fulfillment
  // flow) instead of through a container's fulfillment. `orderIssuedContainers`
  // above only walks fulfillment-linked trips, so it can read zero while such
  // a direct trip still exists — check both, matching softDeleteShipment's
  // live-trip guard so this flag never disagrees with what delete will do.
  const hasDirectLiveTrip = (support.tripsByShipment.get(row.shipment.id)?.length ?? 0) > 0;
  const deletable = orderIssuedContainers === 0 && !hasDirectLiveTrip;

  return {
    scheduleReadiness,
    vehicleReadiness,
    totalContainers,
    assignedContainers,
    externalContainers,
    plateAssignedContainers,
    missingCarrierContainers,
    missingPlateContainers,
    orderIssuedContainers,
    transportDateEditable,
    deletable,
  };
}



function buildListItem(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  actor: AuthUser,
  confirmation: Awaited<ReturnType<typeof getShipmentFinanceConfirmationSummary>>,
  dateRange?: { dateFrom?: string; dateTo?: string },
): ShipmentCusWorkspaceListItem {
  const allContainers = support.containersByShipment.get(row.shipment.id) ?? [];
  const containers = dateRange
    ? filterContainersByDateRange(
      allContainers,
      dateRange.dateFrom,
      dateRange.dateTo,
      // Undated containers plan by the shipment's delivery date — the same
      // fallback containerTransportDateSql() uses for the row filter, so the
      // scoped summary never zero-counts a row the filter still shows.
      () => row.shipment.expectedDeliveryDate,
    )
    : allContainers;
  const activeLock = support.locksByShipment.get(row.shipment.id) ?? null;
  const debitNote = support.debitNotesByShipment.get(row.shipment.id) ?? null;
  const custody = support.custodyByShipment.get(row.shipment.id) ?? null;
  const trips = support.tripsByShipment.get(row.shipment.id) ?? [];
  const recoveryFacts = support.recoveryFactsByShipment.get(row.shipment.id) ?? [];
  const declaration = support.declarationByShipment.get(row.shipment.id) ?? null;
  const totalCost = sumMoney(trips.map((trip) => trip.totalCost));
  const bucket = deriveCusBucket(row.shipment.status, activeLock != null);
  const hasPendingRecovery = recoveryFacts.some((fact) => toNumber(fact.outstandingAmount) > 0);
  const operational = buildOperationalSummary(row, support, bucket, actor);
  const billingLines = debitNote == null
    ? []
    : (support.billingLinesByShipment.get(row.shipment.id) ?? [])
      .filter((line) => line.documentId === debitNote.billingDocumentId);
  const hasUnattributableAdhoc = billingLines.some((line) => (
    line.sourceType === 'ADHOC' && effectiveBillingLineAmount(line) !== 0
  ));
  const attributedBillingLines = billingLines.filter((line) => (
    (line.sourceType === 'TRIP' && line.sourceTripShipmentId === row.shipment.id)
    || (line.sourceType === 'EXPENSE' && line.sourceExpenseShipmentId === row.shipment.id)
  ));
  const customerTotalsAvailable = debitNote != null
    && billingLines.length > 0
    && attributedBillingLines.length > 0
    && !hasUnattributableAdhoc;
  const customerInvoiceTotal = customerTotalsAvailable
    ? sumMoney(attributedBillingLines
      .filter((line) => line.vatTreatment === 'STANDARD' || line.vatTreatment === 'ZERO_RATED')
      .map(effectiveBillingLineAmount))
    : null;
  const customerNoInvoiceTotal = customerTotalsAvailable
    ? sumMoney(attributedBillingLines
      .filter((line) => line.vatTreatment === 'EXEMPT')
      .map(effectiveBillingLineAmount))
    : null;
  const authoritativeCustomerTotal = customerTotalsAvailable
    ? toNumber(customerInvoiceTotal) + toNumber(customerNoInvoiceTotal)
    : null;
  const assignments = [
    ...containers.map((container) => support.assignmentsByContainer.get(container.id) ?? null),
    // Lot-level (LCL) allocation renders its carrier chip with no container
    // row — assigned LCL fulfillments must read the same as container rows
    // (customer requirement 2026-09-12: assigned LCL summary carrier chip).
    support.assignmentsByShipment.get(row.shipment.id) ?? null,
  ];
  const lotSnapshot = support.assignmentsByShipment.get(row.shipment.id)?.siteSnapshot ?? null;
  const liftSiteNames = uniqueNonEmpty(containers.length > 0
    ? containers.map((container) => resolveLiftSite(support, container, support.assignmentsByContainer.get(container.id) ?? null)?.name)
    : [readPortSnapshot(lotSnapshot, 'pickupWarehouse')?.name]);
  const dropoffSiteNames = uniqueNonEmpty(containers.length > 0
    ? containers.map((container) => resolveDropoffSite(support, container, support.assignmentsByContainer.get(container.id) ?? null)?.name)
    : [readPortSnapshot(lotSnapshot, 'deliverySite')?.name]);
  const customerAppointmentAts = uniqueNonEmpty(containers.map((container) => (
    container.customerAppointmentAt?.toISOString() ?? null
  )));
  const appointmentGroups = buildAppointmentGroups(
    containers,
    row.shipment,
    support.factoryNameBySiteId,
  );
  // Multi-factory display (SILVER L1 P3): distinct effective factory labels
  // across containers — never a false single factory. Falls back to the
  // shipment-level factory text when no container names a site.
  const containerFactoryNames = uniqueNonEmpty(containers.map((container) => (
    container.operationalSiteId != null
      ? support.factoryNameBySiteId.get(container.operationalSiteId)?.shortName ?? null
      : null
  )));
  const effectiveFactoryNames = containerFactoryNames.length > 0
    ? containerFactoryNames
    : uniqueNonEmpty([
        row.shipment.operationalSiteId != null
          ? support.factoryNameBySiteId.get(row.shipment.operationalSiteId)?.shortName ?? null
          : null,
        trimOrNull(row.shipment.factoryName),
      ]);
  const effectiveRouteNames = row.shipment.cargoMode === CARGO_MODE.FCL
    ? uniqueNonEmpty(containers.map((container) => container.routeName ?? row.routeName))
    : uniqueNonEmpty([row.routeName]);
  const carrierAssignments = assignments.reduce<Array<{ carrierName: string | null; plateNumber: string | null }>>((result, assignment) => {
    if (assignment == null) return result;
    const { carrierName, plateNumber } = currentAssignmentIdentity(assignment);
    if (carrierName == null && plateNumber == null) return result;
    if (!result.some((item) => item.carrierName === carrierName && item.plateNumber === plateNumber)) {
      result.push({ carrierName, plateNumber });
    }
    return result;
  }, []);

  const accountantAction = confirmation.status === 'CONFIRMED'
    ? {
        kind: 'NONE' as const,
        label: 'Đã xác nhận',
        enabled: false,
        disabledReason: null,
      }
    : {
        kind: 'CONFIRM_FINANCE' as const,
        label: 'Xác nhận tài chính',
        enabled: debitNote != null,
        disabledReason: debitNote == null ? 'Chưa có Debit Note hiện hành đủ điều kiện.' : null,
      };

  return {
    id: row.shipment.id,
    version: row.shipment.version,
    status: (row.shipment.cargoMode === 'FCL' && operational.scheduleReadiness === 'WAITING_DATE' && canonicalShipmentStatus(row.shipment.status) === ShipmentStatus.READY_FOR_DISPATCH)
      ? ShipmentStatus.PENDING_DATE
      : (canonicalShipmentStatus(row.shipment.status) ?? ShipmentStatus.PENDING_DATE),
    cargoMode: row.shipment.cargoMode,
    bucket,
    bucketLabel: SHIPMENT_CUS_BUCKET_LABELS[bucket],
    customerName: row.customerName,
    factoryName: trimOrNull(row.shipment.factoryName),
    effectiveFactoryNames,
    billOrBookNumber: billOrBookNumberFor(row.shipment.tradeDirection, row.shipment.blNumber, row.shipment.bookingRef),
    declarationNumber: declaration?.declarationNumber ?? null,
    shippingLineName: trimOrNull(row.shipment.shippingLineName),
    // A lot overview may summarize multiple FCL routes, but individual
    // container rows retain the exact route that drives dispatch.
    routeName: effectiveRouteNames.join(' · ') || null,
    isCombined: row.shipment.isCombined,
    direction: row.shipment.tradeDirection,
    containerSummary: buildContainerSummary(containers, row.shipment.packageCount, row.shipment.packageType),
    packageCount: row.shipment.packageCount,
    packageType: trimOrNull(row.shipment.packageType),
    weightKg: sumDecimal(containers.map((container) => container.cargoWeightKg), 2)
      ?? (row.shipment.cargoWeightKg == null ? null : String(row.shipment.cargoWeightKg)),
    volumeCbm: sumDecimal(containers.map((container) => container.cargoVolumeCbm), 3)
      ?? (row.shipment.cargoVolumeCbm == null ? null : String(row.shipment.cargoVolumeCbm)),
    transportDate: row.shipment.cargoMode === CARGO_MODE.FCL
      ? (() => {
          const earliest = containers
            .map((container) => container.customerAppointmentAt)
            .filter((value): value is Date => value != null)
            .sort((left, right) => left.getTime() - right.getTime())[0];
          return earliest ? localDateInBusinessZone(earliest) : null;
        })()
      : row.shipment.expectedDeliveryDate,
    customsCutoffAt: row.shipment.customsCutoffAt?.toISOString() ?? null,
    closingAt: row.shipment.closingAt?.toISOString() ?? null,
    plannedReturnAt: row.shipment.plannedReturnAt?.toISOString() ?? null,
    deliveryLocation: trimOrNull(row.shipment.deliveryLocation),
    liftSiteNames,
    dropoffSiteNames,
    customerAppointmentAts,
    appointmentGroups,
    carrierAssignments,
    customerNotes: trimOrNull(row.shipment.customerNotes),
    operationalNotes: trimOrNull(row.shipment.operationalNotes),
    raw: {
      customerId: row.shipment.customerId,
      isAdHoc: row.shipment.isAdHoc,
      factoryName: trimOrNull(row.shipment.factoryName),
      routeId: row.shipment.routeId,
      deliveryLocation: trimOrNull(row.shipment.deliveryLocation),
      blNumber: trimOrNull(row.shipment.blNumber),
      bookingRef: trimOrNull(row.shipment.bookingRef),
      declarationNumber: declaration?.declarationNumber ?? null,
      tradeDirection: row.shipment.tradeDirection,
      shippingLineName: trimOrNull(row.shipment.shippingLineName),
      packageCount: row.shipment.packageCount,
      packageType: trimOrNull(row.shipment.packageType),
      cargoWeightKg: row.shipment.cargoWeightKg == null ? null : String(row.shipment.cargoWeightKg),
      cargoVolumeCbm: row.shipment.cargoVolumeCbm == null ? null : String(row.shipment.cargoVolumeCbm),
      customsCutoffAt: row.shipment.customsCutoffAt?.toISOString() ?? null,
      closingAt: row.shipment.closingAt?.toISOString() ?? null,
      plannedReturnAt: row.shipment.plannedReturnAt?.toISOString() ?? null,
      customerNotes: trimOrNull(row.shipment.customerNotes),
      operationalNotes: trimOrNull(row.shipment.operationalNotes),
      declarationId: declaration?.id ?? null,
      declarationIssuedAt: declaration?.issuedAt?.toISOString() ?? null,
      declarationScope: declaration?.scope ?? null,
      declarationNote: trimOrNull(declaration?.note),
    },
    fieldAccess: shipmentFieldAccess(row.shipment, actor, activeLock != null, containers.length > 0),
    operational,
    finance: {
      customerInvoiceTotal,
      customerNoInvoiceTotal,
      totalCost,
      isLoss: authoritativeCustomerTotal == null ? null : authoritativeCustomerTotal < toNumber(totalCost),
      hasPendingRecovery,
      customerChargeTotalsAvailable: customerTotalsAvailable,
      totalCostAvailable: true,
      customerTotalsAuthority: customerTotalsAvailable ? 'BILLING_DOCUMENT' : 'UNAVAILABLE',
    },
    debitNote: {
      available: debitNote != null,
      billingDocumentId: debitNote?.billingDocumentId ?? null,
      documentNumber: debitNote == null ? null : `Debit Note #${debitNote.billingDocumentId}`,
      issuedAt: debitNote?.issuedAt?.toISOString() ?? null,
      debitNoteStatus: debitNote?.debitNoteStatus ?? null,
      disabledReason: debitNote == null ? 'Chưa có Debit Note hiện hành đủ điều kiện.' : null,
    },
    documentCustody: {
      status: custody?.status == null ? null : custody.status as ShipmentDocumentCustody,
      label: custody == null
        ? null
        : SHIPMENT_DOCUMENT_CUSTODY_LABELS[custody.status as ShipmentDocumentCustody] ?? custody.status,
      available: custody != null,
      editable: activeLock == null && actor.role === Role.CUS,
    },
    accountingConfirmation: confirmation,
    activeLock: activeLock == null
      ? null
      : {
          id: activeLock.id,
          billingDocumentId: activeLock.billingDocumentId,
          activatedAt: activeLock.activatedAt.toISOString(),
          activatedByName: activeLock.activatedByName,
          reason: activeLock.reason,
        },
    action: activeLock != null
      ? {
          kind: 'REQUEST_REOPEN',
          label: 'Đề nghị điều chỉnh',
          enabled: actor.role === Role.CUS,
          disabledReason: actor.role === Role.CUS ? null : 'Chỉ CUS được gửi đề nghị điều chỉnh.',
        }
      : actor.role === Role.ACCOUNTANT
        ? accountantAction
        : {
            kind: 'LOCK',
            label: 'Khóa lô',
            enabled: actor.role === Role.CUS && confirmation.status === 'CONFIRMED',
            disabledReason: actor.role !== Role.CUS
              ? 'Chỉ CUS được khóa lô.'
              : confirmation.status === 'CONFIRMED'
                ? null
                : 'Cần Kế toán xác nhận lại số liệu trước khi khóa lô.',
          },
  };
}

// Lift/drop authority is the per-container port columns (same columns the
// create form writes). Only a snapshot explicitly marked PORT can supply a
// legacy port fallback; a FACTORY delivery snapshot is a different place.
// The missing-status bits
// in containerMissingFields/containerMissingBitsSql resolve through these
// same id-based helpers. Display names use the same authority as their
// selector IDs, so creating a delivery snapshot cannot relabel a port.
function resolveLiftSite(
  support: WorkspaceSupport,
  container: ContainerRow,
  assignment: AssignmentRow | null,
) {
  if (container.pickupPortId != null) return support.portsById.get(container.pickupPortId) ?? null;
  return readPortSnapshot(assignment?.siteSnapshot ?? null, 'pickupWarehouse');
}

function resolveDropoffSite(
  support: WorkspaceSupport,
  container: ContainerRow,
  assignment: AssignmentRow | null,
) {
  if (container.dropoffPortId != null) return support.portsById.get(container.dropoffPortId) ?? null;
  return readPortSnapshot(assignment?.siteSnapshot ?? null, 'deliverySite');
}

function readPortSnapshot(snapshot: Record<string, unknown> | null, key: 'pickupWarehouse' | 'deliverySite') {
  const legacyPort = readSiteSnapshotSite(snapshot, key);
  return legacyPort?.siteType === 'PORT' ? legacyPort : null;
}

function buildContainerLine(
  row: ShipmentListRow,
  actor: AuthUser,
  support: WorkspaceSupport,
  container: ContainerRow,
  ordinal: number,
): ShipmentCusWorkspaceContainerLine {
  const assignment = support.assignmentsByContainer.get(container.id) ?? null;
  const activeLock = support.locksByShipment.get(row.shipment.id) ?? null;
  const editableBase = activeLock == null && (
    actor.role === Role.ADMIN
    || actor.role === Role.MANAGER
    || actor.role === Role.CUS
    || actor.role === Role.DISPATCHER
  );
  const canEditOperational = editableBase && assignment?.tripId == null;
  const liftSite = resolveLiftSite(support, container, assignment);
  const dropoffSite = resolveDropoffSite(support, container, assignment);
  // Carrier identity follows the planned allocation only (see
  // currentAssignmentIdentity): the dispatch plan is the shared source of
  // truth, so CUS and dispatch can never disagree about the current
  // carrier/vehicle; trip resources stay status-only.
  const { carrierType, externalCarrierId, externalCarrierVehicleId, carrierName, plateNumber } = currentAssignmentIdentity(assignment);
  // CUS may plan the plate for BOTH external carriers and the internal fleet
  // (customer ask, Cap_nhat_UI_va_logic 1.3): the value is a plan; the
  // executed trip never overrides it — dispatch shows the planned value too.
  const plateEditable = canEditOperational;
  // Dispatch chip vocabulary (customer decision 2026-09-08, revised the same
  // evening): a running or finished trip outranks everything. A CREATED trip
  // reads "Đã tạo chuyến" while its ngày đóng/trả is still missing; once the
  // date is set, a line carrying a vehicle reads "Đã phân xe" (PLANNED), and
  // only a line still missing the vehicle reads "Chờ phân xe".
  const dispatchStatus = assignment?.tripStatus === 'COMPLETED'
    ? 'COMPLETED'
    : assignment?.tripStatus === 'IN_TRANSIT'
      ? 'IN_TRANSIT'
      : assignment?.tripStatus === 'CREATED' && container.customerAppointmentAt == null
        ? 'CREATED'
        : plateNumber != null
          ? 'PLANNED'
          : 'AWAITING_VEHICLE';

  return {
    id: container.id,
    ordinal,
    operationalSiteId: container.operationalSiteId ?? row.shipment.operationalSiteId ?? null,
    containerNumber: container.containerNumber,
    containerTypeId: container.containerTypeId,
    containerTypeLabel: container.containerTypeCode ?? container.containerTypeName,
    routeId: row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeId : row.shipment.routeId,
    routeName: row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeName : row.routeName,
    dispatchStatus,
    tripId: assignment?.tripId ?? null,
    // Assignment rows carry the raw varchar; the contract narrows to the enum.
    tripStatus: (assignment?.tripStatus as TripStatus | null) ?? null,
    carrierType: carrierType as 'OWN' | 'EXTERNAL' | null,
    externalCarrierId,
    externalCarrierVehicleId,
    carrierName,
    plateNumber,
    liftSiteId: container.pickupPortId ?? liftSite?.id ?? null,
    liftSite: liftSite?.name ?? null,
    dropoffSiteId: container.dropoffPortId ?? dropoffSite?.id ?? null,
    dropoffSite: dropoffSite?.name ?? null,
    customerAppointmentAt: container.customerAppointmentAt?.toISOString() ?? null,
    raw: {
      containerNumber: container.containerNumber,
      containerTypeId: container.containerTypeId,
      cargoWeightKg: container.cargoWeightKg,
      cargoVolumeCbm: container.cargoVolumeCbm,
      routeId: row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeId : row.shipment.routeId,
    },
    fieldAccess: containerFieldAccess(
      actor,
      activeLock != null,
      assignment?.tripId != null,
    ),
    permissions: {
      carrierEditable: canEditOperational,
      plateEditable,
      containerTypeEditable: canEditOperational,
      liftSiteEditable: canEditOperational,
      dropoffSiteEditable: canEditOperational,
      customerAppointmentEditable: canEditOperational,
      routeEditable: canEditOperational,
    },
    shipmentVersion: row.shipment.version,
    relatedTripVersion: assignment?.tripVersion ?? null,
  };
}

// JS twin of containerMissingBitsSql(): identical field set, applicability
// gating, and precedence so the projected missingFields list can never
// disagree with the SQL informationStatus=MISSING filter.
function containerMissingFields(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  container: ContainerRow,
  assignment: AssignmentRow | null,
): ShipmentCusMissingField[] {
  const missing: ShipmentCusMissingFieldCode[] = [];
  const transportDate = row.shipment.cargoMode === CARGO_MODE.FCL
    ? (container.customerAppointmentAt ? localDateInBusinessZone(container.customerAppointmentAt) : null)
    : row.shipment.expectedDeliveryDate;
  const carrierType = assignment?.plannedCarrierType ?? null;
  const push = (code: ShipmentCusMissingFieldCode, absent: boolean) => {
    if (absent) missing.push(code);
  };
  // Shipment context.
  push('DIRECTION', row.shipment.tradeDirection == null);
  push('BILL_BOOKING', !(trimOrNull(row.shipment.blNumber) || trimOrNull(row.shipment.bookingRef)));
  push('DECLARATION', !support.declarationByShipment.has(row.shipment.id));
  push('ROUTE', (row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeId : row.shipment.routeId) == null);
  push('SHIPPING_LINE', !(trimOrNull(row.shipment.shippingLineName) || trimOrNull(container.shippingLineName)));
  push('TRANSPORT_DATE', transportDate == null);
  // Container row.
  push('CONTAINER_NUMBER', container.containerNumber == null);
  push('CONTAINER_TYPE', container.containerTypeId == null);
  push('LIFT_SITE', resolveLiftSite(support, container, assignment) == null);
  push('DROPOFF_SITE', resolveDropoffSite(support, container, assignment) == null);
  push('APPOINTMENT', container.customerAppointmentAt == null);
  // Vehicle stage: carrier only after a transport date exists; BKS only for
  // an external carrier — the same planned-only identity rule everywhere, so
  // this JS projection can never disagree with its SQL twin
  // (containerIncompleteSql's activePlannedPlateSql gate).
  push('CARRIER', transportDate != null && carrierType == null);
  push('BKS', transportDate != null
    && carrierType === 'EXTERNAL'
    && assignment?.plannedVehiclePlateNumber == null);
  return missing.map((code) => ({ code, label: SHIPMENT_CUS_MISSING_FIELD_LABELS[code] }));
}


function deriveCusBucket(status: string | null, hasActiveLock: boolean): ShipmentCusBucket {
  if (hasActiveLock) return ShipmentCusBucket.LOCKED;
  const canonical = canonicalShipmentStatus(status);
  if (canonical === ShipmentStatus.DISPATCHED || canonical === ShipmentStatus.IN_TRANSIT) {
    return ShipmentCusBucket.RUNNING;
  }
  if (canonical === ShipmentStatus.COMPLETED) {
    return ShipmentCusBucket.LOCKED;
  }
  return ShipmentCusBucket.NEW;
}

function countContainerTypes(rows: ContainerRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.containerTypeCode ?? row.containerTypeName ?? 'Cont';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, qty]) => `${qty}x${label}`).join(' + ');
}

export {
  buildOperationalSummary, deriveCusBucket, buildListItem, resolveLiftSite,
  resolveDropoffSite, buildContainerLine, containerMissingFields,
  shipmentFieldAccess, countContainerTypes,
};

const allShipmentFieldKeys = [
  'customerId', 'factoryName', 'routeId', 'deliveryLocation', 'blNumber', 'bookingRef',
  'declarationNumber', 'tradeDirection', 'shippingLineName', 'packageCount', 'packageType',
  'cargoWeightKg', 'cargoVolumeCbm', 'customsCutoffAt', 'closingAt', 'plannedReturnAt',
  'customerNotes', 'operationalNotes',
] as const satisfies ReadonlyArray<keyof ShipmentCusWorkspaceListItem['fieldAccess']>;

function readOnly(reason: string): ShipmentCusWorkspaceFieldAccess {
  return { mode: 'READ_ONLY', reason };
}

function shipmentFieldAccess(
  shipment: ShipmentRow,
  actor: AuthUser,
  hasActiveLock: boolean,
  hasContainers: boolean,
): ShipmentCusWorkspaceListItem['fieldAccess'] {
  const access = {} as ShipmentCusWorkspaceListItem['fieldAccess'];
  const canWriteShipment = actor.role === Role.CUS || actor.role === Role.ADMIN || actor.role === Role.MANAGER;
  for (const field of allShipmentFieldKeys) {
    if (field === 'declarationNumber') {
      access[field] = !canWriteShipment
        ? readOnly('Chỉ CUS, Quản trị hoặc Quản lý được cập nhật tờ khai.')
        : hasActiveLock
          ? readOnly('Lô hàng đã khóa kế toán; không thể sửa tờ khai.')
          : { mode: 'DIRECT', reason: 'Cập nhật tờ khai trực tiếp theo lô hàng.' };
      continue;
    }
    if (hasActiveLock) {
      access[field] = readOnly('Lô hàng đã khóa kế toán; không thể thay đổi dữ liệu vận hành.');
    } else if (!canWriteShipment) {
      access[field] = readOnly('Vai trò hiện tại chỉ được xem trường này.');
    } else if (hasContainers && (field === 'cargoWeightKg' || field === 'cargoVolumeCbm')) {
      access[field] = readOnly('Số liệu hiển thị là tổng theo container; hãy cập nhật từng container.');
    } else {
      access[field] = { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp trường này.' };
    }
  }
  return access;
}

function containerFieldAccess(
  actor: AuthUser,
  hasActiveLock: boolean,
  hasTrip: boolean,
): ShipmentCusWorkspaceContainerLine['fieldAccess'] {
  const editable = !hasActiveLock && !hasTrip && (
    actor.role === Role.ADMIN
    || actor.role === Role.MANAGER
    || actor.role === Role.CUS
    || actor.role === Role.DISPATCHER
  );
  const reason = hasActiveLock
    ? 'Lô hàng đã khóa kế toán; không thể thay đổi container.'
    : hasTrip
      ? 'Container đã có chuyến thực tế; hãy dùng luồng điều chỉnh điều vận.'
      : (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.CUS && actor.role !== Role.DISPATCHER)
        ? 'Vai trò hiện tại chỉ được xem dữ liệu container.'
        : 'Bạn có thể cập nhật trực tiếp trước khi điều xe.';
  const mode = editable ? 'DIRECT' as const : 'READ_ONLY' as const;
  // 2026-09-10 user directive: all phê duyệt (approval) flows are removed.
  // Route/container-number/pickup-drop-off used to flip CUS from DIRECT to a
  // dispatcher-reviewed REQUEST once the container had a trip or its run date
  // passed; these fields now save directly for CUS at any point before the
  // accounting lock. The generic trip-based DIRECT/READ_ONLY split stays for
  // DISPATCHER and other roles.
  const dateGatedFields = new Set(['containerNumber', 'routeId', 'liftSiteId', 'dropoffSiteId']);
  const access = (key: keyof ShipmentCusWorkspaceContainerLine['fieldAccess']): ShipmentCusWorkspaceFieldAccess => {
    // plateNumber intentionally has no OWN special case: since the internal
    // fleet became plan-able (Cap_nhat_UI_va_logic 1.3) the field follows the
    // generic editable/READ_ONLY mode, mirroring permissions.plateEditable —
    // the plate is a plan; the official dispatch trip confirms it.
    if (dateGatedFields.has(key) && actor.role === Role.CUS && !hasActiveLock) {
      return { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp.' };
    }
    // Container number is identity, not an operational parameter — the write
    // path has allowed number edits on tripped containers since the
    // value-aware guard landed, and dispatch routinely fills numbers left
    // blank at intake once the lot is already assigned. DISPATCHER gets the
    // same direct-write flag CUS has (pre-lock, trip or not); route/ports
    // stay on the generic split for dispatch.
    if (key === 'containerNumber' && actor.role === Role.DISPATCHER && !hasActiveLock) {
      return { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp.' };
    }
    return { mode, reason };
  };
  return {
    operationalSiteId: access('operationalSiteId'),
    containerNumber: access('containerNumber'), containerTypeId: access('containerTypeId'),
    cargoWeightKg: access('cargoWeightKg'), cargoVolumeCbm: access('cargoVolumeCbm'),
    routeId: access('routeId'),
    carrierType: access('carrierType'), externalCarrierId: access('externalCarrierId'),
    externalCarrierVehicleId: access('externalCarrierVehicleId'), plateNumber: access('plateNumber'),
    liftSiteId: access('liftSiteId'), dropoffSiteId: access('dropoffSiteId'),
    customerAppointmentAt: access('customerAppointmentAt'),
  };
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(trimOrNull).filter((value): value is string => value != null))];
}


function buildContainerSummary(rows: ContainerRow[], packageCount: number | null, packageType: string | null): string {
  if (rows.length === 0) {
    if (packageCount == null) return '';
    return `${packageCount} ${trimOrNull(packageType) ?? 'kiện'}`;
  }
  return countContainerTypes(rows);
}

/**
 * Group a lot's containers by (appointment instant, effective factory) so the
 * "Lịch trình & điều xe" cell can show every close/return time on its own
 * line ("09:00 25/08/2026 · Sunrise · 1x40HC"). Factory resolves through the
 * SILVER L1 precedence chain (container site → shipment site → shipment
 * factory text). Containers without an appointment are skipped; groups are
 * ordered earliest-first, then factory name. Legacy noon-UTC date-only
 * encodings retain their stored calendar date.
 */
function buildAppointmentGroups(
  containers: ContainerRow[],
  shipment: ShipmentRow,
  factoryNameBySiteId: Map<number, { shortName: string; fullName: string }>,
): Array<{ at: string; localDate: string; factoryName: string | null; factoryShortName: string | null; factoryFullName: string | null; containerSummary: string }> {
  const byKey = new Map<string, { at: string; localDate: string; factoryName: string | null; factoryShortName: string | null; factoryFullName: string | null; group: ContainerRow[] }>();
  for (const container of containers) {
    if (container.customerAppointmentAt == null) continue;
    const localDate = localDateInBusinessZone(container.customerAppointmentAt) ?? '0000-00-00';
    const factorySiteId = container.operationalSiteId ?? shipment.operationalSiteId ?? null;
    const factorySite = factorySiteId != null
      ? factoryNameBySiteId.get(factorySiteId)
      : null;
    const legacyFactoryName = trimOrNull(shipment.factoryName);
    const factoryShortName = factorySite?.shortName ?? legacyFactoryName ?? null;
    const factoryFullName = factorySite?.fullName ?? legacyFactoryName ?? null;
    const factoryName = factoryShortName;
    const factoryKey = factorySite != null && factorySiteId != null
      ? `site:${factorySiteId}`
      : `legacy:${factoryFullName ?? ''}`;
    const at = container.customerAppointmentAt.toISOString();
    const key = `${at}|${factoryKey}`;
    const entry = byKey.get(key);
    if (entry) {
      entry.group.push(container);
    } else {
      byKey.set(key, { at, localDate, factoryName, factoryShortName, factoryFullName, group: [container] });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.at.localeCompare(b.at)
      || (a.factoryName ?? '').localeCompare(b.factoryName ?? ''))
    .map(({ at, localDate, factoryName, factoryShortName, factoryFullName, group }) => ({
      at,
      localDate,
      factoryName,
      factoryShortName,
      factoryFullName,
      containerSummary: countContainerTypes(group),
    }));
}


function readSiteSnapshotSite(
  snapshot: Record<string, unknown> | null,
  key: 'pickupWarehouse' | 'deliverySite',
) {
  const value = snapshot?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const site = value as Record<string, unknown>;
  return {
    id: typeof site.id === 'number' ? site.id : null,
    code: typeof site.code === 'string' ? site.code : null,
    name: typeof site.shortName === 'string'
      ? site.shortName
      : typeof site.name === 'string' ? site.name : null,
    siteType: typeof site.siteType === 'string' ? site.siteType : null,
  };
}
