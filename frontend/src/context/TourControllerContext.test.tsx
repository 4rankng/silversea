/**
 * Integration test for the TourControllerContext interaction-step contract (Phase 3).
 *
 * Verifies the end-to-end chain that the pure-layer tests couldn't:
 *   1. Starting a tour with an interaction step transitions to `waiting_for_action`.
 *   2. When the step's `completionEvent` fires on the bus, the tour advances.
 *   3. A non-interaction step transitions to `showing`.
 *
 * External deps are mocked so the test runs in jsdom without driver.js, network,
 * or localStorage side effects leaking across tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type React from 'react';

// ── Mocks (must be in place before importing the provider) ──────────────────
vi.mock('../lib/agentHighlight', () => ({
  setTourActive: vi.fn(),
}));
vi.mock('../api/onboardingClient', () => ({
  onboardingClient: {
    getProgress: vi.fn().mockResolvedValue([]),
    upsertProgress: vi.fn().mockResolvedValue({}),
    getTasks: vi.fn().mockResolvedValue([]),
    upsertTask: vi.fn().mockResolvedValue({}),
  },
}));

// Stub the catalog with ONE tour whose last step is an interaction step keyed
// on a product event the real bus carries. Defined INSIDE vi.hoisted so the
// vi.mock factory (which is hoisted to the top of the file) can reference it.
const { STUB_TOUR, DIRECTIVE_TOUR } = vi.hoisted(() => {
  const STUB_TOUR = {
    id: 'stub-tour',
    version: 1,
    title: 'Stub',
    summary: 's',
    description: 'd',
    category: 'operations' as const,
    estimatedMinutes: 1,
    roles: ['MANAGER'] as const,
    aliases: [] as readonly string[],
    steps: [
      { title: 'Step 0', body: 'explain' },
      { title: 'Step 1', body: 'do it', completionEvent: 'trip.created' as const },
    ],
  };
  // A tour whose first step has a scrollTo directive (so the step-drive effect
  // calls sendAndWait, which we can mock to return 'highlight-missed').
  const DIRECTIVE_TOUR = {
    id: 'directive-tour',
    version: 1,
    title: 'Directive',
    summary: 's',
    description: 'd',
    category: 'operations' as const,
    estimatedMinutes: 1,
    roles: ['MANAGER'] as const,
    aliases: [] as readonly string[],
    steps: [
      { title: 'Spotlight', body: 'find it', directive: { kind: 'scrollTo' as const, targetId: 'missing-target', durationMs: 1000 } },
      { title: 'Done', body: 'end' },
    ],
  };
  return { STUB_TOUR, DIRECTIVE_TOUR };
});

vi.mock('@tingting/shared', async (orig) => {
  const real = await orig<typeof import('@tingting/shared')>();
  return {
    ...real,
    TOUR_CATALOG: { 'stub-tour': STUB_TOUR, 'directive-tour': DIRECTIVE_TOUR },
    TOUR_IDS: ['stub-tour', 'directive-tour'] as unknown as typeof real.TOUR_IDS,
    toursForRole: (r: unknown) => (r === 'MANAGER' ? [STUB_TOUR, DIRECTIVE_TOUR] : []),
    getTour: (id: string) => (id === 'stub-tour' ? STUB_TOUR : id === 'directive-tour' ? DIRECTIVE_TOUR : undefined),
  };
});

import { TourControllerProvider, useTourController } from './TourControllerContext';
import { AgentDirectiveContext } from './AgentDirectiveContext';
import { onboardingEvents } from '../lib/onboardingEvents';
import { useAuth } from '../hooks/useAuth';

vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ user: { userId: 1, role: 'MANAGER' } })),
}));

// Mock the directive bridge (avoids needing react-router + Toast providers).
// Infer the context value type from the context itself (the interface isn't
// exported from the module; deriving it keeps the source unmodified).
type DirectiveCtx = typeof AgentDirectiveContext extends React.Context<infer V | null> ? V : never;
const stubDirectiveValue: DirectiveCtx = {
  send: vi.fn(() => ({ status: 'ok' as const })),
  sendAndWait: vi.fn(async () => ({ status: 'ok' as const })),
  register: vi.fn(),
  unregister: vi.fn(),
} as DirectiveCtx;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AgentDirectiveContext.Provider value={stubDirectiveValue}>
      <TourControllerProvider>{children}</TourControllerProvider>
    </AgentDirectiveContext.Provider>
  );
}

describe('TourControllerContext — interaction-step contract', () => {
  beforeEach(() => {
    onboardingEvents.clear();
    vi.clearAllMocks();
  });

  it('advances the tour when the completionEvent fires', async () => {
    const { result } = renderHook(() => useTourController(), { wrapper });

    // Start the tour at step 0.
    act(() => {
      result.current.start('stub-tour');
    });
    expect(result.current.tour).not.toBeNull();
    expect(result.current.currentStep).toBe(0);

    // Advance to step 1 (the interaction step). Step 0 has no directive, so the
    // step-drive effect sets status='showing'; calling next() moves to step 1.
    await waitFor(() => {
      expect(['showing', 'waiting_for_action']).toContain(result.current.status);
    });
    act(() => {
      result.current.next();
    });

    // Step 1 is the interaction step → status should become waiting_for_action
    // (the effect subscribes to onboardingEvents.waitFor('trip.created')).
    await waitFor(() => {
      expect(result.current.status).toBe('waiting_for_action');
    });
    expect(result.current.currentStep).toBe(1);

    // Fire the event the step is waiting for. The effect's waitFor resolves and
    // calls advance(1) → past the last step → tour completes.
    act(() => {
      onboardingEvents.emit('trip.created', { tripId: 99 });
    });

    await waitFor(() => {
      expect(result.current.tour).toBeNull();
      expect(result.current.status).toBe('completed');
    });
  });

  it('stays waiting if the event never fires (no force-advance)', async () => {
    const { result } = renderHook(() => useTourController(), { wrapper });
    act(() => {
      result.current.start('stub-tour');
    });
    await waitFor(() => expect(result.current.status).toBe('showing'));
    act(() => result.current.next());
    await waitFor(() => expect(result.current.status).toBe('waiting_for_action'));
    // Do NOT fire the event. After a beat, still waiting (manual fallback is the escape).
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.status).toBe('waiting_for_action');
    expect(result.current.tour).not.toBeNull();
  });

  it('manualAdvance escapes a waiting_for_action step', async () => {
    const { result } = renderHook(() => useTourController(), { wrapper });
    const completedTours: string[] = [];
    onboardingEvents.on('tour.completed', (payload) => {
      const tourId = (payload as { tourId?: string }).tourId;
      if (tourId) completedTours.push(tourId);
    });
    act(() => result.current.start('stub-tour'));
    await waitFor(() => expect(result.current.status).toBe('showing'));
    act(() => result.current.next());
    await waitFor(() => expect(result.current.status).toBe('waiting_for_action'));
    // Manual fallback → advance past last step → completed.
    act(() => result.current.manualAdvance());
    await waitFor(() => expect(result.current.status).toBe('completed'));
    expect(completedTours).toEqual(['stub-tour']);
  });

  it('records the triggerSource passed to start()', async () => {
    const { result } = renderHook(() => useTourController(), { wrapper });
    act(() => result.current.start('stub-tour', undefined, 'checklist'));
    await waitFor(() => expect(result.current.tour).not.toBeNull());
    expect(result.current.triggerSource).toBe('checklist');
  });

  it('shows target_missing when the step directive target never mounts', async () => {
    // directive-tour step 0 has a scrollTo directive. Mock the directive bridge
    // to report a highlight-miss (the target never appeared), which the engine
    // must translate into status='target_missing' (the recovery UX trigger).
    const sendAndWait = stubDirectiveValue.sendAndWait as ReturnType<typeof vi.fn>;
    sendAndWait.mockResolvedValueOnce({ status: 'ok', reason: 'highlight-missed' });

    const { result } = renderHook(() => useTourController(), { wrapper });
    act(() => result.current.start('directive-tour'));
    await waitFor(() => {
      expect(result.current.status).toBe('target_missing');
    });
    expect(result.current.highlightMissed).toBe(true);
    // retryTarget re-runs the drive effect; with a fresh mock that resolves ok,
    // it should leave target_missing.
    sendAndWait.mockResolvedValueOnce({ status: 'ok' });
    act(() => result.current.retryTarget());
    await waitFor(() => {
      expect(result.current.status).toBe('showing');
    });
  });

  it('refuses to start a tour when the admin master switch is off (onboardingEnabled === false)', async () => {
    // Default mock user has no onboardingEnabled (undefined → enabled). Flip it
    // off for this test only: the master switch must short-circuit start().
    const mocked = vi.mocked(useAuth);
    mocked.mockReturnValueOnce({ user: { userId: 1, role: 'MANAGER', onboardingEnabled: false } } as never);

    const { result } = renderHook(() => useTourController(), { wrapper });
    act(() => {
      result.current.start('stub-tour');
    });
    // No tour mounts, no status transition. (Give the microtask queue a beat.)
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.tour).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('starts a tour normally when the master switch is explicitly on', async () => {
    const mocked = vi.mocked(useAuth);
    mocked.mockReturnValueOnce({ user: { userId: 1, role: 'MANAGER', onboardingEnabled: true } } as never);

    const { result } = renderHook(() => useTourController(), { wrapper });
    act(() => {
      result.current.start('stub-tour');
    });
    await waitFor(() => expect(result.current.tour).not.toBeNull());
  });
});
