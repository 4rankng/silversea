import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProgressEventType, TripPodStatus } from '@tingting/shared';

const { getMock, postMock, uploadMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: getMock, post: postMock, upload: uploadMock },
  fileCommandFingerprint: () => 'file-fingerprint',
}));

import { driverClient } from './driverClient';

describe('driverClient fulfillment contract', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    uploadMock.mockReset();
  });

  it('loads the fulfillment endpoint and maps its trip, site and POD envelope', async () => {
    getMock.mockResolvedValue({
      fulfillmentId: 88,
      shipmentId: 9,
      shipmentCode: 'SHP-9',
      bookingRef: 'BOOK-9',
      cargoMode: 'FCL',
      fulfillmentType: 'FCL_CONTAINER',
      tripId: 55,
      tripVersion: 3,
      factoryName: 'Nhà máy A',
      pickupLocation: 'Cảng A',
      deliveryLocation: 'Nhà máy A',
      contactName: 'Anh Minh',
      contactPhone: '0909000001',
      siteSnapshot: { deliverySite: { strictRules: 'Gọi trước khi vào kho' } },
      evidenceStatus: {
        ready: false,
        missing: ['Biên bản giao nhận'],
        hasDeliveredMilestone: true,
        hasSubmittedPod: false,
      },
      podSubmissions: [{
        id: 22,
        submissionVersion: 1,
        status: TripPodStatus.SUBMITTED,
        sourceTripVersion: 3,
        version: 2,
        submittedAt: '2026-08-01T01:00:00.000Z',
        submittedBy: 7,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        supersedesSubmissionId: null,
        files: [],
      }],
      trip: {
        id: 55,
        version: 3,
        tripCode: 'TRIP-55',
        status: 'IN_TRANSIT',
        departureDate: '2026-08-01',
        routeName: 'Cảng A — Nhà máy A',
        containers: [],
        legs: [],
      },
    });

    const result = await driverClient.getTaskDetail(88);

    expect(getMock).toHaveBeenCalledWith('/driver/me/fulfillments/88');
    expect(result.id).toBe(55);
    expect(result.fulfillment?.id).toBe(88);
    expect(result.fulfillment?.siteRules).toEqual(['Gọi trước khi vào kho']);
    expect(result.currentPod).toMatchObject({ id: 22, tripId: 55, fulfillmentId: 88 });
  });

  it('maps the wire-level tradeDirection onto the task detail (A6 IMPORT cross-check input)', async () => {
    // tradeDirection arrives at the response top level, NOT inside wire.trip —
    // the map spreads wire.trip, so it must be carried over explicitly or the
    // container card's IMPORT advisory silently never fires.
    getMock.mockResolvedValue({
      fulfillmentId: 89,
      shipmentId: 10,
      shipmentCode: 'SHP-10',
      cargoMode: 'FCL',
      tradeDirection: 'IMPORT',
      fulfillmentType: 'FCL_CONTAINER',
      tripId: 56,
      tripVersion: 1,
      factoryName: null,
      pickupLocation: null,
      deliveryLocation: null,
      contactName: null,
      contactPhone: null,
      driverNotes: null,
      siteSnapshot: {},
      invoiceInfo: null,
      containerSealPhotos: [],
      evidenceStatus: { ready: false, missing: [], hasDeliveredMilestone: false, hasSubmittedPod: false },
      podSubmissions: [],
      trip: {
        id: 56,
        version: 1,
        tripCode: 'TRIP-56',
        status: 'IN_TRANSIT',
        departureDate: '2026-08-30',
        routeName: null,
        containers: [],
        legs: [],
      },
    });

    const result = await driverClient.getTaskDetail(89);

    expect(result.tradeDirection).toBe('IMPORT');
  });

  it('writes progress and completion by fulfillment id', async () => {
    postMock.mockResolvedValue({});

    await driverClient.recordProgress(88, {
      eventType: DriverProgressEventType.PICKED_UP,
      occurredAt: '2026-08-01T01:00:00.000Z',
    }, 'progress-key');
    await driverClient.completeTrip(88, { expectedVersion: 3 }, 'complete-key');

    expect(postMock.mock.calls[0]?.[0]).toBe('/driver/me/fulfillments/88/progress');
    expect(postMock.mock.calls[1]?.[0]).toBe('/driver/me/fulfillments/88/complete');
  });
});
