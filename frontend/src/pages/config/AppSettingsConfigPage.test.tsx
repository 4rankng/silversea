import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveAppSettings: vi.fn(),
  saveLlmSettings: vi.fn(),
  saveOcrSettings: vi.fn(),
  saveEmail: vi.fn(),
  confirm: vi.fn(),
  emailSettings: vi.fn(),
  appSettings: {
    data: {
      botEnabled: true,
      gpsEnabled: false,
      creditWarningThresholdDefault: 0.8,
      creditTierOneAmountCap: 1000000,
      salaryPayrollBusinessUnitId: null,
    },
    isLoading: false,
    isError: false,
    error: null,
  },
  llmSettings: {
    data: {
      provider: 'minimax',
      minimaxKeySet: true,
      openrouterKeySet: false,
      minimaxKeyMasked: '••••••••1234',
      openrouterKeyMasked: '',
      models: {
        minimax: 'MiniMax-M2.7-highspeed',
        openrouter: 'deepseek/deepseek-v4-flash',
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  },
  ocrSettings: {
    data: {
      enabled: true,
      openrouterKeySet: true,
      geminiKeySet: false,
      openrouterKeyMasked: '••••••••ocr1',
      geminiKeyMasked: '',
    },
    isLoading: false,
    isError: false,
    error: null,
  },
  gpsSettings: {
    data: { username: '', passwordSet: false, passwordMasked: '' },
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
}));

vi.mock('../../hooks/useLlmSettings', () => ({
  useLlmSettings: () => mocks.llmSettings,
  useSaveLlmSettings: () => mutationResult(mocks.saveLlmSettings),
}));

vi.mock('../../hooks/useOcrSettings', () => ({
  useOcrSettings: () => mocks.ocrSettings,
  useSaveOcrSettings: () => mutationResult(mocks.saveOcrSettings),
}));

vi.mock('../../hooks/useGpsSettings', () => ({
  useGpsSettings: () => mocks.gpsSettings,
  useSaveGpsSettings: () => mutationResult(),
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
    mocks.saveAppSettings.mockReset().mockResolvedValue({
      botEnabled: true,
      gpsEnabled: false,
      creditWarningThresholdDefault: 0.75,
      creditTierOneAmountCap: 1500000,
      salaryPayrollBusinessUnitId: null,
    });
    mocks.saveLlmSettings.mockReset().mockResolvedValue(mocks.llmSettings.data);
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
        botEnabled: true,
        gpsEnabled: false,
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

  it('groups the chatbot toggle with its provider keys and keeps OCR independent', () => {
    renderPage();

    const chatbotSection = screen.getByRole('region', { name: 'Trợ lý ảo' });
    expect(chatbotSection.textContent).toContain('Sử dụng trợ lý ảo');
    expect(chatbotSection.textContent).toContain('MiniMax API key');
    expect(chatbotSection.textContent).toContain('OpenRouter API key');

    const policySection = screen.getByRole('region', { name: 'Chính sách vận hành' });
    expect(policySection.textContent).not.toContain('Sử dụng trợ lý ảo');

    const ocrSection = screen.getByRole('region', { name: 'Nhận dạng OCR' });
    expect(ocrSection.textContent).toContain('Sử dụng OCR');
    expect(ocrSection.textContent).toContain('OpenRouter API key cho OCR');
    expect(ocrSection.textContent).toContain('Gemini API key dự phòng');
    expect(ocrSection.textContent).toContain('không dùng chung với chatbot');
  });

  it('saves a chatbot toggle from the same section without rewriting stored keys', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('switch', { name: /Sử dụng trợ lý ảo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt trợ lý' }));

    await waitFor(() => {
      expect(mocks.saveAppSettings).toHaveBeenCalledWith({
        botEnabled: false,
        gpsEnabled: false,
        creditWarningThresholdDefault: 0.8,
        creditTierOneAmountCap: 1000000,
        salaryPayrollBusinessUnitId: null,
      });
    });
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
  });

  it('saves the OCR toggle and replacement key through the independent OCR contract', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('switch', { name: /Sử dụng OCR/ }));
    fireEvent.change(screen.getByLabelText('Gemini API key dự phòng'), {
      target: { value: '  gemini-ocr-new  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt OCR' }));

    await waitFor(() => {
      expect(mocks.saveOcrSettings).toHaveBeenCalledWith({
        enabled: false,
        geminiApiKey: 'gemini-ocr-new',
      });
    });
    expect(screen.getByRole('status').textContent).toContain('Đã lưu cài đặt nhận dạng OCR');
  });
});
