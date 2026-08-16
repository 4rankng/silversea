import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssetIcon, type AssetIconName } from '../components/AssetIcon';
import { CONFIG_ITEMS, filterItems, getSearchItems } from './searchRegistry';

const DISTINCT_CONFIG_ICONS = {
  'company-info': 'company-profile',
  'road-allowances': 'road-allowance',
  'trip-expense': 'trip-expense-rules',
  'cap-table': 'equity-ownership',
  routes: 'route-distance',
  trucks: 'tractor-head',
  'tire-positions': 'tire-position',
  trailers: 'semi-trailer',
  'pricing-tables': 'pricing-rate',
  'salary-periods': 'salary-period',
  'expense-categories': 'expense-category',
  'forwarder-expense-types': 'forwarder-expense',
  'debit-note-templates': 'debit-note-template',
  'app-settings': 'app-settings',
} as const;

describe('config card icon assignments', () => {
  it('keeps the audited config concepts visually distinct', () => {
    const iconById = new Map(CONFIG_ITEMS.map(item => [item.id, item.iconName]));

    for (const [id, iconName] of Object.entries(DISTINCT_CONFIG_ICONS)) {
      expect(iconById.get(id)).toBe(iconName);
    }

    expect(new Set(Object.values(DISTINCT_CONFIG_ICONS)).size).toBe(
      Object.keys(DISTINCT_CONFIG_ICONS).length,
    );
  });

  it('resolves every distinct concept to a different branded asset', () => {
    const assetUrls = Object.values(DISTINCT_CONFIG_ICONS).map(iconName => {
      const { container, unmount } = render(
        createElement(AssetIcon, { name: iconName as AssetIconName }),
      );
      const src = container.querySelector('img')?.getAttribute('src');
      unmount();
      return src;
    });

    expect(assetUrls.every(src => src?.endsWith('.png'))).toBe(true);
    expect(new Set(assetUrls).size).toBe(assetUrls.length);
  });
});

describe('admin search icon assignments', () => {
  it('uses the dedicated financial and audit concepts', () => {
    const iconById = new Map(getSearchItems('ADMIN').map(item => [item.id, item.iconName]));

    expect(iconById.get('profit')).toBe('profit');
    expect(iconById.get('payables')).toBe('payables');
    expect(iconById.get('advances')).toBe('advances');
    expect(iconById.get('audit-logs')).toBe('audit-log');
    expect(iconById.get('action-audit-logs')).toBe('audit-log');
  });
});

describe('role-aware search destinations', () => {
  it('uses the accountant workspace as home without advertising blocked routes', () => {
    const items = getSearchItems('ACCOUNTANT', ['treasury.read']);
    expect(items.some(item => item.id === 'accounting' && item.path === '/accounting' && item.label === 'Tổng Quan')).toBe(true);
    expect(items.some(item => item.id === 'dispatch' || item.id === 'dashboard')).toBe(false);
    expect(items.some(item => item.id === 'treasury')).toBe(true);
  });

  it('does not add a competing dashboard destination for accountants', () => {
    const items = getSearchItems('ACCOUNTANT', ['executive_dashboard.read']);
    expect(items.some(item => item.id === 'dashboard')).toBe(false);
    expect(items.filter(item => item.id === 'accounting')).toHaveLength(1);
  });

  it('gives dispatchers their five nav destinations instead of an empty palette', () => {
    const items = getSearchItems('DISPATCHER');
    expect(items.map(item => item.path)).toEqual([
      '/dispatch',
      '/dispatch-detail',
      '/fleet/vehicles',
      '/fleet/drivers',
      '/suppliers',
    ]);
    // The dispatcher palette must not leak admin-only surfaces.
    expect(items.some(item => item.path.startsWith('/config') || item.path === '/users')).toBe(false);
  });

  it('matches dispatcher pages from plain ASCII queries (diacritics folding)', () => {
    const items = getSearchItems('DISPATCHER');
    expect(filterItems(items, 'ke hoach').map(item => item.id)).toEqual([
      'dispatch-master-plan',
      'dispatch-detail-plan',
    ]);
    expect(filterItems(items, 'tai xe').map(item => item.id)).toEqual(['fleet-drivers']);
  });

  it('gives CUS clerks the shipment workspaces', () => {
    const items = getSearchItems('CUS');
    expect(items.map(item => item.path)).toEqual(['/shipments', '/shipments-detail']);
  });
});
