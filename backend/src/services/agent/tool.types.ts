import { z, type ZodTypeAny } from 'zod';
import { Role } from '@tingting/shared';

/**
 * Agent tool-calling type system.
 *
 * An {@link AgentToolDef} is a typed, self-describing wrapper around one (or a
 * few) existing backend read service functions. The agent orchestrator
 * advertises each tool's name/description/params to MiniMax, executes the
 * tool the LLM selects, and feeds the structured `data` back.
 *
 * Design:
 *   - `params` (Zod) is the single validation gate — the tool parses its own
 *     args inside `execute`, so the orchestrator never needs to know each
 *     tool's shape (R-tool-breadth: one uniform call site for ~40 tools).
 *   - `allowedRoles` is re-checked inside `execute` (defense in depth) even
 *     though {@link getToolsForRole} already filtered the list per role (R6).
 *   - v1 tools are READ-ONLY — `execute` must never mutate state. The few
 *     "action" tools (`ui.*`) are navigation directives, not data writes.
 */

// The bot acts AS the calling user — it has no identity of its own. Every
// tool receives the user it is impersonating so it can scope its query and
// re-check role.
export interface AgentContext {
  userId: number;
  role: Role;
  username?: string;
  /** Current SPA route (sent by the drawer) — used by page-help tools. */
  currentRouteKey?: string;
}

export interface ToolResult {
  /**
   * Structured rows/object returned to the LLM. Must be JSON-serializable.
   * The LLM shapes this into an `insight_card`; it must NOT be a pre-formatted
   * string (the agent composes, it never parrots).
   */
  data: unknown;
  /** Short label for the "thinking" indicator (tool_result SSE `label`). */
  label?: string;
}

export interface AgentToolDef {
  name: string;
  /** One-line description the LLM reads to decide whether to call this tool. */
  description: string;
  params: ZodTypeAny;
  allowedRoles: readonly Role[];
  /**
   * P1.3 — `true` for pure read tools with no side effects and no ordering
   * dependency (data.* queries). The orchestrator runs all readonly tools in a
   * batch CONCURRENTLY. Undefined/`false` = side-effecting or ordered (ui.*
   * directives, which await a UI ack in sequence) → runs SERIALLY in call order.
   * Defaults to undefined so any tool not explicitly flagged stays serial (safe).
   */
  readonly?: boolean;
  execute: (args: unknown, ctx: AgentContext) => Promise<ToolResult>;
}

// ─── Errors ────────────────────────────────────────────────────────────────
// Thrown inside a tool; caught by the orchestrator and surfaced to the LLM as
// a tool_result(ok:false) so it can recover (re-pick a tool, narrow filters).

export class ToolError extends Error {
  constructor(
    message: string,
    /** 'invalid_args' | 'not_found' | 'forbidden' | 'internal' */
    readonly code: 'invalid_args' | 'not_found' | 'forbidden' | 'internal' = 'internal',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export class ToolForbiddenError extends ToolError {
  constructor(toolName: string) {
    super(`Vai trò của bạn không được dùng công cụ "${toolName}"`, 'forbidden');
    this.name = 'ToolForbiddenError';
  }
}

// ─── Helper: define a read tool in ~10 lines ───────────────────────────────
// Keeps the ~40-tool library uniform and cheap to grow. The helper parses
// args, re-checks role, runs the backing function, and wraps the result.
export function defineReadTool<A extends ZodTypeAny>(config: {
  name: string;
  description: string;
  allowedRoles: readonly Role[];
  params: A;
  run: (args: z.infer<A>, ctx: AgentContext) => Promise<unknown> | unknown;
  /** Optional short label derived from the parsed args. */
  label?: (args: z.infer<A>) => string;
}): AgentToolDef {
  const { name, description, allowedRoles, params, run, label } = config;
  return {
    name,
    description,
    allowedRoles,
    params,
    // defineReadTool backs every data.* query — pure reads, safe to parallelize.
    readonly: true,
    async execute(rawArgs, ctx) {
      // Defense in depth (R6): registry already filtered, but re-check here so
      // a misconfigured registry can never let a tool run for the wrong role.
      if (!allowedRoles.includes(ctx.role)) {
        throw new ToolForbiddenError(name);
      }
      const args = params.parse(rawArgs);
      const data = await run(args, ctx);
      return { data, label: label?.(args) };
    },
  };
}

// ─── Role constants ────────────────────────────────────────────────────────
// v1 audience = office staff only. DRIVER / FORWARDER get NO tools (their
// portal tool sets are Phase 2).
export const OFFICE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;
export type OfficeRole = (typeof OFFICE_ROLES)[number];
