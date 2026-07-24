import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UseOnboardingChecklist } from '../../hooks/useOnboardingChecklist';
import { Role } from '@tingting/shared';

const { state } = vi.hoisted(() => ({
  state: {
    checklist: null as unknown as UseOnboardingChecklist,
    tour: null as unknown,
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'MANAGER', onboardingEnabled: true } }),
}));
vi.mock('../../hooks/useOnboardingChecklist', () => ({
  useOnboardingChecklist: () => state.checklist,
}));
vi.mock('../../context/TourControllerContext', () => ({
  useTourController: () => ({ tour: state.tour }),
}));

import { OnboardingChecklist } from './OnboardingChecklist';

const baseChecklist = (taskStatuses: Array<'pending' | 'completed' | 'dismissed'>): UseOnboardingChecklist => ({
  tasks: taskStatuses.map((taskStatus, index) => ({
      id: `manager-task-${index + 1}`,
      title: `Nhiệm vụ ${index + 1}`,
      role: Role.MANAGER,
      tourId: 'manager-dashboard-overview',
      completion: { type: 'tour' as const },
      sortOrder: index + 1,
      taskStatus,
    })),
  total: taskStatuses.length,
  completedCount: taskStatuses.filter((status) => status === 'completed').length,
  pct: Math.round((taskStatuses.filter((status) => status === 'completed').length / taskStatuses.length) * 100),
  loading: false,
  launchTour: vi.fn(),
  dismiss: vi.fn(),
});

describe('OnboardingChecklist dismissal recovery', () => {
  beforeEach(() => {
    state.tour = null;
    state.checklist = baseChecklist(['dismissed', 'pending']);
  });

  it('restores a persisted dismissal as a badge and keeps the panel open after progress changes', async () => {
    const view = render(<OnboardingChecklist />);

    const reopen = await screen.findByRole('button', { name: 'Mở hướng dẫn bắt đầu' });
    fireEvent.click(reopen);
    expect(screen.getByRole('dialog', { name: 'Bắt đầu sử dụng TransTing Logistics' })).not.toBeNull();

    state.checklist = baseChecklist(['dismissed', 'completed']);
    view.rerender(<OnboardingChecklist />);
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Bắt đầu sử dụng TransTing Logistics' })).not.toBeNull();
    });
  });
});
