/**
 * Product-event catalog for the onboarding subsystem.
 *
 * This is the CLOSED set of business / UI events that the onboarding layer can
 * react to. A curated tour step (Phase 3) or a checklist item (Phase 6) waits
 * on one of these names via the frontend `onboardingEvents.waitFor(...)`. The
 * lifecycle-analytics layer (Phase 5) records a different, separate set of
 * `ONBOARDING_EVENT_NAMES` — do not confuse the two:
 *
 *   - `PRODUCT_EVENTS`  = things that happen in the app (the user did real work)
 *   - `ONBOARDING_EVENT_NAMES` (Phase 5) = onboarding-lifecycle telemetry
 *
 * Adding an event is a deliberate, PR-visible edit here. Typos are caught at
 * compile time because `ProductEventName` is a derived literal union and every
 * call site is typed against it.
 *
 * Decision (plan D2): completion is detected via this frontend bus, emitted at
 * existing API success call sites — not via backend verification or DOM polling.
 */

/**
 * The closed catalog of product events. Keep alphabetized within groups.
 *
 * Naming convention: `<domain>.<action>` in camelCase, lowercase domain.
 *   - `ui.*`     = a user gesture (click) — not yet a completed business action
 *   - `trip.*`   = trip-lifecycle mutations (created / locked / completed)
 *   - `receivable.*` = accounts-receivable mutations
 *   - `config.*` = catalog/config mutations
 *   - `tour.*`   = a curated guide reached its natural end
 *   - `<domain>.dashboard_viewed` = first paint of a role dashboard
 */
export const PRODUCT_EVENTS = [
  // UI gestures (user intent, not yet a completed action)
  'ui.trip_create_clicked',

  // Trip lifecycle
  'trip.created',
  'trip.locked',
  'trip.completed',
  'trip.dispatched',
  'trip.figures_saved',

  // Accounts receivable
  'receivable.payment_recorded',

  // Configuration
  'config.fuel_saved',

  // Curated guides
  'tour.completed',

  // Role-dashboard first paint (checklist "visit X" items)
  'accounting.dashboard_viewed',
  'fleet.dashboard_viewed',
  'trips.list_viewed',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

/**
 * Strongly-typed payload for events that carry one. Events not listed here
 * carry `undefined` (no payload). Indexed by `ProductEventName` so a typo in
 * the key fails `tsc`.
 */
export interface ProductEventPayloads {
  'trip.created': { tripId: number };
  'trip.locked': { tripId: number };
  'trip.completed': { tripId: number };
  'trip.dispatched': { tripId: number };
  'trip.figures_saved': { tripId: number };
  'receivable.payment_recorded': { customerId: number; amountVnd: number };
  'tour.completed': { tourId: string };
}

/** Resolve the payload type for a given event name (or `undefined`). */
export type PayloadOf<E extends ProductEventName> = E extends keyof ProductEventPayloads
  ? ProductEventPayloads[E]
  : undefined;

/**
 * Onboarding LIFECYCLE analytics event names (Phase 5). Distinct from
 * `PRODUCT_EVENTS` (which are real business actions the user takes). These are
 * the telemetry rows recorded into `onboarding_events` for start/step/complete/
 * abandon analysis. Kept as a closed set; the server filters on it.
 */
export const ONBOARDING_EVENT_NAMES = [
  'onboarding_tour_started',
  'onboarding_step_viewed',
  'onboarding_target_missing',
  'onboarding_action_completed',
  'onboarding_step_skipped',
  'onboarding_tour_completed',
  'onboarding_tour_abandoned',
] as const;

export type OnboardingEventName = (typeof ONBOARDING_EVENT_NAMES)[number];

/** Who/what started the tour — recorded for funnel analysis. */
export type TriggerSource = 'chatbot' | 'checklist' | 'manual';
