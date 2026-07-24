/**
 * Typed product-event bus — the onboarding completion-signal substrate.
 *
 * A tiny framework-agnostic singleton (no React import) over a
 * `Map<eventName, Set<handler>>`. Curated tour steps with a `completionEvent`
 * (Phase 3) call `waitFor(name, { timeoutMs })` and advance when the user
 * performs the real action (e.g. `trip.created`). Role checklists (Phase 6)
 * subscribe the same way. Lifecycle analytics (Phase 5) records a separate set
 * of onboarding-lifecycle events.
 *
 * The event names + payload types come from `@tingting/shared`
 * (`PRODUCT_EVENTS` / `ProductEventPayloads`) so a typo fails `tsc` at every
 * call site. Adding an event is a deliberate edit to the shared catalog.
 *
 * Design (plan §1):
 *   - `emit` is synchronous; handlers run synchronously (cheap, predictable).
 *   - `waitFor` registers a one-shot listener, resolves with the payload (or
 *     `null` on timeout), and ALWAYS cleans up — no listener leak even if the
 *     caller navigates away.
 *   - `timeoutMs` of 0 means "never time out" — Phase 3's default tour policy
 *     is to wait indefinitely and rely on the manual-fallback button.
 */
import type {
  ProductEventName,
  PayloadOf,
} from '@tingting/shared';

type Handler = (payload: unknown) => void;

// Page-visit signals describe state that remains true for the current session.
// Unlike one-off mutations such as `trip.created`, they must reach a checklist
// subscriber that mounts just after the page itself.
const REPLAYABLE_PAGE_VIEW_EVENTS = new Set<ProductEventName>([
  'accounting.dashboard_viewed',
  'fleet.dashboard_viewed',
  'trips.list_viewed',
]);

class OnboardingEventBus {
  private readonly handlers = new Map<ProductEventName, Set<Handler>>();
  private readonly seenPageViewEvents = new Set<ProductEventName>();

  /** Emit an event. Synchronous — handlers run before this returns. */
  emit<E extends ProductEventName>(name: E, ...payload: PayloadOf<E> extends undefined ? [] : [payload: PayloadOf<E>]): void {
    if (REPLAYABLE_PAGE_VIEW_EVENTS.has(name)) this.seenPageViewEvents.add(name);
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;
    // Copy to a local array so a handler that calls off() mid-emit doesn't
    // mutate the set we're iterating (mirrors DOM addEventListener semantics).
    const snapshot = Array.from(set);
    const p = payload[0] as unknown;
    for (const h of snapshot) {
      try {
        h(p);
      } catch (err) {
        // A bad handler must never break the emitter (or other handlers).
        // Logged via console so it surfaces in dev without crashing a tour.
        console.error('[onboardingEvents] handler threw for', name, err);
      }
    }
  }

  /** Subscribe. Returns an unsubscribe function (mirrors DOM event APIs). */
  on<E extends ProductEventName>(name: E, handler: Handler): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
    // The route page can mount before the asynchronously loaded checklist has
    // subscribed. Replay only durable page-view signals; business mutations
    // must remain one-shot so a later tour cannot complete accidentally.
    if (REPLAYABLE_PAGE_VIEW_EVENTS.has(name) && this.seenPageViewEvents.has(name)) {
      handler(undefined);
    }
    return () => this.off(name, handler);
  }

  /** Unsubscribe a specific handler. */
  off(name: ProductEventName, handler: Handler): void {
    const set = this.handlers.get(name);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.handlers.delete(name);
  }

  /** Subscribe once and return a cancellable handle for tour-step teardown. */
  once(name: ProductEventName, handler: Handler): () => void {
    // `on` may synchronously replay a durable page-view event, so this cannot
    // be a const initialized from `on(...)` without creating a TDZ.
    let off: () => void = () => {};
    off = this.on(name, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /**
   * Resolve with the payload when the event fires, or `null` on timeout.
   * `timeoutMs <= 0` means wait forever (Phase 3 default — manual fallback
   * button is the user's escape). Always cleans up its temporary listener.
   */
  waitFor(name: ProductEventName, opts: { timeoutMs: number }): Promise<unknown | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: unknown | null) => {
        if (settled) return;
        settled = true;
        this.off(name, handler);
        clearTimeout(timer);
        resolve(value);
      };
      const handler: Handler = (payload) => finish(payload);
      this.on(name, handler);
      const timer =
        opts.timeoutMs > 0
          ? setTimeout(() => finish(null), opts.timeoutMs)
          : undefined;
    });
  }

  /** Test/diagnostic helper: are there any live listeners for `name`? */
  hasListeners(name: ProductEventName): boolean {
    return (this.handlers.get(name)?.size ?? 0) > 0;
  }

  /** Test-only: clear all handlers. Never call from production code. */
  clear(): void {
    this.handlers.clear();
    this.seenPageViewEvents.clear();
  }
}

/** Singleton bus. Imported by emitters, the tour controller, and checklists. */
export const onboardingEvents = new OnboardingEventBus();
