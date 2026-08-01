import { createHash } from 'node:crypto';

import sharp from 'sharp';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from 'drizzle-orm';
import {
  DRIVER_FULFILLMENT_PROGRESS_SEQUENCE,
  DRIVER_PROGRESS_EVENT_LABELS,
  DriverProgressEventType,
  TripPodFileType,
  TripPodStatus,
  TRIP_POD_REQUIRED_FILE_TYPES,
} from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { sniffImageType } from '../lib/format';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { storageService } from './storage.service';
import type { Tx } from './trip-shared';
import { isFulfillmentRequired } from './shipment-fulfillment.service';

const MAX_POD_IMAGE_DIMENSION = 2048;
const PDF_MIME_TYPE = 'application/pdf';

const TRIP_POD_FILE_LABELS: Record<TripPodFileType, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Phiếu hạ bãi / trả hàng',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Biên bản giao nhận đã ký',
  [TripPodFileType.TOLL_TICKET]: 'Vé cầu đường',
};

export interface DriverPodFileView {
  id: number;
  fileType: TripPodFileType;
  label: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}

export interface DriverPodSubmissionView {
  id: number;
  tripId: number;
  fulfillmentId: number;
  submissionVersion: number;
  status: TripPodStatus;
  version: number;
  createdAt: string;
  submittedAt: string | null;
  submittedBy: number | null;
  reviewedAt: string | null;
  reviewedBy: number | null;
  rejectionReason: string | null;
  supersedesSubmissionId: number | null;
  sourceTripVersion: number;
  missingRequiredFileTypes: TripPodFileType[];
  isReadyForReview: boolean;
  files: DriverPodFileView[];
}

export interface ShipmentPodReviewItemView {
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentId: number;
  fulfillmentType: typeof s.shipmentFulfillments.$inferSelect.fulfillmentType;
  cargoMode: typeof s.shipmentFulfillments.$inferSelect.cargoMode;
  shipmentContainerId: number | null;
  containerNumber: string | null;
  canceledAt: string | null;
  cancellationDisposition: typeof s.shipmentFulfillments.$inferSelect.cancellationDisposition;
  replacementFulfillmentId: number | null;
  notRequiredReason: string | null;
  required: boolean;
  tripId: number | null;
  tripCode: string | null;
  tripStatus: typeof s.trips.$inferSelect.status | null;
  tripVersion: number | null;
  driverName: string | null;
  currentSubmission: DriverPodSubmissionView | null;
  history: DriverPodSubmissionView[];
}

export interface DriverCompletionEvidenceStatus {
  ready: boolean;
  missing: string[];
  hasDeliveredMilestone: boolean;
  hasSubmittedPod: boolean;
  hasRequiredPodFiles: boolean;
  latestSubmissionId: number | null;
  latestSubmissionStatus: TripPodStatus | null;
}

export interface OwnedFulfillmentTrip {
  tripId: number;
  tripCode: string | null;
  tripStatus: typeof s.trips.$inferSelect.status;
  tripVersion: number;
  fulfillmentId: number;
  shipmentId: number;
  driverId: number;
}

type UploadFileLike = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

type NormalizedPodUpload = {
  buffer: Buffer;
  extension: 'jpg' | 'pdf';
  mimeType: 'image/jpeg' | 'application/pdf';
  sha256: string;
  sizeBytes: number;
  originalFileName: string;
};

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

function fileTypeLabel(fileType: TripPodFileType): string {
  return TRIP_POD_FILE_LABELS[fileType];
}

function podFileDownloadUrl(fulfillmentId: number, fileId: number): string {
  return `/api/driver/me/fulfillments/${fulfillmentId}/pod-files/${fileId}`;
}

function shipmentPodFileDownloadUrl(shipmentId: number, fileId: number): string {
  return `/api/shipments/${shipmentId}/pod-files/${fileId}`;
}

function projectSiteSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const projectSite = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const site = value as Record<string, unknown>;
    return {
      id: site.id,
      code: site.code,
      name: site.name,
      siteType: site.siteType,
      address: site.address,
      googleMapsUrl: site.googleMapsUrl,
      strictRules: site.strictRules,
      sourceVersion: site.sourceVersion,
    };
  };
  return {
    deliverySite: projectSite(snapshot.deliverySite),
    pickupWarehouse: projectSite(snapshot.pickupWarehouse),
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(400, `${label} không hợp lệ.`);
  }
}

async function normalizePodUpload(file: UploadFileLike): Promise<NormalizedPodUpload> {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new ApiError(400, 'Không có tệp e-POD hợp lệ.');
  }
  if (file.size <= 0) {
    throw new ApiError(400, 'Tệp e-POD không hợp lệ.');
  }

  if (file.mimetype === PDF_MIME_TYPE || isPdfBuffer(file.buffer)) {
    return {
      buffer: file.buffer,
      extension: 'pdf',
      mimeType: PDF_MIME_TYPE,
      sha256: hashBuffer(file.buffer),
      sizeBytes: file.buffer.length,
      originalFileName: file.originalname.trim() || 'epod.pdf',
    };
  }

  const sniffed = sniffImageType(file.buffer);
  if (!sniffed) {
    throw new ApiError(400, 'Chỉ hỗ trợ ảnh hoặc PDF cho e-POD.');
  }

  try {
    const buffer = await sharp(file.buffer)
      .rotate()
      .resize(MAX_POD_IMAGE_DIMENSION, MAX_POD_IMAGE_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    return {
      buffer,
      extension: 'jpg',
      mimeType: 'image/jpeg',
      sha256: hashBuffer(buffer),
      sizeBytes: buffer.length,
      originalFileName: file.originalname.trim() || 'epod.jpg',
    };
  } catch {
    throw new ApiError(400, 'Không thể xử lý tệp e-POD đã tải lên.');
  }
}

function buildPodStorageKey(args: {
  tripId: number;
  submissionId: number;
  fileType: TripPodFileType;
  extension: 'jpg' | 'pdf';
  idempotencyKey: string;
}): string {
  const base = `trip-pod/${args.tripId}/submission-${args.submissionId}`;
  if (args.fileType === TripPodFileType.TOLL_TICKET) {
    const suffix = createHash('sha256').update(args.idempotencyKey).digest('hex').slice(0, 16);
    return `${base}/toll-ticket-${suffix}.${args.extension}`;
  }
  return `${base}/${args.fileType.toLowerCase()}.${args.extension}`;
}

export async function loadOwnedFulfillmentTrip(
  executor: Tx | typeof db,
  fulfillmentId: number,
  driverId: number,
  options: { forUpdate?: boolean } = {},
): Promise<OwnedFulfillmentTrip> {
  const query = executor.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    tripVersion: s.trips.version,
    fulfillmentId: s.shipmentFulfillments.id,
    shipmentId: s.shipmentFulfillments.shipmentId,
    driverId: s.trips.driverId,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.trips, and(
      eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
      isNull(s.trips.deletedAt),
    ))
    .where(and(
      eq(s.shipmentFulfillments.id, fulfillmentId),
      eq(s.trips.driverId, driverId),
    ))
    .limit(1);

  const rows = options.forUpdate ? await query.for('update') : await query;
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy tác vụ được giao.');
  }
  return {
    ...row,
    driverId: row.driverId ?? driverId,
  };
}

async function listOrderedMilestoneTypesTx(
  executor: Tx | typeof db,
  tripId: number,
): Promise<DriverProgressEventType[]> {
  const rows = await executor.select({
    eventType: s.driverProgressEvents.eventType,
    occurredAt: s.driverProgressEvents.occurredAt,
    id: s.driverProgressEvents.id,
  }).from(s.driverProgressEvents)
    .where(and(
      eq(s.driverProgressEvents.tripId, tripId),
      inArray(s.driverProgressEvents.eventType, [...DRIVER_FULFILLMENT_PROGRESS_SEQUENCE]),
    ))
    .orderBy(asc(s.driverProgressEvents.occurredAt), asc(s.driverProgressEvents.id));

  return rows.map((row) => row.eventType as DriverProgressEventType);
}

export async function getDriverCompletionEvidenceStatus(
  tripId: number,
  executor: Tx | typeof db = db,
): Promise<DriverCompletionEvidenceStatus> {
  const milestoneTypes = await listOrderedMilestoneTypesTx(executor, tripId);
  const seen = new Set(milestoneTypes);
  const hasDeliveredMilestone = DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.every((eventType) => seen.has(eventType));

  const [latestSubmission] = await executor.select({
    id: s.tripPodSubmissions.id,
    status: s.tripPodSubmissions.status,
  }).from(s.tripPodSubmissions)
    .where(eq(s.tripPodSubmissions.tripId, tripId))
    .orderBy(desc(s.tripPodSubmissions.submissionVersion))
    .limit(1);

  const requiredFiles = latestSubmission
    ? await executor.select({
      fileType: s.tripPodFiles.fileType,
    }).from(s.tripPodFiles)
      .where(and(
        eq(s.tripPodFiles.submissionId, latestSubmission.id),
        inArray(s.tripPodFiles.fileType, [...TRIP_POD_REQUIRED_FILE_TYPES]),
      ))
    : [];
  const requiredFileTypes = new Set(requiredFiles.map((row) => row.fileType as TripPodFileType));
  const hasRequiredPodFiles = TRIP_POD_REQUIRED_FILE_TYPES.every((fileType) => requiredFileTypes.has(fileType));
  const latestStatus = latestSubmission?.status as TripPodStatus | undefined;
  const hasSubmittedPod = latestStatus === TripPodStatus.SUBMITTED || latestStatus === TripPodStatus.ACCEPTED;

  const missing: string[] = [];
  if (!seen.has(DriverProgressEventType.PICKED_UP)) {
    missing.push(DRIVER_PROGRESS_EVENT_LABELS[DriverProgressEventType.PICKED_UP]);
  }
  if (!seen.has(DriverProgressEventType.LOADING_OR_RETURNING)) {
    missing.push(DRIVER_PROGRESS_EVENT_LABELS[DriverProgressEventType.LOADING_OR_RETURNING]);
  }
  if (!seen.has(DriverProgressEventType.DELIVERED)) {
    missing.push(DRIVER_PROGRESS_EVENT_LABELS[DriverProgressEventType.DELIVERED]);
  }
  if (!latestSubmission) {
    missing.push(fileTypeLabel(TripPodFileType.YARD_OR_DROP_RECEIPT));
    missing.push(fileTypeLabel(TripPodFileType.SIGNED_DELIVERY_NOTE));
    missing.push('e-POD đã gửi');
  } else {
    for (const fileType of TRIP_POD_REQUIRED_FILE_TYPES) {
      if (!requiredFileTypes.has(fileType)) {
        missing.push(fileTypeLabel(fileType));
      }
    }
    if (!hasSubmittedPod) {
      missing.push('e-POD đã gửi');
    }
  }

  return {
    ready: hasDeliveredMilestone && hasRequiredPodFiles && hasSubmittedPod,
    missing,
    hasDeliveredMilestone,
    hasSubmittedPod,
    hasRequiredPodFiles,
    latestSubmissionId: latestSubmission?.id ?? null,
    latestSubmissionStatus: latestStatus ?? null,
  };
}

async function loadSubmissionTx(
  tx: Tx,
  args: {
    tripId: number;
    submissionId: number;
  },
) {
  const [submission] = await tx.select().from(s.tripPodSubmissions)
    .where(and(
      eq(s.tripPodSubmissions.id, args.submissionId),
      eq(s.tripPodSubmissions.tripId, args.tripId),
    ))
    .limit(1)
    .for('update');
  if (!submission) {
    throw new ApiError(404, 'Không tìm thấy phiên bản e-POD.');
  }
  return submission;
}

async function buildSubmissionViewTx(
  tx: Tx,
  args: { submissionId: number; fulfillmentId: number; shipmentId?: number | null },
): Promise<DriverPodSubmissionView> {
  const [submission] = await tx.select().from(s.tripPodSubmissions)
    .where(eq(s.tripPodSubmissions.id, args.submissionId))
    .limit(1);
  if (!submission) {
    throw new ApiError(404, 'Không tìm thấy phiên bản e-POD.');
  }
  const files = await tx.select().from(s.tripPodFiles)
    .where(eq(s.tripPodFiles.submissionId, submission.id))
    .orderBy(asc(s.tripPodFiles.createdAt), asc(s.tripPodFiles.id));
  const fileTypes = new Set(files.map((file) => file.fileType as TripPodFileType));
  const missingRequiredFileTypes = TRIP_POD_REQUIRED_FILE_TYPES
    .filter((fileType) => !fileTypes.has(fileType));

  return {
    id: submission.id,
    tripId: submission.tripId,
    fulfillmentId: submission.fulfillmentId,
    submissionVersion: submission.submissionVersion,
    status: submission.status as TripPodStatus,
    version: submission.version,
    createdAt: submission.createdAt.toISOString(),
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    submittedBy: submission.submittedBy ?? null,
    reviewedAt: submission.reviewedAt?.toISOString() ?? null,
    reviewedBy: submission.reviewedBy ?? null,
    rejectionReason: submission.rejectionReason ?? null,
    supersedesSubmissionId: submission.supersedesSubmissionId ?? null,
    sourceTripVersion: submission.sourceTripVersion,
    missingRequiredFileTypes,
    isReadyForReview: submission.status === TripPodStatus.SUBMITTED && missingRequiredFileTypes.length === 0,
    files: files.map((file) => ({
      id: file.id,
      fileType: file.fileType as TripPodFileType,
      label: fileTypeLabel(file.fileType as TripPodFileType),
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt.toISOString(),
      downloadUrl: args.shipmentId != null
        ? shipmentPodFileDownloadUrl(args.shipmentId, file.id)
        : podFileDownloadUrl(args.fulfillmentId, file.id),
    })),
  };
}

export async function listPodSubmissionsForDriver(
  driverId: number,
  fulfillmentId: number,
): Promise<DriverPodSubmissionView[]> {
  const ownedTrip = await loadOwnedFulfillmentTrip(db, fulfillmentId, driverId);
  return db.transaction(async (tx) => {
    const rows = await tx.select({
      id: s.tripPodSubmissions.id,
    }).from(s.tripPodSubmissions)
      .where(eq(s.tripPodSubmissions.tripId, ownedTrip.tripId))
      .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id));
    const items: DriverPodSubmissionView[] = [];
    for (const row of rows) {
      items.push(await buildSubmissionViewTx(tx, {
        submissionId: row.id,
        fulfillmentId,
        shipmentId: ownedTrip.shipmentId,
      }));
    }
    return items;
  });
}

export async function createPodSubmission(args: {
  driverId: number;
  actorUserId: number;
  fulfillmentId: number;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ submission: DriverPodSubmissionView; replayed: boolean }> {
  assertPositiveInteger(args.fulfillmentId, 'Tác vụ');
  assertPositiveInteger(args.expectedVersion, 'Phiên bản chuyến');

  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_CREATE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      driverId: args.driverId,
      actorUserId: args.actorUserId,
      fulfillmentId: args.fulfillmentId,
      expectedVersion: args.expectedVersion,
    },
    createdBy: args.actorUserId,
    entityType: 'trip_pod_submission',
    responseStatusCode: 201,
    create: async (tx) => {
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true });
      if (ownedTrip.tripVersion !== args.expectedVersion) {
        throw new ApiError(409, 'Chuyến đi đã thay đổi. Vui lòng tải lại tác vụ.');
      }

      const [latest] = await tx.select().from(s.tripPodSubmissions)
        .where(eq(s.tripPodSubmissions.tripId, ownedTrip.tripId))
        .orderBy(desc(s.tripPodSubmissions.submissionVersion))
        .limit(1)
        .for('update');

      if (latest?.status === TripPodStatus.DRAFT || latest?.status === TripPodStatus.SUBMITTED) {
        throw new ApiError(409, 'Đã có một e-POD đang mở cho tác vụ này.');
      }
      if (latest?.status === TripPodStatus.ACCEPTED) {
        throw new ApiError(409, 'e-POD đã được duyệt và không thể tạo phiên bản mới.');
      }
      if (latest && latest.status !== TripPodStatus.REJECTED) {
        throw new ApiError(409, 'Không thể tạo phiên bản e-POD mới cho tác vụ này.');
      }

      const [submission] = await tx.insert(s.tripPodSubmissions).values({
        tripId: ownedTrip.tripId,
        fulfillmentId: ownedTrip.fulfillmentId,
        submissionVersion: (latest?.submissionVersion ?? 0) + 1,
        sourceTripVersion: ownedTrip.tripVersion,
        supersedesSubmissionId: latest?.status === TripPodStatus.REJECTED ? latest.id : null,
      }).returning({ id: s.tripPodSubmissions.id });

      return buildSubmissionViewTx(tx, {
        submissionId: submission.id,
        fulfillmentId: ownedTrip.fulfillmentId,
      });
    },
    getEntityId: (value) => value.id,
  });

  return { submission: outcome.result, replayed: outcome.replayed };
}

export async function attachPodFile(args: {
  driverId: number;
  actorUserId: number;
  fulfillmentId: number;
  submissionId: number;
  expectedVersion: number;
  idempotencyKey: string;
  fileType: TripPodFileType;
  file: UploadFileLike;
}): Promise<{ submission: DriverPodSubmissionView; replayed: boolean }> {
  assertPositiveInteger(args.fulfillmentId, 'Tác vụ');
  assertPositiveInteger(args.submissionId, 'Phiên bản e-POD');
  assertPositiveInteger(args.expectedVersion, 'Phiên bản e-POD');

  const normalized = await normalizePodUpload(args.file);
  let uploadedStorageKey: string | null = null;

  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_FILE_ATTACH,
    idempotencyKey: args.idempotencyKey,
    payload: {
      driverId: args.driverId,
      actorUserId: args.actorUserId,
      fulfillmentId: args.fulfillmentId,
      submissionId: args.submissionId,
      expectedVersion: args.expectedVersion,
      fileType: args.fileType,
      sha256: normalized.sha256,
      sizeBytes: normalized.sizeBytes,
    },
    createdBy: args.actorUserId,
    entityType: 'trip_pod_submission',
    responseStatusCode: 200,
    create: async (tx) => {
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true });
      const submission = await loadSubmissionTx(tx, {
        tripId: ownedTrip.tripId,
        submissionId: args.submissionId,
      });
      if (submission.version !== args.expectedVersion) {
        throw new ApiError(409, 'Phiên bản e-POD đã thay đổi. Vui lòng tải lại.');
      }
      if (submission.status !== TripPodStatus.DRAFT) {
        throw new ApiError(409, 'Chỉ có thể cập nhật e-POD ở trạng thái nháp.');
      }

      const storageKey = buildPodStorageKey({
        tripId: ownedTrip.tripId,
        submissionId: submission.id,
        fileType: args.fileType,
        extension: normalized.extension,
        idempotencyKey: args.idempotencyKey,
      });
      uploadedStorageKey = storageKey;
      await storageService.upload(normalized.buffer, storageKey);

      const [existingRequiredSlot] = args.fileType === TripPodFileType.TOLL_TICKET
        ? []
        : await tx.select({ id: s.tripPodFiles.id }).from(s.tripPodFiles)
          .where(and(
            eq(s.tripPodFiles.submissionId, submission.id),
            eq(s.tripPodFiles.fileType, args.fileType),
          ))
          .limit(1)
          .for('update');

      if (existingRequiredSlot) {
        await tx.update(s.tripPodFiles).set({
          storageKey,
          originalFileName: normalized.originalFileName,
          mimeType: normalized.mimeType,
          sizeBytes: normalized.sizeBytes,
          sha256: normalized.sha256,
          uploadedBy: args.actorUserId,
          createdAt: new Date(),
        }).where(eq(s.tripPodFiles.id, existingRequiredSlot.id));
      } else {
        await tx.insert(s.tripPodFiles).values({
          submissionId: submission.id,
          fileType: args.fileType,
          storageKey,
          originalFileName: normalized.originalFileName,
          mimeType: normalized.mimeType,
          sizeBytes: normalized.sizeBytes,
          sha256: normalized.sha256,
          uploadedBy: args.actorUserId,
        });
      }

      const [updated] = await tx.update(s.tripPodSubmissions).set({
        version: sql`${s.tripPodSubmissions.version} + 1`,
        updatedAt: new Date(),
      }).where(eq(s.tripPodSubmissions.id, submission.id))
        .returning({ id: s.tripPodSubmissions.id });

      return buildSubmissionViewTx(tx, {
        submissionId: updated.id,
        fulfillmentId: ownedTrip.fulfillmentId,
      });
    },
    getEntityId: (value) => value.id,
    onTransactionRollback: async () => {
      if (uploadedStorageKey) {
        await storageService.delete(uploadedStorageKey).catch(() => undefined);
      }
    },
  });

  return { submission: outcome.result, replayed: outcome.replayed };
}

export async function submitPod(args: {
  driverId: number;
  actorUserId: number;
  fulfillmentId: number;
  submissionId: number;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ submission: DriverPodSubmissionView; replayed: boolean }> {
  assertPositiveInteger(args.fulfillmentId, 'Tác vụ');
  assertPositiveInteger(args.submissionId, 'Phiên bản e-POD');
  assertPositiveInteger(args.expectedVersion, 'Phiên bản e-POD');

  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_SUBMIT,
    idempotencyKey: args.idempotencyKey,
    payload: {
      driverId: args.driverId,
      actorUserId: args.actorUserId,
      fulfillmentId: args.fulfillmentId,
      submissionId: args.submissionId,
      expectedVersion: args.expectedVersion,
    },
    createdBy: args.actorUserId,
    entityType: 'trip_pod_submission',
    responseStatusCode: 200,
    create: async (tx) => {
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true });
      const submission = await loadSubmissionTx(tx, {
        tripId: ownedTrip.tripId,
        submissionId: args.submissionId,
      });
      if (submission.version !== args.expectedVersion) {
        throw new ApiError(409, 'Phiên bản e-POD đã thay đổi. Vui lòng tải lại.');
      }
      if (submission.status !== TripPodStatus.DRAFT) {
        throw new ApiError(409, 'e-POD này không còn ở trạng thái nháp.');
      }

      const files = await tx.select({
        fileType: s.tripPodFiles.fileType,
      }).from(s.tripPodFiles)
        .where(eq(s.tripPodFiles.submissionId, submission.id));
      const fileTypes = new Set(files.map((row) => row.fileType as TripPodFileType));
      const missingRequired = TRIP_POD_REQUIRED_FILE_TYPES
        .filter((fileType) => !fileTypes.has(fileType))
        .map((fileType) => fileTypeLabel(fileType));
      if (missingRequired.length > 0) {
        throw new ApiError(409, `e-POD chưa đủ hồ sơ bắt buộc: ${missingRequired.join(', ')}.`);
      }

      const [updated] = await tx.update(s.tripPodSubmissions).set({
        status: TripPodStatus.SUBMITTED,
        submittedBy: args.actorUserId,
        submittedAt: new Date(),
        version: sql`${s.tripPodSubmissions.version} + 1`,
        updatedAt: new Date(),
      }).where(eq(s.tripPodSubmissions.id, submission.id))
        .returning({ id: s.tripPodSubmissions.id });

      return buildSubmissionViewTx(tx, {
        submissionId: updated.id,
        fulfillmentId: ownedTrip.fulfillmentId,
      });
    },
    getEntityId: (value) => value.id,
  });

  return { submission: outcome.result, replayed: outcome.replayed };
}

export async function getDriverPodFileForDownload(args: {
  driverId: number;
  fulfillmentId: number;
  fileId: number;
}): Promise<{
  mimeType: string;
  originalFileName: string;
  buffer: Buffer;
}> {
  assertPositiveInteger(args.fulfillmentId, 'Tác vụ');
  assertPositiveInteger(args.fileId, 'Tệp e-POD');

  return db.transaction(async (tx) => {
    const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: false });
    const [fileRow] = await tx.select({
      id: s.tripPodFiles.id,
      storageKey: s.tripPodFiles.storageKey,
      mimeType: s.tripPodFiles.mimeType,
      originalFileName: s.tripPodFiles.originalFileName,
    }).from(s.tripPodFiles)
      .innerJoin(s.tripPodSubmissions, eq(s.tripPodSubmissions.id, s.tripPodFiles.submissionId))
      .where(and(
        eq(s.tripPodFiles.id, args.fileId),
        eq(s.tripPodSubmissions.tripId, ownedTrip.tripId),
      ))
      .limit(1);

    if (!fileRow) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }
    const buffer = await storageService.read(fileRow.storageKey);
    if (!buffer) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }

    return {
      mimeType: fileRow.mimeType,
      originalFileName: fileRow.originalFileName,
      buffer,
    };
  });
}

export async function listShipmentPodReviewItems(
  shipmentId: number,
): Promise<ShipmentPodReviewItemView[]> {
  assertPositiveInteger(shipmentId, 'Lô hàng');

  return db.transaction(async (tx) => {
    const fulfillments = await tx.select({
      fulfillment: s.shipmentFulfillments,
      containerNumber: s.shipmentContainers.containerNumber,
      tripId: s.trips.id,
      tripCode: s.trips.tripCode,
      tripStatus: s.trips.status,
      tripVersion: s.trips.version,
      driverName: s.drivers.name,
    }).from(s.shipmentFulfillments)
      .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        isNull(s.trips.deletedAt),
      ))
      .leftJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
      .where(eq(s.shipmentFulfillments.shipmentId, shipmentId))
      .orderBy(asc(s.shipmentFulfillments.id), desc(s.trips.createdAt), desc(s.trips.id));

    const latestTripByFulfillment = new Map<number, typeof fulfillments[number]>();
    for (const row of fulfillments) {
      if (!latestTripByFulfillment.has(row.fulfillment.id)) {
        latestTripByFulfillment.set(row.fulfillment.id, row);
      }
    }

    const fulfillmentRows = [...latestTripByFulfillment.values()];
    const replacementById = new Map(
      fulfillmentRows.map((row) => [row.fulfillment.id, row.fulfillment]),
    );
    const fulfillmentIds = fulfillmentRows.map((row) => row.fulfillment.id);
    const submissionRows = fulfillmentIds.length === 0
      ? []
      : await tx.select({
        id: s.tripPodSubmissions.id,
        fulfillmentId: s.tripPodSubmissions.fulfillmentId,
      }).from(s.tripPodSubmissions)
        .where(inArray(s.tripPodSubmissions.fulfillmentId, fulfillmentIds))
        .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id));

    const submissionIdsByFulfillment = new Map<number, number[]>();
    for (const row of submissionRows) {
      const existing = submissionIdsByFulfillment.get(row.fulfillmentId) ?? [];
      existing.push(row.id);
      submissionIdsByFulfillment.set(row.fulfillmentId, existing);
    }

    const items: ShipmentPodReviewItemView[] = [];
    for (const row of fulfillmentRows) {
      const submissionIds = submissionIdsByFulfillment.get(row.fulfillment.id) ?? [];
      const submissions: DriverPodSubmissionView[] = [];
      for (const submissionId of submissionIds) {
        submissions.push(await buildSubmissionViewTx(tx, {
          submissionId,
          fulfillmentId: row.fulfillment.id,
          shipmentId,
        }));
      }

      items.push({
        fulfillmentId: row.fulfillment.id,
        fulfillmentVersion: row.fulfillment.version,
        shipmentId: row.fulfillment.shipmentId,
        fulfillmentType: row.fulfillment.fulfillmentType,
        cargoMode: row.fulfillment.cargoMode,
        shipmentContainerId: row.fulfillment.shipmentContainerId,
        containerNumber: row.containerNumber ?? null,
        canceledAt: row.fulfillment.canceledAt?.toISOString() ?? null,
        cancellationDisposition: row.fulfillment.cancellationDisposition,
        replacementFulfillmentId: row.fulfillment.replacementFulfillmentId,
        notRequiredReason: row.fulfillment.notRequiredReason ?? null,
        required: isFulfillmentRequired(
          row.fulfillment,
          row.fulfillment.replacementFulfillmentId != null
            ? replacementById.get(row.fulfillment.replacementFulfillmentId) ?? null
            : null,
        ),
        tripId: row.tripId ?? null,
        tripCode: row.tripCode ?? null,
        tripStatus: row.tripStatus ?? null,
        tripVersion: row.tripVersion ?? null,
        driverName: row.driverName ?? null,
        currentSubmission: submissions[0] ?? null,
        history: submissions.slice(1),
      });
    }
    return items;
  });
}

export async function getShipmentPodFileForDownload(args: {
  shipmentId: number;
  fileId: number;
}): Promise<{
  mimeType: string;
  originalFileName: string;
  buffer: Buffer;
}> {
  assertPositiveInteger(args.shipmentId, 'Lô hàng');
  assertPositiveInteger(args.fileId, 'Tệp e-POD');

  return db.transaction(async (tx) => {
    const [fileRow] = await tx.select({
      storageKey: s.tripPodFiles.storageKey,
      mimeType: s.tripPodFiles.mimeType,
      originalFileName: s.tripPodFiles.originalFileName,
    }).from(s.tripPodFiles)
      .innerJoin(s.tripPodSubmissions, eq(s.tripPodSubmissions.id, s.tripPodFiles.submissionId))
      .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.tripPodSubmissions.fulfillmentId))
      .where(and(
        eq(s.tripPodFiles.id, args.fileId),
        eq(s.shipmentFulfillments.shipmentId, args.shipmentId),
      ))
      .limit(1);

    if (!fileRow) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }

    const buffer = await storageService.read(fileRow.storageKey);
    if (!buffer) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }

    return {
      mimeType: fileRow.mimeType,
      originalFileName: fileRow.originalFileName,
      buffer,
    };
  });
}

export {
  fileTypeLabel as tripPodFileTypeLabel,
  projectSiteSnapshot,
  listOrderedMilestoneTypesTx,
};
