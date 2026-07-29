import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyInfo } from '@tingting/shared';

const { companyInfoState, saveCompanyInfoMock } = vi.hoisted(() => ({
  companyInfoState: {
    data: undefined as CompanyInfo | undefined,
    isLoading: false,
  },
  saveCompanyInfoMock: vi.fn(),
}));

vi.mock('../../hooks/useCatalogQueries', () => ({
  useCompanyInfo: () => companyInfoState,
  useSaveCompanyInfo: () => ({
    mutateAsync: saveCompanyInfoMock,
  }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({
    rootRef: { current: null },
  }),
}));

import CompanyInfoConfigPage from './CompanyInfoConfigPage';

const validCompanyInfo: CompanyInfo = {
  name: 'Công ty TNHH TingTing Logistics',
  address: '1 Đường Vận Tải',
  taxCode: '0312345678',
  representative: 'Nguyễn Văn An',
  representativeTitle: 'Giám đốc',
  bankAccount: '0123456789',
  bankName: 'Vietcombank',
  phone: '',
  email: '',
  logoStorageKey: null,
  updatedAt: '2026-07-29T00:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CompanyInfoConfigPage />
    </MemoryRouter>,
  );
}

describe('CompanyInfoConfigPage save readiness', () => {
  beforeEach(() => {
    saveCompanyInfoMock.mockReset();
    companyInfoState.isLoading = false;
    companyInfoState.data = validCompanyInfo;
  });

  it('allows saving when required fields are complete and optional phone/email are blank', async () => {
    renderPage();

    const saveButton = await screen.findByRole<HTMLButtonElement>('button', { name: 'Lưu thông tin' });
    expect(saveButton.disabled).toBe(false);
  });

  it('keeps saving disabled while a schema-required company field is blank', async () => {
    companyInfoState.data = {
      ...validCompanyInfo,
      bankName: '   ',
    };
    renderPage();

    const saveButton = await screen.findByRole<HTMLButtonElement>('button', { name: 'Lưu thông tin' });
    expect(saveButton.disabled).toBe(true);
  });
});
