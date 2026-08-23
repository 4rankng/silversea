import { describe, it, expect } from 'vitest';
import { homeForRole, routes, titleForPath } from './routes';
import { PAGE_CATALOG, AGENT_ROUTE_KEYS } from '@tingting/shared';

/**
 * Golden title parity: every representative pathname must resolve to the SAME
 * Vietnamese title the hand-written titleRules produced before the catalog
 * refactor. If this breaks, a title string drifted or the precedence order
 * changed — both are regressions.
 */
describe('titleForPath (catalog-sourced, parity with pre-refactor behavior)', () => {
  const cases: Record<string, string> = {
    '/dashboard': 'Tổng quan',
    '/dispatch': 'Kế hoạch Tổng quát',
    '/dispatch-detail': 'Kế hoạch Chi tiết Xe', // exact-match rule must beat the /dispatch startsWith rule
    '/fleet': 'Đội xe',
    '/fleet/5/tires': 'Đội xe',
    '/trips': 'Lệnh vận chuyển',
    '/trips/new': 'Tạo lệnh vận chuyển',
    '/trips/123': 'Chi tiết lệnh vận chuyển',
    '/trips/123/edit': 'Sửa lệnh vận chuyển',
    '/finance': 'Báo cáo lãi lỗ',
    '/accounting': 'Tổng Quan',
    '/profit': 'Phân chia lợi nhuận',
    '/debt': 'Công nợ phải thu',
    '/debt/5': 'Công nợ phải thu',
    '/credit-overrides': 'Duyệt vượt hạn mức',
    '/governance-actions': 'Trung tâm phê duyệt',
    '/payables': 'Công nợ phải trả',
    '/payables/9': 'Công nợ phải trả',
    '/expenses/new': 'Ghi nhận chi phí',
    '/expenses/7/edit': 'Sửa chi phí',
    '/expenses': 'Chi phí phát sinh',
    '/suppliers': 'Nhà cung cấp',
    '/penalties': 'Kỷ luật',
    '/my-penalties': 'Kỷ luật',
    '/customers': 'Khách hàng',
    '/config/routes': 'Tuyến đường',
    '/routes': 'Tuyến đường', // legacy redirect path → still resolves via legacy alias rule
    '/config/debit-note-templates': 'Mẫu giấy báo nợ',
    '/config/debit-note-templates/new': 'Mẫu giấy báo nợ',
    '/config/debit-note-templates/7': 'Mẫu giấy báo nợ',
    '/config': 'Cấu hình hệ thống',
    '/config/trucks': 'Cấu hình', // generic config catch-all (no specific rule)
    '/config/fuel': 'Cấu hình',
    '/config/salary-periods': 'Cấu hình',
    '/users': 'Người dùng',
    '/audit-logs': 'Nhật ký người dùng',
    '/portal/shipments': 'Lô hàng của tôi',
    '/portal/shipments/9': 'Chi tiết lô hàng',
    '/portal/debit-notes': 'Giấy báo nợ',
    '/portal/statement': 'Sao kê công nợ',
    '/shipments/new': 'Tạo lô hàng',
    '/my-trips': 'Hành trình',
    '/my-trips/3': 'Hành trình',
    '/my-earnings': 'Thu nhập',
    '/my-orders': 'Lệnh giao nhận',
    '/my-forwarder-trips': 'Chuyến đi',
    '/my-advances': 'Tạm ứng',
    '/my-settlements': 'Phiếu thanh toán',
    '/my-settlements/new': 'Phiếu thanh toán',
    '/my-settlements/9': 'Chi tiết phiếu thanh toán',
    '/advances': 'Tạm ứng & hoàn ứng',
    '/admin/advance-settlements': 'Tạm ứng & hoàn ứng',
    '/salary': 'Lương & Chấm công',
    '/': 'TransTing', // no match → app default
    '/totally-unknown': 'TransTing',
  };

  it.each(Object.entries(cases))('%s → %s', (path, expected) => {
    expect(titleForPath(path)).toBe(expected);
  });
});

describe('homeForRole', () => {
  it('routes CUSTOMER users to the customer portal home', () => {
    expect(homeForRole('CUSTOMER')).toBe('/portal/shipments');
  });

  it('routes CUS users to their assigned shipment queue', () => {
    expect(homeForRole('CUS')).toBe('/shipments');
  });

  it('routes ACCOUNTANT users to the dedicated accounting workspace', () => {
    expect(homeForRole('ACCOUNTANT')).toBe('/accounting');
  });

  it('routes ADMIN users to the system configuration workspace', () => {
    expect(homeForRole('ADMIN')).toBe('/config');
  });

  it('keeps MANAGER users on the management dashboard', () => {
    expect(homeForRole('MANAGER')).toBe('/dashboard');
  });

  it('routes DISPATCHER users to the dispatch workspace', () => {
    expect(homeForRole('DISPATCHER')).toBe('/dispatch');
  });

  it('routes OPS and legacy FORWARDER users to the order-exchange workspace', () => {
    expect(homeForRole('OPS')).toBe('/my-orders');
    expect(homeForRole('FORWARDER')).toBe('/my-orders');
  });
});

/**
 * Live tracking was removed from the product. Keep the dead route constant
 * from coming back: no ROUTES value may reference /dispatch/live-tracking.
 */
describe('removed live-tracking route stays removed', () => {
  const flatten = (value: unknown, prefix = ''): string[] => {
    if (typeof value === 'string') return [prefix ? `${prefix}.${value}` : value];
    if (typeof value === 'function') return [];
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
    }
    return [];
  };

  it('no route value references /dispatch/live-tracking', () => {
    const offenders = flatten(routes).filter((v) => v.endsWith('/dispatch/live-tracking'));
    expect(offenders, `stale live-tracking route constants: ${offenders.join(', ')}`).toEqual([]);
  });
});

/**
 * The compile-time assertion in shared/src/schemas/agent.ts already enforces
 * this at build time; this is the runtime mirror so a broken assertion (e.g.
 * someone widening the type) is still caught in CI.
 */
describe('agent route-key set parity (catalog ↔ AGENT_ROUTE_KEYS)', () => {
  const catalog = PAGE_CATALOG as Record<string, { agent?: { description: string } }>;

  it('every catalog entry with an `agent` is listed in AGENT_ROUTE_KEYS', () => {
    const catalogAgentKeys = Object.keys(catalog).filter((k) => catalog[k].agent != null);
    const tuple = AGENT_ROUTE_KEYS as readonly string[];
    for (const k of catalogAgentKeys) {
      expect(tuple, `${k} has agent data but is not an AgentRouteKey`).toContain(k);
    }
  });

  it('every AgentRouteKey has catalog `agent` data', () => {
    for (const k of AGENT_ROUTE_KEYS) {
      expect(PAGE_CATALOG[k].agent, `${k} is an AgentRouteKey but has no agent data`).toBeDefined();
    }
  });

  it('agent set includes all 39 navigable office destinations', () => {
    expect(AGENT_ROUTE_KEYS).toHaveLength(39);
  });
});
