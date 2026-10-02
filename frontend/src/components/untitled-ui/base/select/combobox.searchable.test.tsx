import { describe, expect, it } from 'vitest';

import { matchesComboboxSearch, normalizeSearchText } from './combobox';

describe('normalizeSearchText', () => {
  it('strips Vietnamese diacritics and lowercases', () => {
    expect(normalizeSearchText('Chi nhánh Á Đông Thủy sản')).toBe('chi nhanh a dong thuy san');
    expect(normalizeSearchText('Đặng Văn A')).toBe('dang van a');
  });

  it('trims surrounding whitespace and collapses repeated spaces', () => {
    expect(normalizeSearchText('  Maersk   Việt Nam  ')).toBe('maersk viet nam');
  });
});

describe('matchesComboboxSearch — the React Aria production predicate', () => {
  it('matches partial labels case- and diacritic-insensitively', () => {
    expect(matchesComboboxSearch('Chi nhánh Á Đông Thủy sản', 'chi nhanh')).toBe(true);
    expect(matchesComboboxSearch('Công ty TNHH Vận tải Hà Thanh', 'CONG TY')).toBe(true);
    expect(matchesComboboxSearch('Đặng Văn Bình', 'DANG')).toBe(true);
  });

  it('matches terms from the combined label and supporting text in any order', () => {
    const textValue = 'VID F_CODE Công ty Công nghệ Việt Đăng · KCN Đông Mai';
    for (const query of ['F_CODE', 'dong mai', 'Đông Mai'.normalize('NFD'), 'mai VID', '  viet   dang  ']) {
      expect(matchesComboboxSearch(textValue, query)).toBe(true);
    }
    expect(matchesComboboxSearch('ONE Ocean Network Express', 'ocean network')).toBe(true);
  });

  it('accepts empty input and rejects a query with an unmatched term', () => {
    expect(matchesComboboxSearch('VID Việt Đăng', '')).toBe(true);
    expect(matchesComboboxSearch('VID Việt Đăng', '   ')).toBe(true);
    expect(matchesComboboxSearch('VID Việt Đăng', 'VID missing')).toBe(false);
    expect(matchesComboboxSearch('VID Việt Đăng', 'zzz-khong-ton-tai')).toBe(false);
  });
});
