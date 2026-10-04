import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AppSettings,
  FinancialReportingPolicyState,
  TruckFinancialProfileState,
  OcrSettingsResponse,
  EmailSettingsResponse,
} from '@tingting/shared';
import type { BusinessUnit } from '../../features/users/utils';
import type * as ConfigClientModule from '../../api/configClient';
import AppSettingsConfigPage from './AppSettingsConfigPage';

const mocks = vi.hoisted(() => ({
  refetchAppSettings: vi.fn(),
  refetchBusinessUnits: vi.fn(),
  refetchOcrSettings: vi.fn(),
  refetchEmailSettings: vi.fn(),
  refetchFinancialPolicy: vi.fn(),
  refetchTruckProfiles: vi.fn(),
  appSettingsState: {
    data: null as AppSettings | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  businessUnitsState: {
    data: { items: [] as BusinessUnit[] } as { items: BusinessUnit[] } | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  ocrSettingsState: {
    data: { enabled: true, openrouterKeySet: true, openrouterKeyMasked: '•••' } as OcrSettingsResponse | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  emailSettingsState: {
    data: { resendKeySet: false, resendKeyMasked: '' } as EmailSettingsResponse | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  financialPolicyState: {
    data: {
      status: 'UNCONFIGURED',
      currentVietnamMonthStart: '2026-08-01',
      publicVersion: null,
      currentPolicy: null,
      futurePolicies: [],
      history: [],
      pendingRequest: null,
    } as FinancialReportingPolicyState | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  truckProfilesState: {
    data: {
      selectedTruckId: 7,
      selectedTruckLabel: '51H-001.23',
      status: 'UNCONFIGURED',
      currentVietnamMonthStart: '2026-08-01',
      publicVersion: null,
      trucks: [{ id: 7, label: '51H-001.23', status: 'ACTIVE' }],
      currentProfile: null,
      futureProfiles: [],
      history: [],
      pendingRequest: null,
    } as TruckFinancialProfileState | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('../../components/UI', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Panel: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => mocks.appSettingsState,
  useSaveAppSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useEmailSettings: () => mocks.emailSettingsState,
  useSaveEmailSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useFinancialReportingPolicy: () => mocks.financialPolicyState,
  useRequestFinancialReportingPolicy: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useTruckFinancialProfiles: () => mocks.truckProfilesState,
  useRequestTruckFinancialProfile: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../hooks/useOcrSettings', () => ({
  useOcrSettings: () => mocks.ocrSettingsState,
  useSaveOcrSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../api/userClient', () => ({
  userClient: {
    getBusinessUnits: vi.fn(),
  },
}));

const pairSalaryMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/configClient', async (importOriginal) => {
  const original = await importOriginal<typeof ConfigClientModule>();
  return {
    ...original,
    configClient: { ...original.configClient, getPairSalarySettings: pairSalaryMock },
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      if (options?.queryKey?.[0] === 'app-settings' && options?.queryKey?.[1] === 'business-units') {
        return mocks.businessUnitsState;
      }
      return actual.useQuery(options as Parameters<typeof actual.useQuery>[0]);
    },
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppSettingsConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppSettingsConfigPage read failure error states (card 20261004_337 Group 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pairSalaryMock.mockReset().mockResolvedValue({ kepSurcharge: 0, ketHopSurcharge: 0 });
    mocks.appSettingsState.isError = false;
    mocks.appSettingsState.error = null;
    mocks.appSettingsState.refetch = mocks.refetchAppSettings;
    mocks.businessUnitsState.isError = false;
    mocks.businessUnitsState.error = null;
    mocks.businessUnitsState.refetch = mocks.refetchBusinessUnits;
    mocks.ocrSettingsState.isError = false;
    mocks.ocrSettingsState.error = null;
    mocks.ocrSettingsState.refetch = mocks.refetchOcrSettings;
    mocks.emailSettingsState.isError = false;
    mocks.emailSettingsState.error = null;
    mocks.emailSettingsState.refetch = mocks.refetchEmailSettings;
    mocks.financialPolicyState.isError = false;
    mocks.financialPolicyState.error = null;
    mocks.financialPolicyState.refetch = mocks.refetchFinancialPolicy;
    mocks.truckProfilesState.isError = false;
    mocks.truckProfilesState.error = null;
    mocks.truckProfilesState.refetch = mocks.refetchTruckProfiles;
  });

  it('renders an explicit Alert with retry button when appSettings feed fails', () => {
    mocks.appSettingsState.isError = true;
    mocks.appSettingsState.error = new Error('500 internal');
    renderPage();

    expect(screen.getByText('Không tải được cài đặt ứng dụng.')).toBeInTheDocument();
    const retryButtons = screen.getAllByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryButtons[0]!);
    expect(mocks.refetchAppSettings).toHaveBeenCalled();
  });

  it('renders an explicit Alert with retry button and disables payroll BU select when businessUnits query fails', () => {
    mocks.businessUnitsState.isError = true;
    mocks.businessUnitsState.error = new Error('Network error');
    renderPage();

    expect(screen.getByText('Không tải được danh sách đơn vị kinh doanh.')).toBeInTheDocument();
    const retryButtons = screen.getAllByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryButtons[0]!);
    expect(mocks.refetchBusinessUnits).toHaveBeenCalled();

    const buSelect = screen.getByRole('button', { name: /Phạm vi chốt kỳ lương/i });
    expect(buSelect).toBeDisabled();
  });

  it('renders an explicit Alert with retry button when ocrSettings query fails', () => {
    mocks.ocrSettingsState.isError = true;
    mocks.ocrSettingsState.error = new Error('OCR 503');
    renderPage();

    expect(screen.getByText('Không tải được cài đặt nhận dạng OCR.')).toBeInTheDocument();
    const retryButtons = screen.getAllByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryButtons[0]!);
    expect(mocks.refetchOcrSettings).toHaveBeenCalled();
  });

  it('renders an explicit Alert with retry button when emailSettings query fails', () => {
    mocks.emailSettingsState.isError = true;
    mocks.emailSettingsState.error = new Error('Email 500');
    renderPage();

    expect(screen.getByText('Không tải được cấu hình gửi email.')).toBeInTheDocument();
    const retryButtons = screen.getAllByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryButtons[0]!);
    expect(mocks.refetchEmailSettings).toHaveBeenCalled();
  });

  it('renders an explicit Alert with retry button when the pair-salary query fails', async () => {
    pairSalaryMock.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Không tải được cài đặt phụ phí ghép chuyến.', undefined, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(pairSalaryMock).toHaveBeenCalledTimes(2));
  });

  it('keeps the retry affordance in the financial-policy error block when the policy query fails', () => {
    mocks.financialPolicyState.error = new Error('boom');
    renderPage();
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mocks.refetchFinancialPolicy).toHaveBeenCalled();
  });

  it('keeps the retry affordance in the truck-profile error block when the truck query fails', () => {
    mocks.truckProfilesState.error = new Error('boom');
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ tài chính xe' }));
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mocks.refetchTruckProfiles).toHaveBeenCalled();
  });

  it('shows no read-error banner when every feed is healthy', () => {
    renderPage();
    expect(screen.queryByText(/Không tải được/)).toBeNull();
    expect(screen.queryByText(/Không thể tải/)).toBeNull();
  });
});
