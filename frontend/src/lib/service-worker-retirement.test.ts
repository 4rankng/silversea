import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('push-only service worker upgrade', () => {
  it('retires only owned caches and polling, preserves unrelated caches and push handlers', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const drop = vi.fn().mockResolvedValue(true);
    const unregister = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn().mockResolvedValue(undefined);
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      self: { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
        registration: { periodicSync: { unregister } }, clients: { claim } },
      caches: { keys: async () => ['tingting-shell-v2', 'tingting-shell-v3', 'unrelated-app'], delete: drop },
    });
    let activation: Promise<unknown> | undefined;
    handlers.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { activation = promise; } });
    await activation;
    expect(drop.mock.calls.map(([key]) => key)).toEqual(['tingting-shell-v2', 'tingting-shell-v3']);
    expect(unregister).toHaveBeenCalledWith('refresh-journey-board');
    expect(claim).toHaveBeenCalledOnce();
    expect(handlers.has('fetch')).toBe(false);
    expect(handlers.has('periodicsync')).toBe(false);
    expect(handlers.has('sync')).toBe(false);
    expect(handlers.has('push')).toBe(true);
    expect(handlers.has('notificationclick')).toBe(true);
  });
});
