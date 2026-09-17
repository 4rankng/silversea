import { driverFinanceClient } from './driverFinanceClient';
import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { DRIVER } from '@tingting/shared';
import {
  DriverProgressEventType,
  TripPodFileType,
  TripPodStatus,
  type DriverIncidentalCostType,
  type TripStatus,
  type ShipmentAccountingLockSummary,
  type VehicleAlert,
} from '@tingting/shared';
import { fileCommandFingerprint } from '../lib/api';
import type { FuelEvidenceReviewRecord } from './fuelEvidenceClient';
import type { DriverJourneyCard } from './driverJourneyBoard';

type DriverMilestoneEventType = DriverProgressEventType;

interface DriverTaskTripSummary {
  id: number;
  fulfillmentId: number | null;
  tripCode: string | null;
  departureDate: string;
  status: string;
  routeName: string | null;
  truckPlate: string | null;
  customerName: string | null;
  containerNumbers: string[];
}

export interface DriverTaskTwoOrdersView {
  date: string;
  active: DriverTaskTripSummary | null;
  next: DriverTaskTripSummary | null;
  firstOrderLate: boolean;
  allToday: DriverTaskTripSummary[];
  pair: {
    pairId: number;
    status: string;
    breakReason: string | null;
    emptyDistanceKm: string | null;
    combinedEfficiencyPercent: string | null;
    requiredGapMinutes: number | null;
    actualGapMinutes: number | null;
    lateByMinutes: number | null;
    first: DriverTaskTripSummary | null;
    second: DriverTaskTripSummary | null;
  } | null;
}

const DRIVER_TASK = {
  DETAIL: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}`,
  PROGRESS: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/progress`,
  FUEL_EVIDENCE: (tripId: number) => `/driver/me/trips/${tripId}/fuel-evidence`,
  EVIDENCE: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/evidence-status`,
  PODS: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/pod`,
  POD_FILES: (fulfillmentId: number, submissionId: number) => `/driver/me/fulfillments/${fulfillmentId}/pod/${submissionId}/files`,
  POD_SUBMIT: (fulfillmentId: number, submissionId: number) => `/driver/me/fulfillments/${fulfillmentId}/pod/${submissionId}/submit`,
  COMPLETE: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/complete`,
  INCIDENTAL_COSTS: (tripId: number) => `/driver/me/trips/${tripId}/incidental-costs`,
  COST_SUBMISSION_NOTE: (tripId: number) => `/driver/me/trips/${tripId}/cost-submission-note`,
  JOURNEY_BOARD: '/driver/me/journey-board',
  VEHICLE: '/driver/me/vehicle',
} as const;

// Journey-board wire types moved to ./driverJourneyBoard (structure-guard
// split — this file was at its frozen LOC ceiling).
export type { DriverJourneyBucket, DriverJourneyClassification, DriverJourneyCard } from './driverJourneyBoard';

/** The driver's current vehicle (topbar identity chip). */
export interface DriverVehicle {
  truckPlate: string | null;
}

export interface DriverTaskLeg {
  id: number;
  sequence: number;
  origin: string;
  destination: string;
  km: number;
  loadingType: string;
}

export interface DriverTaskContainer {
  id: number;
  /** Row optimistic-lock token (sent back as If-Unmodified-Since on PATCH). */
  updatedAt: string;
  containerNumber: string;
  sealNumber: string | null;
  containerTypeId: number | null;
  containerTypeName: string | null;
  containerTypeCode: string | null;
  cargoWeightKg: string | null;
}

export interface DriverTaskPodFile {
  id: number;
  fileType: TripPodFileType;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl?: string | null;
}

export interface DriverTaskPodSubmission {
  id: number;
  tripId: number;
  fulfillmentId: number | null;
  submissionVersion: number;
  status: TripPodStatus;
  sourceTripVersion: number;
  version: number;
  createdAt: string;
  updatedAt?: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  acceptedAt: string | null;
  supersedesSubmissionId: number | null;
  files: DriverTaskPodFile[];
  missingFileTypes?: TripPodFileType[];
  isReady?: boolean;
}

export interface DriverTaskMilestoneEvent {
  id: number;
  tripId: number;
  driverId: number;
  eventType: DriverProgressEventType;
  occurredAt: string;
  note: string | null;
  recordedBy: number | null;
  createdAt: string;
}

export interface DriverTaskEvidenceStatus {
  ready: boolean;
  currentTripVersion?: number;
  missingItems: Array<{
    code: string;
    label: string;
    reason?: string | null;
  }>;
  hasDeliveredMilestone?: boolean;
  hasSubmittedPod?: boolean;
}

export interface DriverTaskDetail {
  id: number;
  version: number;
  tripCode: string | null;
  status: TripStatus;
  departureDate: string;
  plannedStartAt?: string | null;
  routeName: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  trailerType: string | null;
  customerName: string | null;
  cargoTypeName: string | null;
  tradeDirection?: string | null;
  fuelLiters: string | null;
  fuelMode: string | null;
  fuelSupplierName: string | null;
  totalRoadAllowance: string | null;
  driverSalary: string | null;
  hasReturnCargo: boolean | null;
  notes: string | null;
  /** 27.8 cost-section Ghi chú — driver-written note for accounting re-check
   *  of auto-recorded costs (Tiền đường / Phí Lạch Huyện). */
  costSubmissionNote: string | null;
  customerReference: string | null;
  paperOrderCollectedAt?: string | null;
  paperOrderCollectedBy?: number | null;
  paperOrderCollectedByName?: string | null;
  accountingLock: ShipmentAccountingLockSummary | null;
  instructions?: {
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
  } | null;
  fuelEvidenceReviews?: FuelEvidenceReviewRecord[];
  containers: DriverTaskContainer[];
  legs: DriverTaskLeg[];
  fulfillment?: {
    id: number;
    code: string | null;
    taskCode: string | null;
    type: string | null;
    modeLabel?: string | null;
    factoryName: string | null;
    factoryShortName: string | null;
    /** Canonical full site name — the full-name row renders this. */
    factoryFullName?: string | null;
    /** Factory site street address (own "Địa chỉ nhà máy" row in the grid). */
    factoryAddress: string | null;
    /** Kho site phone — the warehouse-phone row always renders, tel link or "—". */
    khoPhone: string | null;
    pickupPortName: string | null;
    dropPortName: string | null;
    /** Stage-2 empty-container return depot — rendered in its own row only
     *  when it names a different place than the delivery point. */
    returnDepotName?: string | null;
    pickupWarehouseName: string | null;
    dropWarehouseName: string | null;
    lclWarehouseName: string | null;
    plannedAt: string | null;
    contactName: string | null;
    contactPhone: string | null;
    driverNotes: string | null;
    routeSummary: string | null;
    siteRules: string[];
    invoiceInfo: DriverFulfillmentInvoiceInfo | null;
    containerSealPhotos: DriverContainerSealPhoto[];
  } | null;
  currentPod?: DriverTaskPodSubmission | null;
  podHistory?: DriverTaskPodSubmission[];
  /** TC-DA-001: canonical tag pool (board embed contract, 320aad6b); FE resolves chips via @tingting/shared parseDriverTaskNote. */
  knownTagLabels?: string[];
  /** TC-DA-005: customer master-data invoice block — hidden when null. */
  invoiceMaster?: DriverInvoiceMaster | null;
  /** Factory's own invoice identity — explicit party attribution; null when
   *  the factory site has no invoice configuration. */
  invoiceFactory?: DriverInvoiceFactory | null;
}

export interface DriverInvoiceMaster {
  taxCode: string | null;
  companyName: string | null;
  address: string | null;
}

/** Factory's own invoice identity (site fee-invoice profile; null when the
 *  site has no invoice configuration — the section shows an honest empty
 *  state, never the customer's data). */
export interface DriverInvoiceFactory {
  name: string | null;
  address: string | null;
  taxCode: string | null;
}

export interface DriverContainerSealPhoto {
  id: number;
  type: 'CONTAINER' | 'SEAL' | 'DELIVERY_NOTE';
  storageKey: string;
  uploadedAt: string;
}

export interface DriverFulfillmentInvoiceInfo {
  liftFeeInvoiceName: string | null;
  liftFeeInvoiceAddress: string | null;
  liftFeeTaxCode: string | null;
  dropFeeInvoiceName: string | null;
  dropFeeInvoiceAddress: string | null;
  dropFeeTaxCode: string | null;
  cleaningInvoiceName: string | null;
  cleaningInvoiceAddress: string | null;
  cleaningTaxCode: string | null;
}

interface DriverFulfillmentDetailResponse {
  fulfillmentId: number;
  shipmentId: number;
  shipmentCode: string | null;
  bookingRef: string | null;
  cargoMode: 'FCL' | 'LCL' | null;
  tradeDirection?: string | null;
  fulfillmentType: string;
  tripId: number;
  tripVersion: number;
  factoryName: string | null;
  factoryShortName: string | null;
  factoryFullName: string | null;
  factoryAddress: string | null;
  khoPhone: string | null;
  invoiceMaster: DriverInvoiceMaster | null;
  invoiceFactory: DriverInvoiceFactory | null;
  knownTagLabels: string[];
  pickupLocation: string | null;
  deliveryLocation: string | null;
  returnDepotName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  driverNotes: string | null;
  siteSnapshot: Record<string, unknown>;
  invoiceInfo: DriverFulfillmentInvoiceInfo | null;
  containerSealPhotos: DriverContainerSealPhoto[];
  evidenceStatus: {
    ready: boolean;
    missing: string[];
    hasDeliveredMilestone: boolean;
    hasSubmittedPod: boolean;
  };
  podSubmissions: Array<Omit<DriverTaskPodSubmission,
    'tripId' | 'fulfillmentId' | 'createdAt' | 'rejectedAt' | 'acceptedAt'>>;
  trip: DriverTaskDetail;
}

function mapPodSubmission(
  submission: DriverFulfillmentDetailResponse['podSubmissions'][number],
  wire: Pick<DriverFulfillmentDetailResponse, 'tripId' | 'fulfillmentId'>,
): DriverTaskPodSubmission {
  return {
    ...submission,
    tripId: wire.tripId,
    fulfillmentId: wire.fulfillmentId,
    createdAt: submission.submittedAt ?? submission.reviewedAt ?? '',
    rejectedAt: submission.status === TripPodStatus.REJECTED ? submission.reviewedAt : null,
    acceptedAt: submission.status === TripPodStatus.ACCEPTED ? submission.reviewedAt : null,
  };
}

function mapFulfillmentDetail(wire: DriverFulfillmentDetailResponse): DriverTaskDetail {
  const podHistory = wire.podSubmissions.map((submission) => mapPodSubmission(submission, wire));
  const deliverySite = wire.siteSnapshot.deliverySite as Record<string, unknown> | null | undefined;
  const currentPod = podHistory[0] ?? null;
  return {
    ...wire.trip,
    containers: wire.trip.containers ?? [],
    legs: wire.trip.legs ?? [],
    version: wire.tripVersion,
    // Spec A6 cross-check: tradeDirection lives at the wire top level (next to
    // cargoMode/driverNotes), not inside wire.trip — spreading wire.trip alone
    // dropped it, leaving DriverContainerCard's IMPORT advisory permanently off.
    tradeDirection: wire.tradeDirection ?? null,
    fulfillment: {
      id: wire.fulfillmentId,
      code: wire.shipmentCode,
      taskCode: wire.shipmentCode,
      type: wire.fulfillmentType,
      modeLabel: wire.cargoMode,
      factoryName: wire.factoryName,
      factoryShortName: wire.factoryShortName,
      factoryFullName: wire.factoryFullName ?? null,
      factoryAddress: wire.factoryAddress,
      khoPhone: wire.khoPhone,
      pickupPortName: wire.pickupLocation,
      dropPortName: wire.deliveryLocation,
      returnDepotName: wire.returnDepotName ?? null,
      pickupWarehouseName: wire.pickupLocation,
      dropWarehouseName: wire.deliveryLocation,
      lclWarehouseName: wire.cargoMode === 'LCL' ? wire.pickupLocation : null,
      plannedAt: wire.trip.plannedStartAt ?? null,
      contactName: wire.contactName,
      contactPhone: wire.contactPhone,
      driverNotes: wire.driverNotes ?? null,
      routeSummary: wire.trip.routeName,
      siteRules: typeof deliverySite?.strictRules === 'string' && deliverySite.strictRules.trim()
        ? [deliverySite.strictRules.trim()]
        : [],
      invoiceInfo: wire.invoiceInfo,
      containerSealPhotos: wire.containerSealPhotos,
    },
    currentPod,
    podHistory,
    // TC-DA-001/005: tag pool + customer master invoice block ride the detail
    // wire; chips resolve FE-side via @tingting/shared parseDriverTaskNote.
    knownTagLabels: wire.knownTagLabels ?? [],
    invoiceMaster: wire.invoiceMaster ?? null,
    invoiceFactory: wire.invoiceFactory ?? null,
  };
}

export interface DriverTripBasic {
  id: number;
  shipmentId: number | null;
  fulfillmentId: number | null;
  tripCode: string | null;
  departureDate: string | null;
  plannedStartAt: string | null;
  status: string;
  routeName: string | null;
  truckPlate: string | null;
  customerName: string | null;
  notes: string | null;
}

export const driverClient = {
  getTrips: async () => {
    return api.get<{
      items: Array<{
        id: number;
        fulfillmentId: number | null;
        departureDate: string;
        status: string;
        driverSalary: string | null;
        routeName: string | null;
        truckPlate: string | null;
      }>;
    }>(DRIVER.TRIPS);
  },

  getPenalties: async (params?: { dateFrom: string; dateTo: string }) => {
    return api.get<
      | Array<{
          id: number;
          driverId: number;
          tripId: number | null;
          tripCode?: string | null;
          reasonId: number | null;
          customReason: string | null;
          amount: string;
          date: string;
          reasonText?: string;
        }>
      | {
          items: Array<{
            id: number;
            driverId: number;
            tripId: number | null;
            tripCode?: string | null;
            reasonId: number | null;
            customReason: string | null;
            amount: string;
            date: string;
            reasonText?: string;
          }>;
        }
    >(`${DRIVER.PENALTIES}${toQuery(params)}`);
  },

  /** N5 / B4 — overdue/due reminders for the driver's truck. */
  getVehicleAlerts: async () => {
    return api.get<{ items: VehicleAlert[] }>(DRIVER.VEHICLE_ALERTS);
  },

  /** M8.3 — two-orders-per-day view (active + next today, firstOrderLate). */
  getTwoOrders: async () => {
    return api.get<DriverTaskTwoOrdersView>(DRIVER.TWO_ORDERS);
  },

  /** M8.4 — list a trip's progress events (timeline, oldest-first). */
  listProgress: async (tripId: number) => {
    return api.get<{ items: DriverTaskMilestoneEvent[] }>(DRIVER_TASK.PROGRESS(tripId));
  },

  /**
   * M8.4 — record a progress event. The `idempotencyKey` is sent in the
   * `Idempotency-Key` header so an explicit retry returns the original
   * event instead of duplicating (PRD M08-04-03, Q23). Returns the event +
   * a flag the caller can ignore (the HTTP status 201/200 distinction is
   * handled by the api wrapper resolving either as success).
   */
  recordProgress: async (
    tripId: number,
    body: {
      eventType: DriverMilestoneEventType;
      occurredAt: string;
      note?: string;
      expectedVersion?: number;
      fulfillmentId?: number;
    },
    idempotencyKey: string,
  ) => {
    return api.post<DriverTaskMilestoneEvent>(DRIVER_TASK.PROGRESS(tripId), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  getJourneyBoard: async () => {
    const wire = await api.get<{ items: DriverJourneyCard[]; knownTagLabels?: string[] }>(DRIVER_TASK.JOURNEY_BOARD);
    return { items: wire.items, knownTagLabels: wire.knownTagLabels ?? [] };
  },

  /** Topbar identity chip — the driver's current vehicle plate. */
  getVehicle: async () => {
    return api.get<DriverVehicle>(DRIVER_TASK.VEHICLE);
  },

  /** Card 20260915_1: ownership-enforced trip detail by TRIP id — the page
   *  resolves fulfillmentId from this payload before fulfillment-scoped calls
   *  (ad-hoc trips carry fulfillmentId null and never hit them). */
  getDriverTrip: async (tripId: number) => {
    return api.get<DriverTripBasic>(`/driver/me/trips/${tripId}`);
  },

  getTaskDetail: async (fulfillmentId: number) => {
    const wire = await api.get<DriverFulfillmentDetailResponse>(DRIVER_TASK.DETAIL(fulfillmentId));
    return mapFulfillmentDetail(wire);
  },

  getEvidenceStatus: async (fulfillmentId: number) => {
    const wire = await api.get<DriverFulfillmentDetailResponse['evidenceStatus']>(DRIVER_TASK.EVIDENCE(fulfillmentId));
    return {
      ready: wire.ready,
      missingItems: wire.missing.map((label) => ({ code: label, label })),
      hasDeliveredMilestone: wire.hasDeliveredMilestone,
      hasSubmittedPod: wire.hasSubmittedPod,
    };
  },

  uploadFuelEvidence: async (args: {
    tripId: number;
    file: File;
    location?: {
      lat: number;
      lng: number;
      accuracy?: number;
      altitude?: number;
      timestamp?: number;
      source?: string;
      sampleCount?: number;
      bestAccuracy?: number;
      elapsedMs?: number;
    } | null;
  }) => {
    const formData = new FormData();
    formData.append('file', args.file);
    if (args.location) {
      formData.append('lat', String(args.location.lat));
      formData.append('lng', String(args.location.lng));
      if (args.location.accuracy != null) formData.append('accuracy', String(args.location.accuracy));
      if (args.location.altitude != null) formData.append('altitude', String(args.location.altitude));
      if (args.location.timestamp != null) formData.append('gpsAt', String(args.location.timestamp));
      if (args.location.source) formData.append('source', args.location.source);
      if (args.location.sampleCount != null) formData.append('sampleCount', String(args.location.sampleCount));
      if (args.location.bestAccuracy != null) formData.append('bestAccuracy', String(args.location.bestAccuracy));
      if (args.location.elapsedMs != null) formData.append('elapsedMs', String(args.location.elapsedMs));
    }
    const retryFingerprint = [
      'driver-fuel-evidence',
      fileCommandFingerprint(args.file),
      args.tripId,
    ].join(':');
    return api.upload(DRIVER_TASK.FUEL_EVIDENCE(args.tripId), formData, {
      retryFingerprint,
    }) as Promise<FuelEvidenceReviewRecord>;
  },

  createPodSubmission: async (
    tripId: number,
    body: { expectedVersion: number },
    idempotencyKey: string,
  ) => {
    return api.post<DriverTaskPodSubmission>(DRIVER_TASK.PODS(tripId), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  attachPodFile: async (args: {
    tripId: number;
    submissionId: number;
    fileType: TripPodFileType;
    expectedVersion: number;
    file: File;
  }) => {
    const formData = new FormData();
    formData.append('file', args.file);
    formData.append('fileType', args.fileType);
    formData.append('expectedVersion', String(args.expectedVersion));
    const fingerprint = [
      'driver-pod-file',
      fileCommandFingerprint(args.file),
      args.tripId,
      args.submissionId,
      args.fileType,
      args.expectedVersion,
    ].join(':');
    return api.upload(DRIVER_TASK.POD_FILES(args.tripId, args.submissionId), formData, {
      retryFingerprint: fingerprint,
    }) as Promise<DriverTaskPodSubmission>;
  },

  /** e-POD file blob — authenticated fetch for thumbnails + fullscreen viewer. */
  downloadPodFile: async (fulfillmentId: number, fileId: number): Promise<Blob> => {
    return api.getBlob(`/driver/me/fulfillments/${fulfillmentId}/pod-files/${fileId}`);
  },

  createIncidentalCost: async (
    tripId: number,
    body: { payerKind?: 'USER' | 'COMPANY'; costType: DriverIncidentalCostType; amount: number; occurredAt: string; note?: string; receiptStorageKey?: string; costGroup?: 'DRIVER_SHIPMENT' | 'DRIVER_ROAD'; feeName?: string; invoiceNumber?: string; invoiceDate?: string },
    idempotencyKey: string,
  ) => {
    return api.post<{
      id: number;
      tripId: number;
      driverId: number; payerKind?: 'USER' | 'COMPANY';
      costType: DriverIncidentalCostType;
      amount: string;
      occurredAt: string;
      note: string | null;
      receiptStorageKey: string | null;
      createdAt: string;
      costGroup?: string | null;
      feeName?: string | null;
      invoiceNumber?: string | null;
      invoiceDate?: string | null;
    }>(DRIVER_TASK.INCIDENTAL_COSTS(tripId), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  listIncidentalCosts: async (tripId: number) => {
    const wire = await api.get<{ items: Array<{
      id: number;
      tripId: number;
      driverId: number; payerKind?: 'USER' | 'COMPANY';
      costType: DriverIncidentalCostType;
      amount: string;
      occurredAt: string;
      note: string | null;
      receiptStorageKey: string | null;
      createdAt: string;
      costGroup?: string | null;
      feeName?: string | null;
      invoiceNumber?: string | null;
      invoiceDate?: string | null;
    }> }>(DRIVER_TASK.INCIDENTAL_COSTS(tripId));
    return wire.items;
  },

  /** 27.8 cost-section Ghi chú — driver-written note for accounting re-check. */
  updateCostSubmissionNote: async (tripId: number, note: string | null) => {
    const trimmed = note?.trim() ? note.trim() : null;
    return api.put<{ tripId: number; costSubmissionNote: string | null }>(
      DRIVER_TASK.COST_SUBMISSION_NOTE(tripId),
      { note: trimmed },
    );
  },

  uploadReceiptPhoto: async (args: { tripId: number; file: File }) => {
    const formData = new FormData();
    formData.append('file', args.file);
    formData.append('trip_id', String(args.tripId));
    formData.append('type', 'OTHER');
    const retryFingerprint = [
      'driver-incidental-cost-receipt',
      fileCommandFingerprint(args.file),
      args.tripId,
    ].join(':');
    return api.upload('/upload', formData, { retryFingerprint }) as Promise<{ storageKey: string; url: string }>;
  },

  uploadContainerOrSealPhoto: async (args: { tripId: number; type: 'CONTAINER' | 'SEAL'; file: File }) => {
    const formData = new FormData();
    formData.append('file', args.file);
    formData.append('trip_id', String(args.tripId));
    formData.append('type', args.type);
    const retryFingerprint = [
      'driver-container-seal-photo',
      fileCommandFingerprint(args.file),
      args.tripId,
      args.type,
    ].join(':');
    return api.upload('/upload', formData, { retryFingerprint }) as Promise<{ storageKey: string; url: string }>;
  },

  submitPod: async (
    tripId: number,
    submissionId: number,
    body: { expectedVersion: number },
    idempotencyKey: string,
  ) => {
    return api.post<DriverTaskPodSubmission>(DRIVER_TASK.POD_SUBMIT(tripId, submissionId), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  completeTrip: async (
    tripId: number,
    body: { expectedVersion: number },
    idempotencyKey: string,
  ) => {
    return api.post<DriverTaskDetail>(DRIVER_TASK.COMPLETE(tripId), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  ...driverFinanceClient,

};
