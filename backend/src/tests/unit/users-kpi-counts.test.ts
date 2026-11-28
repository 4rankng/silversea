import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { foldUsersKpiCounts } from '../../services/user-kpi-counts';

// SIL-1315 (id 1621) — dải KPI /users là PHÂN VÙNG: mọi tài khoản nằm đúng
// một nhóm, bốn nhóm cộng lại bằng tổng. Trước đây OPS/CUS/DISPATCHER/
// CUSTOMER lọt khỏi mọi nhóm (72 = 10 + 43 + 1) và tài khoản bị khoá bị đếm
// hai lần (vai trò + 'Bị khoá / Ngưng').
describe('foldUsersKpiCounts', () => {
  it('partitions the staging wave split: 72 = 10 + 43 + 18 + 1', () => {
    const counts = foldUsersKpiCounts([
      { role: 'ADMIN', status: 'ACTIVE', count: 2 },
      { role: 'MANAGER', status: 'ACTIVE', count: 1 },
      { role: 'ACCOUNTANT', status: 'ACTIVE', count: 3 },
      { role: 'OPS', status: 'ACTIVE', count: 3 },
      { role: 'CUS', status: 'ACTIVE', count: 1 },
      { role: 'DISPATCHER', status: 'ACTIVE', count: 0 },
      { role: 'DRIVER', status: 'ACTIVE', count: 43 },
      { role: 'DRIVER', status: 'INACTIVE', count: 1 },
      { role: 'CUSTOMER', status: 'ACTIVE', count: 18 },
    ]);
    assert.equal(counts.total, 72);
    assert.equal(counts.staffCount, 10);
    assert.equal(counts.driverCount, 43);
    assert.equal(counts.customerCount, 18);
    assert.equal(counts.inactiveCount, 1);
    assert.equal(
      counts.staffCount + counts.driverCount + counts.customerCount + counts.inactiveCount,
      counts.total,
    );
  });

  it('counts a locked account once — in the locked bucket, never also in its role bucket', () => {
    const counts = foldUsersKpiCounts([
      { role: 'DRIVER', status: 'INACTIVE', count: 2 },
      { role: 'OPS', status: 'LOCKED', count: 1 },
    ]);
    assert.equal(counts.total, 3);
    assert.equal(counts.driverCount, 0);
    assert.equal(counts.staffCount, 0);
    assert.equal(counts.inactiveCount, 3);
  });

  it('sums to total for every role/status mix, including unknown roles', () => {
    const rows = [
      { role: 'ADMIN', status: 'ACTIVE', count: 3 },
      { role: 'DRIVER', status: 'ACTIVE', count: 45 },
      { role: 'CUSTOMER', status: 'ACTIVE', count: 3 },
      { role: 'FUTURE_ROLE', status: 'ACTIVE', count: 7 },
      { role: 'FUTURE_ROLE', status: 'INACTIVE', count: 2 },
      { role: 'CUS', status: 'LOCKED', count: 1 },
    ];
    const counts = foldUsersKpiCounts(rows);
    assert.equal(counts.total, rows.reduce((sum, row) => sum + row.count, 0));
    assert.equal(
      counts.staffCount + counts.driverCount + counts.customerCount + counts.inactiveCount,
      counts.total,
    );
    assert.equal(counts.byRole.FUTURE_ROLE, 9);
  });
});
