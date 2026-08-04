import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({
  api: {
    get: getMock,
    post: vi.fn(),
  },
}));

import {
  getDispatchFleet,
  listDispatchFleetResources,
  listDispatchHandoffs,
  listDispatchQueue,
} from './dispatchPlanningClient';

describe('dispatch planning flat cursor contracts', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({ items: [], total: 0, limit: 25, nextCursor: null });
  });

  it('sends cursor pagination fields directly for queue and handoffs', async () => {
    await listDispatchQueue({ cursor: 'queue-cursor', limit: 25, status: ['READY'] });
    await listDispatchHandoffs({ cursor: 'handoff-cursor', limit: 25, urgency: 'URGENT' });

    expect(getMock.mock.calls[0]?.[0]).toBe('/shipments/dispatch-queue?cursor=queue-cursor&limit=25&status=READY');
    expect(getMock.mock.calls[1]?.[0]).toBe('/shipments/dispatch-handoffs?cursor=handoff-cursor&limit=25&urgency=URGENT');
  });

  it('keeps fleet resource, search, limit, and cursor in one server query', async () => {
    await listDispatchFleetResources('TRUCK', {
      q: '51D-12345',
      limit: 25,
      cursor: 'opaque-truck-cursor',
    });

    const [path] = getMock.mock.calls[0] as [string];
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.split('?')[0]).toBe('/shipments/dispatch-fleet');
    expect(Object.fromEntries(query)).toEqual({
      resource: 'TRUCK',
      q: '51D-12345',
      limit: '25',
      cursor: 'opaque-truck-cursor',
    });
  });

  it('passes carrier filters through unchanged for assigned external vehicle searches', async () => {
    await listDispatchFleetResources('EXTERNAL_VEHICLE', {
      q: '51C-99887',
      limit: 25,
      carrierId: 91,
    });

    const [path] = getMock.mock.calls[0] as [string];
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.split('?')[0]).toBe('/shipments/dispatch-fleet');
    expect(Object.fromEntries(query)).toEqual({
      resource: 'EXTERNAL_VEHICLE',
      q: '51C-99887',
      limit: '25',
      carrierId: '91',
    });
  });

  it('loads independent first pages for all three assignment resources', async () => {
    getMock
      .mockResolvedValueOnce({ items: [{ id: 1 }], total: 101, limit: 100, nextCursor: 'truck-next' })
      .mockResolvedValueOnce({ items: [{ id: 2 }], total: 90, limit: 100, nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 3 }], total: 5, limit: 100, nextCursor: null });

    const fleet = await getDispatchFleet({ limit: 100 });

    expect(getMock.mock.calls.map((call) => call[0])).toEqual([
      '/shipments/dispatch-fleet?resource=TRUCK&limit=100',
      '/shipments/dispatch-fleet?resource=DRIVER&limit=100',
      '/shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=100',
    ]);
    expect(fleet.trucks).toMatchObject({ total: 101, nextCursor: 'truck-next' });
  });
});
