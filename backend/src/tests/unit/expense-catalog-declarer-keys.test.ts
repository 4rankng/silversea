// SIL-1242 — GET /expense-accounting/catalog trả payload theo vai (role-scoped).
// Bản cũ thiếu các khóa staff/suppliers với vai Chứng từ (Role.CUS) nên form
// 'Khai chi phí' sập "can't access property \"map\" of undefined". Mọi vai qua
// requireRead phải nhận đủ các khóa catalog mà wire type hứa; hai vai được khai
// chi phí (CUS, OPS) phải có danh mục payer dùng được (staff/suppliers).
// Chạy với fake executor — luật khóa-của-payload, không db (BE unit-only law),
// theo mẫu queued-executor của cus-visibility.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@tingting/shared';
import { getExpenseAccountingCatalog } from '../../services/expense-accounting-reads.service';

// Mỗi truy vấn của nhánh non-finance await đúng một lần trên chuỗi
// select().from().where()[.orderBy()] — mỗi await lấy kết quả kế tiếp từ hàng đợi.
function queuedExecutor(results: unknown[][]) {
  let call = 0;
  const next = () => results[call++] ?? [];
  const chain: Record<string, unknown> = {};
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.then = (resolve: (rows: unknown) => unknown, reject: (err: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve, reject);
  return { select: () => ({ from: () => chain }) } as never;
}

const WIRE_KEYS = ['staff', 'accounts', 'accountants', 'opsUsers', 'advances', 'pendingAdvances', 'suppliers', 'carriers', 'expenseTypes'] as const;

describe('getExpenseAccountingCatalog — khóa catalog theo vai', () => {
  it('mọi vai qua requireRead nhận đủ khóa wire type (không sót khóa map)', async () => {
    for (const role of [Role.CUS, Role.OPS, Role.DRIVER]) {
      const catalog = await getExpenseAccountingCatalog({ userId: 7, role }, queuedExecutor([[], [], []])) as Record<string, unknown>;
      for (const key of WIRE_KEYS) assert.ok(key in catalog, `vai ${role} thiếu khóa ${key}`);
    }
  });

  it('vai Chứng từ (CUS) có staff + suppliers dùng được cho ô Người chi / Nhà cung cấp', async () => {
    const people = [
      { id: 16, name: 'Nguyễn Văn A', username: 'a', role: Role.DRIVER },
      { id: 15, name: '  Ops User  ', username: 'o', role: Role.OPS },
    ];
    const suppliers = [{ id: 3, name: 'Nhà xe A' }];
    const catalog = await getExpenseAccountingCatalog({ userId: 7, role: Role.CUS }, queuedExecutor([[], people, suppliers])) as {
      staff: Array<{ id: number; name: string }>; opsUsers: unknown[]; suppliers: Array<{ id: number; name: string }>;
    };
    // staff = đủ nhóm chi được (kế toán/hành vận/lái xe), tên đã trim.
    assert.deepEqual(catalog.staff.map(person => ({ id: person.id, name: person.name })), [{ id: 16, name: 'Nguyễn Văn A' }, { id: 15, name: 'Ops User' }]);
    // CUS không có nhóm Ops riêng — ô theo entryScope OPS không dành cho vai này.
    assert.deepEqual(catalog.opsUsers, []);
    assert.deepEqual(catalog.suppliers, suppliers);
  });

  it('vai Ops giữ opsUsers của mình và có suppliers — ô entryScope OPS vẫn đủ lựa chọn', async () => {
    const people = [
      { id: 15, name: 'Ops User', username: 'o', role: Role.OPS },
      { id: 16, name: 'Driver', username: 'd', role: Role.DRIVER },
    ];
    const suppliers = [{ id: 3, name: 'Nhà xe A' }];
    const catalog = await getExpenseAccountingCatalog({ userId: 15, role: Role.OPS }, queuedExecutor([[], people, suppliers])) as {
      staff: unknown[]; opsUsers: Array<{ id: number; name: string }>; suppliers: unknown[];
    };
    assert.deepEqual(catalog.opsUsers.map(person => ({ id: person.id, name: person.name })), [{ id: 15, name: 'Ops User' }]);
    assert.deepEqual(catalog.suppliers, suppliers);
  });

  it('vai DRIVER chỉ đọc: các khóa danh mục là danh sách rỗng, không thiếu khóa', async () => {
    const catalog = await getExpenseAccountingCatalog({ userId: 16, role: Role.DRIVER }, queuedExecutor([[]])) as Record<string, unknown>;
    for (const key of WIRE_KEYS) assert.ok(key in catalog, `vai DRIVER thiếu khóa ${key}`);
    assert.deepEqual(catalog.staff, []);
    assert.deepEqual(catalog.suppliers, []);
  });
});
