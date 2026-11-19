import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Role } from '@tingting/shared';
import { DISPATCH_BOARD_READERS } from '../routes/shipments/dispatch-planning.routes';

// SIL-862 — the seats the FE guard opens on /dispatch + /dispatch-detail must
// match the backend board READ authority. The first fix round opened the guard
// while these requireRoles sets still excluded OPS: the board rendered its
// error state instead of data. This pin keeps guard and API authority in step.

describe('SIL-862 dispatch board read set', () => {
  it('admits the board seats — Điều vận thao tác, Kế toán + ghế OPS đọc', () => {
    for (const role of [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT, Role.OPS]) {
      assert.ok(DISPATCH_BOARD_READERS.includes(role), role);
    }
  });

  it('keeps DRIVER, CUS and CUSTOMER off the board reads', () => {
    for (const role of [Role.DRIVER, Role.CUS, Role.CUSTOMER]) {
      assert.ok(!DISPATCH_BOARD_READERS.includes(role), role);
    }
  });
});
