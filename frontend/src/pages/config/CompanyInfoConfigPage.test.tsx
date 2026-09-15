import { fireEvent, render, screen } from '@testing-library/react';
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
  shortName: 'TingTing Logistics',
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

  it('requires a short operational name separately from the full legal name', async () => {
    renderPage();

    expect(screen.getByLabelText('Tên đầy đủ')).toHaveValue('Công ty TNHH TingTing Logistics');
    const shortName = screen.getByLabelText('Tên ngắn');
    expect(shortName).toHaveValue('TingTing Logistics');

    fireEvent.change(shortName, { target: { value: '   ' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu thông tin' }).disabled).toBe(true);
  });

  it('refuses to save a malformed email (save gate disabled, no save call)', async () => {
    renderPage();
    const emailInput = await screen.findByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });

    const saveButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu thông tin' });
    // The shared companyInfoSchema email rule makes isCompanyInfoConfigured
    // false for a malformed value — Lưu disables and save never fires.
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    expect(saveCompanyInfoMock).not.toHaveBeenCalled();
  });

  it('allows saving when email is blank (optional)', async () => {
    renderPage();
    const emailInput = await screen.findByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: '' } });

    const saveButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu thông tin' });
    expect(saveButton.disabled).toBe(false);
  });

  it('allows saving when email is valid', async () => {
    renderPage();
    const emailInput = await screen.findByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'info@company.com' } });

    const saveButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu thông tin' });
    fireEvent.click(saveButton);

    expect(saveCompanyInfoMock).toHaveBeenCalled();
  });

  it('associates every company field with its visible Vietnamese label', async () => {
    // A11y contract: each control's accessible name comes from its visible
    // caption via label htmlFor + id — the pattern the two name fields
    // already used. A control losing its label breaks screen-reader
    // navigation and label-click focus, so all ten are pinned here.
    renderPage();
    await screen.findByLabelText('Tên đầy đủ');

    const expectations: Array<[string, string]> = [
      ['Tên đầy đủ', 'Công ty TNHH TingTing Logistics'],
      ['Tên ngắn', 'TingTing Logistics'],
      ['Mã số thuế', ''],
      ['Địa chỉ', ''],
      ['Đại diện bởi', ''],
      ['Chức vụ', ''],
      ['Số tài khoản', ''],
      ['Ngân hàng', ''],
      ['Điện thoại', ''],
      ['Email', ''],
    ];
    for (const [label] of expectations) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });
  it('keeps saved comparison collapsed and separate from an edited draft, after the save action', () => {
    const { container, rerender } = renderPage();
    fireEvent.change(screen.getByLabelText('Tên đầy đủ'), { target: { value: 'Tên đang chỉnh' } });
    const comparison = container.querySelector('details')!;
    expect(comparison.open).toBe(false);
    expect(comparison.textContent).toContain(validCompanyInfo.name);
    expect(comparison.textContent).not.toContain('Tên đang chỉnh');
    const save = screen.getByRole('button', { name: 'Lưu thông tin' });
    expect(save.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    companyInfoState.data = { ...validCompanyInfo, shortName: 'Dữ liệu mới từ máy khác' };
    rerender(<MemoryRouter><CompanyInfoConfigPage /></MemoryRouter>);
    expect(screen.getByLabelText('Tên đầy đủ')).toHaveValue('Tên đang chỉnh');
  });

});
