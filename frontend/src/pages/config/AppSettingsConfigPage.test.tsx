import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveEmail: vi.fn(),
  confirm: vi.fn(),
  emailSettings: vi.fn(),
  appSettings: {
    data: { botEnabled: true, tutorialEnabled: true, gpsEnabled: false },
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
  useSaveAppSettings: () => mutationResult(),
  useEmailSettings: () => mocks.emailSettings(),
  useSaveEmailSettings: () => mutationResult(mocks.saveEmail),
}));

vi.mock('../../hooks/useLlmSettings', () => ({
  useLlmSettings: () => mocks.llmSettings,
  useSaveLlmSettings: () => mutationResult(),
}));

vi.mock('../../hooks/useGpsSettings', () => ({
  useGpsSettings: () => mocks.gpsSettings,
  useSaveGpsSettings: () => mutationResult(),
}));

import AppSettingsConfigPage from './AppSettingsConfigPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AppSettingsConfigPage />
    </MemoryRouter>,
  );
}

describe('AppSettingsConfigPage — Resend credential', () => {
  beforeEach(() => {
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
});
