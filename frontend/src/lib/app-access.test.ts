import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';

import { canViewInvoiceTracking, INVOICE_TRACKING_ROLES } from './app-access';

/**
 * Card 20260928_178: "Cả vai CUS và vai kế toán đều MỞ ĐƯỢC mục theo dõi hóa
 * đơn kết hợp (kiểm chứng bằng test phân quyền, không chỉ bằng việc ẩn menu)."
 *
 * The gap this closes: the route guard already admitted both roles, but nothing
 * pinned it. A guard that is correct today and unnamed tomorrow is one refactor
 * from silently dropping a role while the nav still looks right.
 *
 * These are policy pins, not render pins. They state which roles the route
 * admits, not that a given user reaches a rendered page — a full App render
 * would also have to stand up the auth context and every API the shell calls.
 * What these DO catch is the regression that actually happens: someone editing
 * the route's role list.
 */
describe('invoice-tracking route access', () => {
  it('admits CUS as well as accounting — the card names both explicitly', () => {
    expect(canViewInvoiceTracking(Role.CUS)).toBe(true);
    expect(canViewInvoiceTracking(Role.ACCOUNTANT)).toBe(true);
  });

  it('admits the office roles that own the ledger', () => {
    expect(canViewInvoiceTracking(Role.ADMIN)).toBe(true);
    expect(canViewInvoiceTracking(Role.MANAGER)).toBe(true);
  });

  it.each([Role.DISPATCHER, Role.DRIVER, Role.OPS] as const)(
    'refuses %s — the tracker is an accounting surface, not an operations one',
    (role) => {
      expect(canViewInvoiceTracking(role)).toBe(false);
    },
  );

  it('refuses an absent role instead of defaulting open', () => {
    // The failure this guards is the quiet one: `role != null &&` missing means
    // a logged-out or role-less session reads as "allowed".
    expect(canViewInvoiceTracking(null)).toBe(false);
    expect(canViewInvoiceTracking(undefined)).toBe(false);
  });

  it('keeps the admitted set to exactly the four roles, with no silent growth', () => {
    // CUS here means REACH. Writes are gated separately by WRITE_ROLES on the
    // page, mirroring the server's requireRoles. If someone adds a role to this
    // list they have granted page access, and this test should say so.
    expect([...INVOICE_TRACKING_ROLES].sort()).toEqual(
      [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS].sort(),
    );
  });
});
