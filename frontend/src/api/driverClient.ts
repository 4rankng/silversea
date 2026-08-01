import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { DRIVER } from '@tingting/shared';
import {
  DriverProgressEventType,
  TripPodFileType,
  TripPodStatus,
  type TripStatus,
  type VehicleAlert,
} from '@tingting/shared';
import { fileCommandFingerprint } from '../lib/api';

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
  EVIDENCE: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/evidence-status`,
  PODS: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/pod`,
  POD_FILES: (fulfillmentId: number, submissionId: number) => `/driver/me/fulfillments/${fulfillmentId}/pod/${submissionId}/files`,
  POD_SUBMIT: (fulfillmentId: number, submissionId: number) => `/driver/me/fulfillments/${fulfillmentId}/pod/${submissionId}/submit`,
  COMPLETE: (fulfillmentId: number) => `/driver/me/fulfillments/${fulfillmentId}/complete`,
} as const;

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
  routeName: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  trailerType: string | null;
  customerName: string | null;
  cargoTypeName: string | null;
  fuelLiters: string | null;
  fuelMode: string | null;
  fuelSupplierName: string | null;
  totalRoadAllowance: string | null;
  driverSalary: string | null;
  hasReturnCargo: boolean | null;
  notes: string | null;
  customerReference: string | null;
  instructions?: {
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
  } | null;
  containers: DriverTaskContainer[];
  legs: DriverTaskLeg[];
  fulfillment?: {
    id: number;
    code: string | null;
    taskCode: string | null;
    type: string | null;
    modeLabel?: string | null;
    factoryName: string | null;
    pickupPortName: string | null;
    dropPortName: string | null;
    pickupWarehouseName: string | null;
    dropWarehouseName: string | null;
    lclWarehouseName: string | null;
    plannedAt: string | null;
    contactName: string | null;
    contactPhone: string | null;
    routeSummary: string | null;
    siteRules: string[];
  } | null;
  currentPod?: DriverTaskPodSubmission | null;
  podHistory?: DriverTaskPodSubmission[];
}

interface DriverFulfillmentDetailResponse {
  fulfillmentId: number;
  shipmentId: number;
  shipmentCode: string | null;
  bookingRef: string | null;
  cargoMode: 'FCL' | 'LCL' | null;
  fulfillmentType: string;
  tripId: number;
  tripVersion: number;
  factoryName: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  contactName: string | null;
  contactPhone: string | null;
  siteSnapshot: Record<string, unknown>;
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
    version: wire.tripVersion,
    fulfillment: {
      id: wire.fulfillmentId,
      code: wire.shipmentCode,
      taskCode: wire.shipmentCode,
      type: wire.fulfillmentType,
      modeLabel: wire.cargoMode,
      factoryName: wire.factoryName,
      pickupPortName: wire.pickupLocation,
      dropPortName: wire.deliveryLocation,
      pickupWarehouseName: wire.pickupLocation,
      dropWarehouseName: wire.deliveryLocation,
      lclWarehouseName: wire.cargoMode === 'LCL' ? wire.pickupLocation : null,
      plannedAt: wire.trip.departureDate,
      contactName: wire.contactName,
      contactPhone: wire.contactPhone,
      routeSummary: wire.trip.routeName,
      siteRules: typeof deliverySite?.strictRules === 'string' && deliverySite.strictRules.trim()
        ? [deliverySite.strictRules.trim()]
        : [],
    },
    currentPod,
    podHistory,
  };
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

  getEarnings: async (month: number, year: number) => {
    return api.get<{
      baseSalary: string;
      tripIncome: string;
      penalties: string;
      netIncome: string;
      // F2 / B2 — trip-based income + outstanding payable.
      productionSalary: string;
      roadAllowance: string;
      paidOrAdvanced: string;
      payableBalance: string;
      adjustment?: number;
      supplementPay?: number;
      leaveDeduction?: number;
      standardWorkDays?: number;
      paidDays?: number;
      dailyRate?: number;
      periodStart?: string;
      periodEnd?: string;
    }>(`${DRIVER.EARNINGS}${toQuery({ month, year })}`);
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
   * `Idempotency-Key` header so an offline-queue replay returns the original
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

  /** M8.6 — list the driver's issued payslip periods with earnings. */
  getPayslips: async () => {
    return api.get<{ items: Array<{
      period: string;
      status: string;
      closedAt: string | null;
      closedByName: string | null;
      note: string | null;
      earnings: {
        netIncome: string;
        productionSalary: string;
        roadAllowance: string;
        penalties: string;
        paidOrAdvanced: string;
        payableBalance: string;
        periodStart: string;
        periodEnd: string;
      };
    }> }>(DRIVER.PAYSLIPS);
  },
};
