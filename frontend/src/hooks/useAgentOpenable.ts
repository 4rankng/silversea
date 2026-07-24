// useAgentOpenable — a page calls this to let the agent open one of its
// modals/forms by componentId. ~3 lines of wiring per page:
//
//   useAgentOpenable('trips.new', useCallback((d) => {
//     setPrefill(d.kind === 'prefill' ? d.values : d.prefill);
//     setOpenNewTrip(true);
//   }, []));
//
// The provider replays any directive stashed before the page mounted, so
// "navigate to /trips/new then open the form pre-filled" works across the
// route change. Handlers should be stable (useCallback) to avoid re-register
// churn — the effect re-subscribes when the handler identity changes.
import { useEffect } from 'react';
import { useAgentDirectives } from '../context/AgentDirectiveContext';
import type { AgentDirective } from '@tingting/shared';

type OpenDirective = Extract<AgentDirective, { kind: 'open' | 'prefill' }>;

export function useAgentOpenable(componentId: string, handler: (d: OpenDirective) => void): void {
  const { register, unregister } = useAgentDirectives();
  useEffect(() => {
    register(componentId, handler);
    return () => unregister(componentId);
  }, [componentId, handler, register, unregister]);
}
