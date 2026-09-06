import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FinancialReportingPolicyState,
  TruckFinancialProfileState,
} from '@tingting/shared';

const mocks = vi.hoisted(() => ({
  saveAppSettings: vi.fn(),
  requestFinancialPolicy: vi.fn(),
  requestTruckProfile: vi.fn(),
  saveOcrSettings: vi.fn(),
  saveEmail: vi.fn(),
  confirm: vi.fn(),
  emailSettings: vi.fn(),
  financialPolicy: {
    data: {
      status: 'UNCONFIGURED',
      currentVietnamMonthStart: '2026-08-01',
      publicVersion: null,
      currentPolicy: null,
      futurePolicies: [],
      history: [],
      pendingRequest: null,
    } as FinancialReportingPolicyState,
    isLoading: false,
    isError: false,
    error: null,
  },
  truckProfiles: {
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
    } as TruckFinancialProfileState,
    isLoading: false,
    isError: false,
    error: null,
  },
  appSettings: {
    data: {
      creditWarningThresholdDefault: 0.8,
      creditTierOneAmountCap: 1000000,
      salaryPayrollBusinessUnitId: null,
    },
    isLoading: false,
    isError: false,
    error: null,
  },
  ocrSettings: {
    data: {
      enabled: true,
      openrouterKeySet: true,
      openrouterKeyMasked: '••••••••ocr1',
    },
    isLoading: false,
    isError: false,
    error: null,
  },
}));

function queryResult(data: unknown) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
  };
}

function mutationResult(mutateAsync: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    error: null,
  };
}

vi.mock('../../components/UI', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Panel: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  useConfirm: () => ({ confirm: mocks.confirm, dialog: null }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => mocks.appSettings,
  useSaveAppSettings: () => mutationResult(mocks.saveAppSettings),
  useEmailSettings: () => mocks.emailSettings(),
  useSaveEmailSettings: () => mutationResult(mocks.saveEmail),
  useFinancialReportingPolicy: () => mocks.financialPolicy,
  useRequestFinancialReportingPolicy: () => mutationResult(mocks.requestFinancialPolicy),
  useTruckFinancialProfiles: () => mocks.truckProfiles,
  useRequestTruckFinancialProfile: () => mutationResult(mocks.requestTruckProfile),
}));

vi.mock('../../hooks/useOcrSettings', () => ({
  useOcrSettings: () => mocks.ocrSettings,
  useSaveOcrSettings: () => mutationResult(mocks.saveOcrSettings),
}));

vi.mock('../../api/userClient', () => ({
  userClient: {
    getBusinessUnits: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

import AppSettingsConfigPage from './AppSettingsConfigPage';

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

describe('AppSettingsConfigPage', () => {
  beforeEach(() => {
    mocks.financialPolicy.data = {
      status: 'UNCONFIGURED',
      currentVietnamMonthStart: '2026-08-01',
      publicVersion: null,
      currentPolicy: null,
      futurePolicies: [],
      history: [],
      pendingRequest: null,
    };
    mocks.truckProfiles.data = {
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
    };
    mocks.ocrSettings.data.enabled = true;
    mocks.ocrSettings.data.openrouterKeySet = true;
    mocks.saveAppSettings.mockReset().mockResolvedValue({
      creditWarningThresholdDefault: 0.75,
      creditTierOneAmountCap: 1500000,
      salaryPayrollBusinessUnitId: null,
    });
    mocks.requestFinancialPolicy.mockReset().mockResolvedValue({ status: 'PENDING_CHECK' });
    mocks.requestTruckProfile.mockReset().mockResolvedValue({ status: 'PENDING_CHECK' });
    mocks.saveOcrSettings.mockReset().mockResolvedValue(mocks.ocrSettings.data);
    mocks.saveEmail.mockReset().mockResolvedValue({
      resendKeySet: true,
      resendKeyMasked: '••••••••7890',
    });
    mocks.confirm.mockReset().mockResolvedValue(true);
    mocks.emailSettings.mockReset().mockReturnValue(queryResult({
      resendKeySet: false,
      resendKeyMasked: '',
    }));
  });

  it('saves a newly entered write-only key and clears the local field', async () => {
    renderPage();

    const input = document.getElementById('resend-api-key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: '  re_new_7890  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu API key' }));

    await waitFor(() => {
      expect(mocks.saveEmail).toHaveBeenCalledWith({ resendApiKey: 're_new_7890' });
      expect(input.value).toBe('');
    });
    expect(screen.getByRole('status').textContent).toContain('Đã lưu Resend API key');
  });

  it('shows only the masked status and clears through explicit confirmation', async () => {
    mocks.emailSettings.mockReturnValue(queryResult({
      resendKeySet: true,
      resendKeyMasked: '••••••••4321',
    }));
    renderPage();

    const input = document.getElementById('resend-api-key') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toContain('••••••••4321');
    expect(screen.queryByDisplayValue('re_stored_secret')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa API key' }));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
      expect(mocks.saveEmail).toHaveBeenCalledWith({ clearResendApiKey: true });
    });
    expect(screen.getByRole('status').textContent).toContain('Đã xóa Resend API key');
  });

  it('saves global credit warning defaults with the shared app-settings shape', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Ngưỡng cảnh báo công nợ mặc định (%)'), {
      target: { value: '75' },
    });
    fireEvent.change(screen.getByLabelText('Ngưỡng tiền duyệt cấp 1 (VND)'), {
      target: { value: '1500000' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu cài đặt' })[0]);

    await waitFor(() => {
      expect(mocks.saveAppSettings).toHaveBeenCalledWith({
          creditWarningThresholdDefault: 0.75,
        creditTierOneAmountCap: 1500000,
        salaryPayrollBusinessUnitId: null,
      });
    });
  });

  it('shows a pending-review message instead of implying the app settings were applied', async () => {
    mocks.saveAppSettings.mockResolvedValue({
      id: 901,
      status: 'PENDING_CHECK',
      actionKind: 'PRICE_CONFIG_CHANGE',
      version: 1,
    });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Lưu cài đặt' })[0]);

    await waitFor(() => {
      expect(mocks.saveAppSettings).toHaveBeenCalled();
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Đã gửi yêu cầu cập nhật cài đặt ứng dụng để kiểm tra và phê duyệt. Cấu hình hiện chưa thay đổi.',
    );
  });

  it('shows the unconfigured financial policy and truck states with explicit warnings', () => {
    renderPage();

    expect(screen.getByText('Chưa có chính sách được phê duyệt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo yêu cầu đầu tiên' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ tài chính xe' }));
    expect(screen.getByText('Xe này chưa có hồ sơ tài chính được phê duyệt')).toBeTruthy();
  });

  it('submits a governed financial policy request with nullable threshold', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Tháng hiệu lực'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo yêu cầu đầu tiên' }));

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled();
      expect(mocks.requestFinancialPolicy).toHaveBeenCalledWith({
        expectedPublicVersion: null,
        effectiveFrom: '2026-08-01',
        lowMarginThresholdPercent: null,
      });
    });
    expect(screen.getByRole('status').textContent).toContain('Đã gửi yêu cầu. Cấu hình hiện tại chưa thay đổi.');
  });

  it('renders approved and future truck financial profile history with full VND digits', () => {
    mocks.truckProfiles.data = {
      ...mocks.truckProfiles.data,
      status: 'CONFIGURED',
      publicVersion: '2026-08-03T12:00:00.000Z',
      currentProfile: {
        id: 11,
        version: 11,
        truckId: 7,
        truckLabel: '51H-001.23',
        effectiveFrom: '2026-08-01',
        acquisitionCost: '1250000000',
        residualValue: '150000000',
        inServiceDate: '2024-03-15',
        usefulLifeMonths: 84,
        monthlyFixedCost: '24000000',
        createdByName: 'Quản trị',
        createdAt: '2026-08-03T12:00:00.000Z',
        source: 'APPROVED_GOVERNANCE',
      },
      futureProfiles: [],
      history: [
        {
          id: 11,
          version: 11,
          truckId: 7,
          truckLabel: '51H-001.23',
          effectiveFrom: '2026-08-01',
          acquisitionCost: '1250000000',
          residualValue: '150000000',
          inServiceDate: '2024-03-15',
          usefulLifeMonths: 84,
          monthlyFixedCost: '24000000',
          createdByName: 'Quản trị',
          createdAt: '2026-08-03T12:00:00.000Z',
          source: 'APPROVED_GOVERNANCE',
        },
      ],
      pendingRequest: null,
    };

    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ tài chính xe' }));
    expect(screen.getAllByText('1.250.000.000 VND').length).toBeGreaterThan(0);
    expect(screen.getAllByText('24.000.000 VND').length).toBeGreaterThan(0);
  });

  it('saves the OCR toggle and replacement key through the independent OCR contract', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('switch', { name: /Sử dụng OCR/ }));
    fireEvent.change(screen.getByLabelText(/OpenRouter API key cho OCR/, { selector: 'input' }), {
      target: { value: '  or-ocr-new  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt OCR' }));

    await waitFor(() => {
      expect(mocks.saveOcrSettings).toHaveBeenCalledWith({
        enabled: false,
        openrouterApiKey: 'or-ocr-new',
      });
    });
    expect(screen.getByRole('status').textContent).toContain('Đã lưu cài đặt nhận dạng OCR');
  });

  it('does not allow OCR to be enabled until the OpenRouter key is available', () => {
    mocks.ocrSettings.data.enabled = false;
    mocks.ocrSettings.data.openrouterKeySet = false;
    renderPage();

    fireEvent.click(screen.getByRole('switch', { name: /Sử dụng OCR/ }));
    expect((screen.getByRole('button', { name: 'Lưu cài đặt OCR' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
