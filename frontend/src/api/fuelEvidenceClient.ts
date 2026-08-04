import { api } from '../lib/api';

export type FuelEvidenceReviewStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface FuelEvidenceReviewRecord {
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
  ocrOutcome: 'ACCEPTED' | 'UNREADABLE' | 'MULTI_SCREEN' | 'NON_PUMP' | 'ANOMALY';
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

export const fuelEvidenceClient = {
  list: async (filters: { status?: FuelEvidenceReviewStatus; search?: string; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.search?.trim()) params.set('search', filters.search.trim());
    if (filters.page) params.set('page', String(filters.page));
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString();
    return api.get<{ items: FuelEvidenceReviewRecord[]; total: number; page: number; limit: number }>(`/ocr/fuel-evidence-reviews${query ? `?${query}` : ''}`);
  },

  decide: async (reviewId: number, body: {
    expectedVersion: number;
    decision: 'CONFIRMED' | 'REJECTED';
    reviewNote?: string | null;
  }) => {
    return api.post<FuelEvidenceReviewRecord>(`/ocr/fuel-evidence-reviews/${reviewId}/decision`, body);
  },
};
