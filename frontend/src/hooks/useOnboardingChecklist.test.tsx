import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardingEvents } from '../lib/onboardingEvents';

const { getTasks, upsertTask } = vi.hoisted(() => ({
  getTasks: vi.fn(),
  upsertTask: vi.fn(),
}));

vi.mock('./useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'MANAGER' } }),
}));

vi.mock('../context/TourControllerContext', () => ({
  useTourController: () => ({ start: vi.fn() }),
}));

vi.mock('../api/onboardingClient', () => ({
  onboardingClient: { getTasks, upsertTask },
}));

import { useOnboardingChecklist } from './useOnboardingChecklist';

describe('useOnboardingChecklist', () => {
  beforeEach(() => {
    onboardingEvents.clear();
    getTasks.mockResolvedValue([]);
    upsertTask.mockResolvedValue({});
    vi.clearAllMocks();
  });

  it('does not complete an event-gated task merely by finishing its guide', async () => {
    const { result } = renderHook(() => useOnboardingChecklist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      onboardingEvents.emit('tour.completed', { tourId: 'create-trip' });
    });

    expect(result.current.tasks.find((task) => task.id === 'manager-create-first-trip')?.taskStatus).toBe('pending');
    expect(upsertTask).not.toHaveBeenCalled();

    act(() => {
      onboardingEvents.emit('trip.created', { tripId: 1 });
    });

    await waitFor(() => expect(result.current.completedCount).toBe(1));
    expect(upsertTask).toHaveBeenCalledWith({ taskId: 'manager-create-first-trip', status: 'completed' });
  });
});
