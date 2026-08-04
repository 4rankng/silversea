import { aliasedTable, and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { extractPumpReading, type PumpReading, type PumpReadingOutcome } from './ocr.service';
import type { Tx } from './trip-shared';

export type FuelEvidenceReviewStatus = typeof s.fuelEvidenceReviewStatusEnum.enumValues[number];

export interface FuelEvidenceReviewView {
  id: number;
  tripId: number;
  tripCode: string | null;
  ownerDriverId: number;
  ownerUserId: number;
  ownerName: string | null;
  photoUrl: string;
  originalFileName: string | null;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  latitude: string | null;
  longitude: string | null;
  gpsAccuracy: string | null;
  gpsAltitude: string | null;
  gpsAt: string | null;
  geotagSource: string | null;
  geotagSampleCount: number | null;
  geotagBestAccuracy: string | null;
  geotagElapsedMs: number | null;
  ocrOutcome: PumpReadingOutcome;
  reviewStatus: FuelEvidenceReviewStatus;
  confidence: string | null;
  reviewRequired: boolean;
  litres: string | null;
  unitPrice: string | null;
  totalAmount: string | null;
  computedTotal: string | null;
  mismatch: boolean;
  anomalyCode: string | null;
  anomalyReason: string | null;
  ocrProvider: string | null;
  ocrModel: string | null;
  ocrError: string | null;
  reviewerId: number | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface FuelEvidenceReviewRow {
  id: number;
  tripId: number;
  tripCode: string | null;
  ownerDriverId: number;
  ownerUserId: number;
  ownerName: string | null;
  storageKey: string;
  originalFileName: string | null;
  mimeType: string;
  sizeBytes: number;
  capturedAt: Date;
  latitude: string | null;
  longitude: string | null;
  gpsAccuracy: string | null;
  gpsAltitude: string | null;
  gpsAt: Date | null;
  geotagSource: string | null;
  geotagSampleCount: number | null;
  geotagBestAccuracy: string | null;
  geotagElapsedMs: number | null;
  ocrOutcome: PumpReadingOutcome;
  reviewStatus: FuelEvidenceReviewStatus;
  confidence: string | null;
  reviewRequired: boolean;
  litres: string | null;
  unitPrice: string | null;
  totalAmount: string | null;
  computedTotal: string | null;
  mismatch: boolean;
  anomalyCode: string | null;
  anomalyReason: string | null;
  ocrProvider: string | null;
  ocrModel: string | null;
  ocrError: string | null;
  reviewerId: number | null;
  reviewerName: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PersistFuelEvidenceReviewArgs {
  tripId: number;
  ownerDriverId: number;
  ownerUserId: number;
  storageKey: string;
  storageHash: string;
  originalFileName?: string | null;
  mimeType: string;
  sizeBytes: number;
  capturedAt?: Date;
  latitude?: string | null;
  longitude?: string | null;
  gpsAccuracy?: string | null;
  gpsAltitude?: string | null;
  gpsAt?: Date | null;
  geotagSource?: string | null;
  geotagSampleCount?: number | null;
  geotagBestAccuracy?: string | null;
  geotagElapsedMs?: number | null;
  ocr: PumpReading;
  confidence?: string | null;
  createdBy: number;
}

export interface PersistFuelEvidenceReviewOutcome {
  review: FuelEvidenceReviewView;
  ownsStorageKey: boolean;
}

let extractFuelEvidencePumpReading = extractPumpReading;

export function setFuelEvidencePumpReadingHandlerForTest(
  handler: typeof extractPumpReading | null,
) {
  extractFuelEvidencePumpReading = handler ?? extractPumpReading;
}

export async function extractFuelEvidencePumpValues(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg',
): Promise<PumpReading> {
  return extractFuelEvidencePumpReading(imageBuffer, mimeType);
}

const ownerDriver = aliasedTable(s.drivers, 'fuel_review_owner_driver');
const ownerUser = aliasedTable(s.users, 'fuel_review_owner_user');
const reviewerUser = aliasedTable(s.users, 'fuel_review_reviewer_user');

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function photoUrl(storageKey: string): string {
  return `/api/photos/${encodeURIComponent(storageKey)}`;
}

function anomalyFor(reading: PumpReading): { code: string | null; reason: string | null } {
  if (reading.outcome !== 'ANOMALY') return { code: null, reason: null };
  if (reading.mismatch) {
    return {
      code: 'TOTAL_MISMATCH',
      reason: 'Tổng tiền trên ảnh không khớp với lít x đơn giá. Kế toán phải kiểm tra thủ công.',
    };
  }
  if (reading.litres == null || reading.unitPrice == null || reading.total == null) {
    return {
      code: 'PARTIAL_READING',
      reason: 'Ảnh bơm chưa đọc đủ ba giá trị lít, đơn giá, thành tiền.',
    };
  }
  return {
    code: 'UNSPECIFIED',
    reason: 'Ảnh bơm cần kế toán xác nhận thủ công.',
  };
}

function toView(row: FuelEvidenceReviewRow): FuelEvidenceReviewView {
  return {
    id: row.id,
    tripId: row.tripId,
    tripCode: row.tripCode,
    ownerDriverId: row.ownerDriverId,
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    photoUrl: photoUrl(row.storageKey),
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    capturedAt: row.capturedAt.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    gpsAccuracy: row.gpsAccuracy,
    gpsAltitude: row.gpsAltitude,
    gpsAt: toIso(row.gpsAt),
    geotagSource: row.geotagSource,
    geotagSampleCount: row.geotagSampleCount,
    geotagBestAccuracy: row.geotagBestAccuracy,
    geotagElapsedMs: row.geotagElapsedMs,
    ocrOutcome: row.ocrOutcome,
    reviewStatus: row.reviewStatus,
    confidence: row.confidence,
    reviewRequired: row.reviewRequired,
    litres: row.litres,
    unitPrice: row.unitPrice,
    totalAmount: row.totalAmount,
    computedTotal: row.computedTotal,
    mismatch: row.mismatch,
    anomalyCode: row.anomalyCode,
    anomalyReason: row.anomalyReason,
    ocrProvider: row.ocrProvider,
    ocrModel: row.ocrModel,
    ocrError: row.ocrError,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    reviewedAt: toIso(row.reviewedAt),
    reviewNote: row.reviewNote,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function reviewRowSelection() {
  return {
    id: s.fuelEvidenceReviews.id,
    tripId: s.fuelEvidenceReviews.tripId,
    tripCode: s.trips.tripCode,
    ownerDriverId: s.fuelEvidenceReviews.ownerDriverId,
    ownerUserId: s.fuelEvidenceReviews.ownerUserId,
    ownerName: ownerUser.fullName,
    storageKey: s.fuelEvidenceReviews.storageKey,
    originalFileName: s.fuelEvidenceReviews.originalFileName,
    mimeType: s.fuelEvidenceReviews.mimeType,
    sizeBytes: s.fuelEvidenceReviews.sizeBytes,
    capturedAt: s.fuelEvidenceReviews.capturedAt,
    latitude: s.fuelEvidenceReviews.latitude,
    longitude: s.fuelEvidenceReviews.longitude,
    gpsAccuracy: s.fuelEvidenceReviews.gpsAccuracy,
    gpsAltitude: s.fuelEvidenceReviews.gpsAltitude,
    gpsAt: s.fuelEvidenceReviews.gpsAt,
    geotagSource: s.fuelEvidenceReviews.geotagSource,
    geotagSampleCount: s.fuelEvidenceReviews.geotagSampleCount,
    geotagBestAccuracy: s.fuelEvidenceReviews.geotagBestAccuracy,
    geotagElapsedMs: s.fuelEvidenceReviews.geotagElapsedMs,
    ocrOutcome: s.fuelEvidenceReviews.ocrOutcome,
    reviewStatus: s.fuelEvidenceReviews.reviewStatus,
    confidence: s.fuelEvidenceReviews.confidence,
    reviewRequired: s.fuelEvidenceReviews.reviewRequired,
    litres: s.fuelEvidenceReviews.litres,
    unitPrice: s.fuelEvidenceReviews.unitPrice,
    totalAmount: s.fuelEvidenceReviews.totalAmount,
    computedTotal: s.fuelEvidenceReviews.computedTotal,
    mismatch: s.fuelEvidenceReviews.mismatch,
    anomalyCode: s.fuelEvidenceReviews.anomalyCode,
    anomalyReason: s.fuelEvidenceReviews.anomalyReason,
    ocrProvider: s.fuelEvidenceReviews.ocrProvider,
    ocrModel: s.fuelEvidenceReviews.ocrModel,
    ocrError: s.fuelEvidenceReviews.ocrError,
    reviewerId: s.fuelEvidenceReviews.reviewerId,
    reviewerName: reviewerUser.fullName,
    reviewedAt: s.fuelEvidenceReviews.reviewedAt,
    reviewNote: s.fuelEvidenceReviews.reviewNote,
    version: s.fuelEvidenceReviews.version,
    createdAt: s.fuelEvidenceReviews.createdAt,
    updatedAt: s.fuelEvidenceReviews.updatedAt,
  } satisfies Record<string, unknown>;
}

function reviewRowQuery(executor: typeof db | Tx = db) {
  return executor.select(reviewRowSelection())
    .from(s.fuelEvidenceReviews)
    .innerJoin(s.trips, eq(s.trips.id, s.fuelEvidenceReviews.tripId))
    .innerJoin(ownerDriver, eq(ownerDriver.id, s.fuelEvidenceReviews.ownerDriverId))
    .leftJoin(ownerUser, eq(ownerUser.id, ownerDriver.userId))
    .leftJoin(reviewerUser, eq(reviewerUser.id, s.fuelEvidenceReviews.reviewerId));
}

async function loadFuelEvidenceReviewRow(reviewId: number, executor: typeof db | Tx = db) {
  const [row] = await reviewRowQuery(executor)
    .where(eq(s.fuelEvidenceReviews.id, reviewId))
    .limit(1);
  return row ? toView(row as FuelEvidenceReviewRow) : null;
}

export async function listFuelEvidenceReviewsForTrip(tripId: number): Promise<FuelEvidenceReviewView[]> {
  const rows = await reviewRowQuery()
    .where(eq(s.fuelEvidenceReviews.tripId, tripId))
    .orderBy(desc(s.fuelEvidenceReviews.createdAt), desc(s.fuelEvidenceReviews.id));
  return rows.map((row) => toView(row as FuelEvidenceReviewRow));
}

export async function listFuelEvidenceReviewsForOffice(filters: {
  status?: FuelEvidenceReviewStatus;
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ items: FuelEvidenceReviewView[]; total: number; page: number; limit: number }> {
  const conditions: SQL<unknown>[] = [];
  if (filters.status) {
    conditions.push(eq(s.fuelEvidenceReviews.reviewStatus, filters.status));
  }
  if (filters.search?.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conditions.push(or(
      ilike(s.trips.tripCode, pattern),
      ilike(ownerUser.fullName, pattern),
    ) as SQL<unknown>);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const offset = (page - 1) * limit;

  const [rows, countRows] = await Promise.all([
    reviewRowQuery()
      .where(whereClause)
      .orderBy(
        desc(sql<number>`case when ${s.fuelEvidenceReviews.reviewStatus} = 'PENDING' then 1 else 0 end`),
        desc(s.fuelEvidenceReviews.createdAt),
        desc(s.fuelEvidenceReviews.id),
      )
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` })
      .from(s.fuelEvidenceReviews)
      .innerJoin(s.trips, eq(s.trips.id, s.fuelEvidenceReviews.tripId))
      .innerJoin(ownerDriver, eq(ownerDriver.id, s.fuelEvidenceReviews.ownerDriverId))
      .leftJoin(ownerUser, eq(ownerUser.id, ownerDriver.userId))
      .where(whereClause),
  ]);

  return {
    items: rows.map((row) => toView(row as FuelEvidenceReviewRow)),
    total: Number(countRows[0]?.total ?? 0),
    page,
    limit,
  };
}

export async function persistFuelEvidenceReviewForDriver(
  args: PersistFuelEvidenceReviewArgs,
  tx: Tx,
): Promise<PersistFuelEvidenceReviewOutcome> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${args.tripId})`);

  const [trip] = await tx.select({ id: s.trips.id, driverId: s.trips.driverId })
    .from(s.trips)
    .where(eq(s.trips.id, args.tripId))
    .limit(1)
    .for('update');
  if (!trip) {
    throw new ApiError(404, 'Không tìm thấy chuyến đi.');
  }
  if (trip.driverId !== args.ownerDriverId) {
    throw new ApiError(403, 'Bạn không được phân công chuyến đi này.');
  }

  const [driver] = await tx.select({
    id: s.drivers.id,
    userId: s.drivers.userId,
    status: s.drivers.status,
  }).from(s.drivers)
    .where(eq(s.drivers.id, args.ownerDriverId))
    .limit(1)
    .for('update');
  if (!driver || driver.userId !== args.ownerUserId || driver.status !== 'ACTIVE') {
    throw new ApiError(409, 'Tài xế của ảnh nhiên liệu không còn hợp lệ.');
  }

  const [existing] = await tx.select({ id: s.fuelEvidenceReviews.id })
    .from(s.fuelEvidenceReviews)
    .where(and(
      eq(s.fuelEvidenceReviews.tripId, args.tripId),
      eq(s.fuelEvidenceReviews.ownerDriverId, args.ownerDriverId),
      eq(s.fuelEvidenceReviews.storageHash, args.storageHash),
    ))
    .limit(1);
  if (existing) {
    const row = await loadFuelEvidenceReviewRow(existing.id, tx);
    if (!row) {
      throw new ApiError(404, 'Không tìm thấy ảnh nhiên liệu đã lưu.');
    }
    return { review: row, ownsStorageKey: false };
  }

  const anomaly = anomalyFor(args.ocr);
  const insertedRows = await tx.insert(s.fuelEvidenceReviews).values({
    tripId: args.tripId,
    ownerDriverId: args.ownerDriverId,
    ownerUserId: args.ownerUserId,
    storageKey: args.storageKey,
    storageHash: args.storageHash,
    originalFileName: args.originalFileName ?? null,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    capturedAt: args.capturedAt ?? new Date(),
    latitude: args.latitude ?? null,
    longitude: args.longitude ?? null,
    gpsAccuracy: args.gpsAccuracy ?? null,
    gpsAltitude: args.gpsAltitude ?? null,
    gpsAt: args.gpsAt ?? null,
    geotagSource: args.geotagSource ?? null,
    geotagSampleCount: args.geotagSampleCount ?? null,
    geotagBestAccuracy: args.geotagBestAccuracy ?? null,
    geotagElapsedMs: args.geotagElapsedMs ?? null,
    ocrOutcome: args.ocr.outcome,
    reviewStatus: 'PENDING',
    confidence: args.confidence ?? null,
    reviewRequired: true,
    litres: args.ocr.litres != null ? String(args.ocr.litres) : null,
    unitPrice: args.ocr.unitPrice != null ? String(Math.round(args.ocr.unitPrice)) : null,
    totalAmount: args.ocr.total != null ? String(Math.round(args.ocr.total)) : null,
    computedTotal: args.ocr.computedTotal != null ? String(Math.round(args.ocr.computedTotal)) : null,
    mismatch: args.ocr.mismatch,
    anomalyCode: anomaly.code,
    anomalyReason: anomaly.reason,
    ocrProvider: args.ocr.provider,
    ocrModel: args.ocr.model,
    ocrError: args.ocr.error,
    createdBy: args.createdBy,
  })
    .onConflictDoNothing({
      target: [
        s.fuelEvidenceReviews.tripId,
        s.fuelEvidenceReviews.ownerDriverId,
        s.fuelEvidenceReviews.storageHash,
      ],
    })
    .returning({ id: s.fuelEvidenceReviews.id });

  const insertedId = insertedRows[0]?.id;
  if (!insertedId) {
    const [raced] = await tx.select({ id: s.fuelEvidenceReviews.id })
      .from(s.fuelEvidenceReviews)
      .where(and(
        eq(s.fuelEvidenceReviews.tripId, args.tripId),
        eq(s.fuelEvidenceReviews.ownerDriverId, args.ownerDriverId),
        eq(s.fuelEvidenceReviews.storageHash, args.storageHash),
      ))
      .limit(1);
    if (!raced) {
      throw new ApiError(409, 'Ảnh nhiên liệu vừa được tài xế khác lưu lại. Vui lòng tải lại.');
    }
    const row = await loadFuelEvidenceReviewRow(raced.id, tx);
    if (!row) {
      throw new ApiError(404, 'Không tìm thấy ảnh nhiên liệu vừa được lưu.');
    }
    return { review: row, ownsStorageKey: false };
  }

  const row = await loadFuelEvidenceReviewRow(insertedId, tx);
  if (!row) {
    throw new ApiError(404, 'Không thể đọc lại ảnh nhiên liệu vừa lưu.');
  }
  return { review: row, ownsStorageKey: true };
}

type DecideFuelEvidenceReviewArgs = {
  reviewId: number;
  reviewerId: number;
  expectedVersion: number;
  decision: 'CONFIRMED' | 'REJECTED';
  reviewNote?: string | null;
};

async function decideFuelEvidenceReviewInTx(
  args: DecideFuelEvidenceReviewArgs,
  tx: Tx,
): Promise<FuelEvidenceReviewView> {
    const [current] = await tx.select({
      id: s.fuelEvidenceReviews.id,
      version: s.fuelEvidenceReviews.version,
      reviewStatus: s.fuelEvidenceReviews.reviewStatus,
    }).from(s.fuelEvidenceReviews)
      .where(eq(s.fuelEvidenceReviews.id, args.reviewId))
      .limit(1)
      .for('update');
    if (!current) {
      throw new ApiError(404, 'Không tìm thấy kết quả OCR nhiên liệu.');
    }
    if (current.version !== args.expectedVersion) {
      throw new ApiError(409, 'Kết quả OCR đã thay đổi. Vui lòng tải lại danh sách.');
    }
    if (current.reviewStatus !== 'PENDING') {
      throw new ApiError(409, 'Kết quả OCR này đã được xử lý.');
    }

    await tx.update(s.fuelEvidenceReviews)
      .set({
        reviewStatus: args.decision,
        reviewRequired: false,
        reviewerId: args.reviewerId,
        reviewedAt: new Date(),
        reviewNote: args.reviewNote?.trim() ? args.reviewNote.trim() : null,
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(eq(s.fuelEvidenceReviews.id, args.reviewId));

    const row = await loadFuelEvidenceReviewRow(args.reviewId, tx);
    if (!row) {
      throw new ApiError(404, 'Không tìm thấy kết quả OCR sau khi cập nhật.');
    }
    return row;
}

export async function decideFuelEvidenceReview(
  args: DecideFuelEvidenceReviewArgs,
  tx?: Tx,
): Promise<FuelEvidenceReviewView> {
  if (tx) return decideFuelEvidenceReviewInTx(args, tx);
  return db.transaction((client) => decideFuelEvidenceReviewInTx(args, client));
}
