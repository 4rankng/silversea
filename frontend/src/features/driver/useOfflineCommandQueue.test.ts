import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildOfflineCommandKey,
  createMemoryCommandQueue,
  useOfflineCommandQueue,
} from './useOfflineCommandQueue';

describe('useOfflineCommandQueue', () => {
  it('enforces the configured pending limit', () => {
    const queue = createMemoryCommandQueue();
    const { result } = renderHook(() => useOfflineCommandQueue({ queue, maxPending: 2 }));

    act(() => {
      result.current.enqueue({ id: 'a', endpoint: 'driver.task.milestone', method: 'POST', path: '/a', payload: { kind: 'milestone', tripId: 1 } });
      result.current.enqueue({ id: 'b', endpoint: 'driver.task.milestone', method: 'POST', path: '/b', payload: { kind: 'milestone', tripId: 1 } });
    });

    expect(() => {
      act(() => {
        result.current.enqueue({ id: 'c', endpoint: 'driver.task.complete', method: 'POST', path: '/c', payload: { kind: 'complete', tripId: 1 } });
      });
    }).toThrow(/đã đầy/i);
  });

  it('reuses the same idempotency key instead of duplicating the command', () => {
    const queue = createMemoryCommandQueue();
    const { result } = renderHook(() => useOfflineCommandQueue({ queue, maxPending: 4 }));
    const key = buildOfflineCommandKey('driver', 'trip', 9, 'delivered');

    act(() => {
      result.current.enqueue({ id: key, endpoint: 'driver.task.milestone', method: 'POST', path: '/progress', payload: { kind: 'milestone', tripId: 9, eventType: 'DELIVERED' } });
      result.current.enqueue({ id: key, endpoint: 'driver.task.milestone', method: 'POST', path: '/progress', payload: { kind: 'milestone', tripId: 9, eventType: 'DELIVERED', expectedVersion: 5 } });
    });

    expect(result.current.commands).toHaveLength(1);
    expect(result.current.commands[0]?.id).toBe(key);
    expect(result.current.commands[0]?.payload).toMatchObject({ expectedVersion: 5 });
  });

  it('surfaces failed commands for retry after a network drain failure', async () => {
    const queue = createMemoryCommandQueue();
    const { result } = renderHook(() => useOfflineCommandQueue({ queue, maxPending: 4 }));

    act(() => {
      result.current.enqueue({ id: 'retry', endpoint: 'driver.task.complete', method: 'POST', path: '/complete', payload: { kind: 'complete', tripId: 7, expectedVersion: 4 } });
    });

    await act(async () => {
      await result.current.drain(async () => ({ ok: false, kind: 'network', message: 'offline' }));
    });

    await waitFor(() => expect(result.current.failedCount).toBe(1));
    expect(result.current.commands[0]?.status).toBe('FAILED');
    expect(result.current.commands[0]?.lastError).toBe('offline');
  });

  it('namespaces persistent queues by authenticated session scope and switches safely between accounts', () => {
    const { result, rerender } = renderHook(
      ({ storageScope }) => useOfflineCommandQueue({ maxPending: 4, storageScope }),
      { initialProps: { storageScope: 'driver:11' } },
    );

    act(() => {
      result.current.enqueue({
        id: 'driver-11-command',
        endpoint: 'driver.task.milestone',
        method: 'POST',
        path: '/progress',
        payload: { kind: 'milestone', fulfillmentId: 101, eventType: 'DELIVERED' },
      });
    });
    expect(result.current.commands.map((command) => command.id)).toEqual(['driver-11-command']);

    rerender({ storageScope: 'driver:22' });
    expect(result.current.commands).toHaveLength(0);

    act(() => {
      result.current.enqueue({
        id: 'driver-22-command',
        endpoint: 'driver.task.complete',
        method: 'POST',
        path: '/complete',
        payload: { kind: 'complete', fulfillmentId: 202, expectedVersion: 5 },
      });
    });
    expect(result.current.commands.map((command) => command.id)).toEqual(['driver-22-command']);

    rerender({ storageScope: 'driver:11' });
    expect(result.current.commands.map((command) => command.id)).toEqual(['driver-11-command']);
  });
});
