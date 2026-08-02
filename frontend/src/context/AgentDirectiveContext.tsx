// AgentDirectiveContext — the context + hook half of the bot → SPA bridge.
//
// This module exports NO React component on purpose. React Fast Refresh only
// hot-reloads a file cleanly when it exports nothing but components, so the
// AgentDirectiveProvider component lives in its own file (AgentDirectiveProvider.tsx)
// and the context object + useAgentDirectives hook live here. The provider
// imports `AgentDirectiveContext` from this module.
//
// Directive effects (implemented in the provider):
//   navigate / focus → react-router navigate (+ ?focus= for scroll/highlight)
//   open / prefill   → call a per-page handler registered via useAgentOpenable
import { createContext, useContext } from 'react';
import type { AgentDirective } from '@tingting/shared';

export type OpenHandler = (d: Extract<AgentDirective, { kind: 'open' | 'prefill' }>) => void;

/** Outcome of applying a directive — sent back as the ack for navigate/focus. */
export type DirectiveOutcome = { status: 'ok' | 'error' | 'timeout'; reason?: string };

interface AgentDirectiveContextValue {
  /** Apply a directive (called by useAgentChat + action chips). Returns the
   *  outcome so the caller can ack navigate/focus directives. */
  send: (d: AgentDirective) => DirectiveOutcome;
  /** Register a modal/form handler for the current page (used by useAgentOpenable). */
  register: (componentId: string, handler: OpenHandler) => void;
  unregister: (componentId: string) => void;
}

export const AgentDirectiveContext = createContext<AgentDirectiveContextValue | null>(null);

export function useAgentDirectives(): AgentDirectiveContextValue {
  const ctx = useContext(AgentDirectiveContext);
  if (!ctx) throw new Error('useAgentDirectives must be used within AgentDirectiveProvider');
  return ctx;
}
