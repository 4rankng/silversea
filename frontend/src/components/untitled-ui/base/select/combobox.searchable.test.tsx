import { describe, expect, it } from 'vitest';

import { filterComboboxItems, normalizeSearchText } from './combobox';

describe('normalizeSearchText', () => {
  it('strips Vietnamese diacritics and lowercases', () => {
    expect(normalizeSearchText('Chi nhánh Á Đông Thủy sản')).toBe('chi nhanh a dong thuy san');
    expect(normalizeSearchText('Đặng Văn A')).toBe('dang van a');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSearchText('  Maersk  ')).toBe('maersk');
  });
});

describe('filterComboboxItems', () => {
  const items = [
    { id: '1', label: 'Công ty TNHH Vận tải Hà Thanh' },
    { id: '2', label: 'Chi nhánh Á Đông Thủy sản' },
    { id: '3', label: 'Đặng Văn Bình' },
  ];

  it('matches partial label text case- and diacritic-insensitively', () => {
    expect(filterComboboxItems(items, 'chi nhanh').map((h) => h.id)).toEqual(['2']);
    expect(filterComboboxItems(items, 'CONG TY').map((h) => h.id)).toEqual(['1']);
  });

  it('matches across label AND supporting text', () => {
    const withText = [
      { id: 'a', label: 'ONE', supportingText: 'Ocean Network Express' },
      { id: 'b', label: 'MSSC' },
    ];
    expect(filterComboboxItems(withText, 'ocean network').map((h) => h.id)).toEqual(['a']);
  });

  it('returns every item when the query is empty', () => {
    expect(filterComboboxItems(items, '').length).toBe(3);
  });

  it('returns empty — driving the no-results row — when nothing matches', () => {
    expect(filterComboboxItems(items, 'zzz-khong-ton-tai')).toEqual([]);
  });
});
