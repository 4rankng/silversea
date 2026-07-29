import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyInfo } from '@tingting/shared';
import { useCompanyInfo } from '../../../hooks/useCatalogQueries';
import { CompanyInfoSetupBanner } from './CompanyInfoSetupBanner';

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useCompanyInfo: vi.fn(),
}));

const emptyCompanyInfo: CompanyInfo = {
  name: '',
  address: '',
  taxCode: '',
  representative: '',
  representativeTitle: '',
  bankAccount: '',
  bankName: '',
  phone: '',
  email: '',
  logoStorageKey: null,
  updatedAt: null,
};

describe('CompanyInfoSetupBanner', () => {
  beforeEach(() => {
    vi.mocked(useCompanyInfo).mockReset();
  });

  it('shows a non-dismissible setup action for seeded blank company rows', () => {
    vi.mocked(useCompanyInfo).mockReturnValue({
      data: { ...emptyCompanyInfo, updatedAt: '2026-07-29T00:00:00.000Z' },
    } as ReturnType<typeof useCompanyInfo>);

    render(
      <MemoryRouter>
        <CompanyInfoSetupBanner />
      </MemoryRouter>,
    );

    expect(screen.getByText('Chưa cấu hình thông tin công ty.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đóng thông báo' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Bổ sung thông tin' }).getAttribute('href'))
      .toBe('/config/company-info');
  });

  it('stays hidden after persisted company information exists', () => {
    vi.mocked(useCompanyInfo).mockReturnValue({
      data: {
        ...emptyCompanyInfo,
        name: 'TingTing Logistics',
        address: '1 Đường Vận Tải',
        taxCode: '0312345678',
        representative: 'Nguyễn Văn An',
        representativeTitle: 'Giám đốc',
        bankAccount: '0123456789',
        bankName: 'Vietcombank',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    } as ReturnType<typeof useCompanyInfo>);

    render(
      <MemoryRouter>
        <CompanyInfoSetupBanner />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Chưa cấu hình thông tin công ty.')).toBeNull();
  });

  it('does not show a false warning while the company-info request has no data', () => {
    vi.mocked(useCompanyInfo).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useCompanyInfo>);

    render(
      <MemoryRouter>
        <CompanyInfoSetupBanner />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Chưa cấu hình thông tin công ty.')).toBeNull();
  });
});
