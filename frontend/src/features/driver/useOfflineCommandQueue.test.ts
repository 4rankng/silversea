import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('persists replay authority and keeps FIFO within one fulfillment while other fulfillments proceed', async () => {
    const queue = createMemoryCommandQueue();
    queue.enqueue({ id: 'a1', endpoint: 'driver.task.milestone', method: 'POST', path: '/a1', fulfillmentScopeKey: 'fulfillment:1', expectedVersion: 4, actionKind: 'PICKED_UP', payload: { draft: 'kept' } });
    queue.enqueue({ id: 'a2', endpoint: 'driver.task.complete', method: 'POST', path: '/a2', fulfillmentScopeKey: 'fulfillment:1', expectedVersion: 5, actionKind: 'COMPLETE', payload: { draft: 'later' } });
    queue.enqueue({ id: 'b1', endpoint: 'driver.task.milestone', method: 'POST', path: '/b1', fulfillmentScopeKey: 'fulfillment:2', expectedVersion: 2, actionKind: 'PICKED_UP', payload: { draft: 'other' } });
    const sent: string[] = [];
    await queue.drain(async (command) => {
      sent.push(command.id);
      return command.id === 'a1' ? { ok: false, kind: 'network', message: 'offline' } : { ok: true };
    });
    expect(sent).toEqual(['a1', 'b1']);
    expect(queue.listAll().find((command) => command.id === 'a1')).toMatchObject({ expectedVersion: 4, actionKind: 'PICKED_UP', payload: { draft: 'kept' }, status: 'FAILED' });
    sent.length = 0;
    await queue.drain(async (command) => { sent.push(command.id); return { ok: true }; });
    expect(sent).toEqual(['a1', 'a2']);
  });

  it('keeps a conflict visible and blocks later commands in that fulfillment across drains', async () => {
    const queue = createMemoryCommandQueue();
    queue.enqueue({ id: 'conflict', endpoint: 'driver.task.milestone', method: 'POST', path: '/a1', fulfillmentScopeKey: 'fulfillment:1', expectedVersion: 4, actionKind: 'DELIVERED', payload: { draft: 'preserve me' } });
    queue.enqueue({ id: 'blocked', endpoint: 'driver.task.complete', method: 'POST', path: '/a2', fulfillmentScopeKey: 'fulfillment:1', expectedVersion: 5, actionKind: 'COMPLETE' });
    await queue.drain(async (command) => command.id === 'conflict' ? { ok: false, kind: 'conflict', message: 'version' } : { ok: true });
    const send = vi.fn(async () => ({ ok: true } as const));
    await queue.drain(send);
    expect(send).not.toHaveBeenCalled();
    expect(queue.listVisible()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'conflict', status: 'CONFLICT', payload: { draft: 'preserve me' } })]));
  });

  it('makes non-retryable server rejection terminal, preserves its draft, and reports each command outcome by id', async () => {
    const queue = createMemoryCommandQueue();
    queue.enqueue({ id: 'rejected', endpoint: 'driver.task.complete', method: 'POST', path: '/a1', fulfillmentScopeKey: 'fulfillment:1', payload: { draft: 'keep rejected payload' } });
    queue.enqueue({ id: 'later', endpoint: 'driver.task.complete', method: 'POST', path: '/a2', fulfillmentScopeKey: 'fulfillment:1', payload: { draft: 'later payload' } });
    queue.enqueue({ id: 'other', endpoint: 'driver.task.complete', method: 'POST', path: '/b1', fulfillmentScopeKey: 'fulfillment:2' });
    const sent: string[] = [];
    const result = await queue.drain(async (command) => {
      sent.push(command.id);
      return command.id === 'rejected' ? { ok: false, kind: 'rejected', message: 'forbidden' } : { ok: true };
    });
    expect(sent).toEqual(['rejected', 'other']);
    expect(result.statusById).toMatchObject({ rejected: 'REJECTED', later: 'QUEUED', other: 'DONE' });
    expect(result.messageById.rejected).toBe('forbidden');
    expect(queue.listAll().find((command) => command.id === 'rejected')).toMatchObject({ status: 'REJECTED', payload: { draft: 'keep rejected payload' } });
    const replay = vi.fn(async () => ({ ok: true } as const));
    await queue.drain(replay);
    expect(replay).not.toHaveBeenCalled();
  });
});
