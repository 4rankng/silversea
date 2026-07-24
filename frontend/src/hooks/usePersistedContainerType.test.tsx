import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePersistedContainerType } from './usePersistedContainerType';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('usePersistedContainerType', () => {
  it('clears the previous trip type while the next trip loads, then hydrates it', async () => {
    const tripOne = deferred<{ items: Array<{ containerTypeId: number }> }>();
    const tripTwo = deferred<{ items: Array<{ containerTypeId: number }> }>();
    const load = (tripId: number) => tripId === 1 ? tripOne.promise : tripTwo.promise;
    const { result, rerender } = renderHook(
      ({ tripId }) => {
        const [plannedType, setPlannedType] = useState('4');
        usePersistedContainerType({
          tripId,
          enabled: true,
          plannedContainerTypeId: plannedType,
          setPlannedContainerTypeId: setPlannedType,
          load,
        });
        return plannedType;
      },
      { initialProps: { tripId: 1 }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current).toBe(''));
    act(() => tripOne.resolve({ items: [{ containerTypeId: 4 }] }));
    await waitFor(() => expect(result.current).toBe('4'));

    rerender({ tripId: 2 });
    await waitFor(() => expect(result.current).toBe(''));
    act(() => tripTwo.resolve({ items: [{ containerTypeId: 1 }] }));
    await waitFor(() => expect(result.current).toBe('1'));
  });

  it('preserves a user selection made before the persisted response arrives', async () => {
    const response = deferred<{ items: Array<{ containerTypeId: number }> }>();
    const { result } = renderHook(
      () => {
        const [plannedType, setPlannedType] = useState('');
        usePersistedContainerType({
          tripId: 9,
          enabled: true,
          plannedContainerTypeId: plannedType,
          setPlannedContainerTypeId: setPlannedType,
          load: () => response.promise,
        });
        return { plannedType, setPlannedType };
      },
      { wrapper: createWrapper() },
    );

    act(() => result.current.setPlannedType('4'));
    act(() => response.resolve({ items: [{ containerTypeId: 1 }] }));
    await waitFor(() => expect(result.current.plannedType).toBe('4'));
  });

  it('refetches and replaces a stale type on a same-trip conflict reload', async () => {
    const refreshed = deferred<{ items: Array<{ containerTypeId: number }> }>();
    let calls = 0;
    const load = () => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ items: [{ containerTypeId: 4 }] })
        : refreshed.promise;
    };
    const { result, rerender } = renderHook(
      ({ refreshNonce }) => {
        const [plannedType, setPlannedType] = useState('');
        usePersistedContainerType({
          tripId: 7,
          enabled: true,
          plannedContainerTypeId: plannedType,
          setPlannedContainerTypeId: setPlannedType,
          refreshNonce,
          load,
        });
        return plannedType;
      },
      { initialProps: { refreshNonce: 0 }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current).toBe('4'));
    rerender({ refreshNonce: 1 });
    await waitFor(() => expect(result.current).toBe(''));
    act(() => refreshed.resolve({ items: [{ containerTypeId: 1 }] }));
    await waitFor(() => expect(result.current).toBe('1'));
    expect(calls).toBe(2);
  });
});
