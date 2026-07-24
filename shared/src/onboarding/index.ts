/**
 * Onboarding subsystem shared contract.
 *
 *   - Product-event catalog + payload types (consumed by the frontend event bus,
 *     tour completion steps, and role checklists).
 *
 * Tour definitions live under `../tours`; task/checklist definitions (Phase 6)
 * will be added here when that phase lands.
 */
export {
  PRODUCT_EVENTS,
  ONBOARDING_EVENT_NAMES,
} from './events';
export type {
  ProductEventName,
  ProductEventPayloads,
  PayloadOf,
  OnboardingEventName,
  TriggerSource,
} from './events';

export { ONBOARDING_TASKS, tasksForRole, getTask } from './tasks';
export type { OnboardingTask, TaskCompletion } from './tasks';
