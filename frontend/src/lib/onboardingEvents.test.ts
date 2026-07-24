import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onboardingEvents } from './onboardingEvents';

/**
 * Event-bus contract tests. The bus is the completion-signal substrate for the
 * whole onboarding layer, so its invariants (no leak, no double-resolve, error
 * isolation) must hold regardless of which tour/checklist consumes it.
 */
describe('onboardingEvents', () => {
  beforeEach(() => {
    onboardingEvents.clear();
  });

  it('delivers a payload to an on() handler', () => {
    const seen: unknown[] = [];
    onboardingEvents.on('trip.created', (p) => seen.push(p));
    onboardingEvents.emit('trip.created', { tripId: 42 });
    expect(seen).toEqual([{ tripId: 42 }]);
  });

  it('delivers to multiple handlers in subscription order', () => {
    const order: string[] = [];
    onboardingEvents.on('trip.created', () => order.push('a'));
    onboardingEvents.on('trip.created', () => order.push('b'));
    onboardingEvents.emit('trip.created', { tripId: 1 });
    expect(order).toEqual(['a', 'b']);
  });

  it('the unsubscribe function stops further delivery', () => {
    const seen: unknown[] = [];
    const off = onboardingEvents.on('trip.created', (p) => seen.push(p));
    off();
    onboardingEvents.emit('trip.created', { tripId: 1 });
    expect(seen).toEqual([]);
    expect(onboardingEvents.hasListeners('trip.created')).toBe(false);
  });

  it('off() removes only the given handler', () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const hA = (p: unknown) => a.push(p);
    onboardingEvents.on('trip.created', hA);
    onboardingEvents.on('trip.created', (p) => b.push(p));
    onboardingEvents.off('trip.created', hA);
    onboardingEvents.emit('trip.created', { tripId: 7 });
    expect(a).toEqual([]);
    expect(b).toEqual([{ tripId: 7 }]);
  });

  it('emit with no listeners is a no-op (no throw)', () => {
    expect(() => onboardingEvents.emit('config.fuel_saved')).not.toThrow();
  });

  it('replays the latest page-view event to a listener that mounts later', () => {
    const seen: unknown[] = [];
    onboardingEvents.emit('fleet.dashboard_viewed');
    onboardingEvents.on('fleet.dashboard_viewed', (payload) => seen.push(payload));
    expect(seen).toEqual([undefined]);
  });

  it('a handler that throws does not break the emitter or other handlers', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok: unknown[] = [];
    onboardingEvents.on('trip.created', () => {
      throw new Error('boom');
    });
    onboardingEvents.on('trip.created', (p) => ok.push(p));
    onboardingEvents.emit('trip.created', { tripId: 3 });
    expect(ok).toEqual([{ tripId: 3 }]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('a handler can call off() on itself mid-emit without corrupting iteration', () => {
    const seen: unknown[] = [];
    let selfOff: () => void = () => {};
    selfOff = onboardingEvents.on('trip.created', (p) => {
      seen.push(p);
      selfOff();
    });
    onboardingEvents.on('trip.created', (p) => seen.push(p));
    onboardingEvents.emit('trip.created', { tripId: 5 });
    expect(seen).toEqual([{ tripId: 5 }, { tripId: 5 }]);
    // First handler removed itself; second remains.
    expect(onboardingEvents.hasListeners('trip.created')).toBe(true);
  });

  describe('waitFor', () => {
    it('resolves with the payload when the event fires in time', async () => {
      const promise = onboardingEvents.waitFor('trip.created', { timeoutMs: 1000 });
      // Fire synchronously after a microtask.
      setTimeout(() => onboardingEvents.emit('trip.created', { tripId: 99 }), 0);
      await expect(promise).resolves.toEqual({ tripId: 99 });
      // Listener must have been cleaned up.
      expect(onboardingEvents.hasListeners('trip.created')).toBe(false);
    });

    it('resolves with null on timeout and cleans up the listener', async () => {
      const promise = onboardingEvents.waitFor('trip.created', { timeoutMs: 20 });
      await expect(promise).resolves.toBeNull();
      expect(onboardingEvents.hasListeners('trip.created')).toBe(false);
    });

    it('does not resurrect after a timed-out waitFor if the event later fires', async () => {
      const resolved: unknown[] = [];
      onboardingEvents.waitFor('trip.created', { timeoutMs: 10 }).then((p) => resolved.push(p));
      await new Promise((r) => setTimeout(r, 30));
      // Timed out → null. Now fire the event; the dead waitFor must not see it.
      const live: unknown[] = [];
      onboardingEvents.on('trip.created', (p) => live.push(p));
      onboardingEvents.emit('trip.created', { tripId: 1 });
      expect(resolved).toEqual([null]);
      expect(live).toEqual([{ tripId: 1 }]); // only the live handler saw it
    });

    it('never times out when timeoutMs <= 0 (manual-fallback policy)', async () => {
      let resolved = false;
      onboardingEvents.waitFor('trip.locked', { timeoutMs: 0 }).then(() => {
        resolved = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(resolved).toBe(false);
      expect(onboardingEvents.hasListeners('trip.locked')).toBe(true);
      // Resolve it so the test doesn't leak.
      onboardingEvents.emit('trip.locked', { tripId: 1 });
      await new Promise((r) => setTimeout(r, 5));
      expect(resolved).toBe(true);
    });
  });
});
