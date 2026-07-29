import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CompanyInfo } from './types';
import { isCompanyInfoConfigured } from './company-info';

const completeCompanyInfo: CompanyInfo = {
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

describe('isCompanyInfoConfigured', () => {
  test('accepts a complete profile even when optional contact fields and logo are empty', () => {
    assert.equal(isCompanyInfoConfigured(completeCompanyInfo), true);
  });

  test('rejects seeded blank rows even when they already have an updatedAt timestamp', () => {
    assert.equal(isCompanyInfoConfigured({
      ...completeCompanyInfo,
      name: '',
    }), false);
  });

  test('rejects whitespace-only required values and missing data', () => {
    assert.equal(isCompanyInfoConfigured({
      ...completeCompanyInfo,
      bankName: '   ',
    }), false);
    assert.equal(isCompanyInfoConfigured(undefined), false);
    assert.equal(isCompanyInfoConfigured(null), false);
  });
});
