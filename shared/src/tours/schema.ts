import type { AgentTutorialStep } from '../schemas/agent';
import type { Role } from '../constants';

/**
 * Curated tour catalog — the "engine" data model.
 *
 * A {@link Tour} is a hand-authored, deterministic, role-scoped sequence of
 * steps that the agent (or the on-demand "Hướng dẫn nhanh" list) can launch.
 * The frontend `TourController` plays it step-by-step (Driver.js spotlight +
 * manual Next/Prev/Skip), reusing the existing directive bridge per step.
 *
 * `steps` reuse {@link AgentTutorialStep} — the SAME shape freeform LLM
 * `tutorial` responses emit — so curated tours and ad-hoc tutorials share one
 * step type (the locked "hybrid" authoring decision). Because `AgentTutorialStep`
 * types its `directive.routeKey` as the closed `AgentRouteKey` enum, a bogus
 * routeKey in a curated step fails `tsc` at compile time (no extra guard needed).
 *
 * Mirrors the `PAGE_CATALOG` single-source pattern: adding a tour = adding a
 * record to `catalog.ts`, never editing orchestrator logic (this is what retires
 * the old regex-hardcoded `buildScriptedTutorialResponse`).
 */
export interface Tour {
  /** Stable slug, e.g. 'create-trip'. Used in the `start_tour` response + localStorage. */
  id: string;
  /**
   * Author-bumped version. Bump when a tour's step sequence or step IDs change
   * in a breaking way (Phase 2 / Phase 4). Cosmetic text edits do NOT require a
   * bump. The progress table keys on `(user_id, tour_id, tour_version)` so a
   * bumped version starts a fresh progress row rather than corrupting an
   * in-flight one; the frontend surfaces a "nội dung đã đổi, bắt đầu lại?"
   * prompt when a resumed tour's version differs from the catalog.
   */
  version: number;
  title: string;
  summary: string;
  /** Vietnamese description for `tours.search` + the on-demand list. */
  description: string;
  /** Library grouping; this is presentation metadata, not a permission rule. */
  category: 'operations' | 'finance' | 'configuration' | 'administration';
  /** Short, honest estimate displayed by the tutorial library. */
  estimatedMinutes: number;
  /** Optional prerequisite/recovery guidance shown before a tour starts. */
  prerequisites?: readonly string[];
  /** Roles allowed to see/run this tour. */
  roles: readonly Role[];
  /** Extra keywords for `tours.search` recall (matched diacritic-insensitively). */
  aliases: readonly string[];
  /** 2–10 steps. Each step's optional `directive` (navigate/scrollTo/focus) is
   *  executed by the TourController via `sendAndWait`; a step with no directive
   *  is instructional text only (no spotlight, no navigation). */
  steps: readonly AgentTutorialStep[];
}
