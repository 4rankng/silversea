import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ id: '3' }), useNavigate: () => vi.fn() };
});

vi.mock('../hooks/useQueries', () => ({
  useTripDetail: vi.fn(),
}));
vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: null }),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'ADMIN', userId: 1 } }),
}));
vi.mock('../hooks/useTripForm', () => ({
  useTripForm: () => ({
    containerRows: [],
    setContainerRows: vi.fn(),
    setPlannedContainerTypeId: vi.fn(),
  }),
}));
vi.mock('../hooks/useTripFormPhotos', () => ({
  isAnyUploading: vi.fn(() => false),
}));
vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: undefined }),
}));
vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: vi.fn(),
}));
vi.mock('../hooks/useDirtyGuard', () => ({
  useDirtyGuard: () => ({ isDirty: false, confirmDiscard: vi.fn(async () => true) }),
}));
vi.mock('../hooks/useTripFormContext', () => ({
  TripFormProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/UI', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true), dialog: null }),
}));

// The loaded branch renders the full form; stub the section components so the
// sanity case exercises the page shell without the form internals.
vi.mock('../components/trip/TripEditConflictDialog', () => ({ TripEditConflictDialog: () => null }));
vi.mock('../components/trip/FuelSection', () => ({ FuelSection: () => null }));
vi.mock('../components/trip/AllowanceSection', () => ({ AllowanceSection: () => null }));
vi.mock('../components/trip/TotalsPanel', () => ({ TotalsPanel: () => null }));
vi.mock('../components/trip/PhotoUploader', () => ({ PhotoUploader: () => null }));
vi.mock('../components/trip/JourneyLegsCard', () => ({ JourneyLegsCard: () => null }));
vi.mock('../components/trip/CardSection', () => ({ CardSection: () => null }));
vi.mock('../components/trip/InputWithPrefix', () => ({ InputWithPrefix: () => null }));
vi.mock('../components/trip/ContainerInstancesCard', () => ({ ContainerInstancesCard: () => null }));
vi.mock('../components/trip/AncillaryFeesCard', () => ({ AncillaryFeesCard: () => null }));
vi.mock('../components/trip/TripInstructionsCard', () => ({ TripInstructionsCard: () => null }));

import { useTripDetail } from '../hooks/useQueries';
import TripEditPage from './TripEditPage';

const useTripDetailMock = vi.mocked(useTripDetail);

const TRIP = {
  id: 3,
  version: 3,
  status: 'CREATED',
} as never;

beforeEach(() => {
  useTripDetailMock.mockReset();
});

describe('TripEditPage — fetch-state rendering', () => {
  it('shows the loading label while the trip fetch is in flight', () => {
    useTripDetailMock.mockReturnValue({
      data: undefined, isLoading: true, error: null, refetch: vi.fn(),
    } as never);
    render(<TripEditPage />);
    expect(screen.getByText('Đang tải dữ liệu…')).toBeTruthy();
  });

  it('renders a recoverable error with retry instead of a silent blank page on fetch failure', () => {
    // Ticket 7a74d6eb: timeout/failure previously fell through to
    // `if (!trip) return null` — a silent blank page.
    useTripDetailMock.mockReturnValue({
      data: undefined, isLoading: false, error: new Error('request failed'), refetch: vi.fn(),
    } as never);
    const { container } = render(<TripEditPage />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được dữ liệu chuyến đi');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  });

  it('renders the page shell once the trip loads', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    render(<TripEditPage />);
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
  });
});
