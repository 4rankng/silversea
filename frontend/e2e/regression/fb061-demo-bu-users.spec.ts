/**
 * FB-061 — demo/QA rows không lộ ngoài context demo trên /users.
 *
 * FB-061 defect class (cards 141026012010 → 201026112400 → lan 3): dữ liệu
 * mẫu/QA (demo-BU users, fixture epoch-suffix, tombstone rows) lộ trên các
 * surface admin. Local-verifiable contract của class này:
 *  1. Một user QA fixture tự tạo (kiểu e2e-<epoch>, đúng lane QA) vẫn là
 *     user THẬT trong bảng — visible control (phát hiện lỗi "đém nhầm");
 *  2. Soft-delete nó (DELETE /users/:id) → biến mất khỏi /users ngay —
 *     tombstone không bao giờ render lại (deleted-entity leak law);
 *  3. Demo-seed trio local (cus/dieuvan "…Demo…") CÒN nguyên trên local —
 *     purge không over-block local dev logins (case B5, envs staging-only).
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  evidence,
  login,
  psql,
  runSerial,
  shot,
} from './helpers';

const admin = await login('admin');
const serial = runSerial();
const fixtureUsername = `e2e-fb061-${serial}`;

test.describe.configure({ mode: 'serial' });

test('FB-061: fixture QA user hiện (control) → soft-delete → không lộ trên /users; demo-seed local còn nguyên', async ({ browser }) => {
  // 1. Tạo user QA fixture (đúng lane QA: prefix e2e-, DISPATCHER).
  const created = await api<{ user?: { id: number }; id?: number }>(admin.token, 'POST', '/auth/users', {
    username: fixtureUsername,
    fullName: `E2E FB061 Probe ${serial}`,
    password: 'Abc123',
    role: 'DISPATCHER',
    status: 'ACTIVE',
  });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const userId = created.body.user?.id ?? created.body.id;
  expect(userId).toBeTruthy();

  const adm = await authedPage(browser, 'admin');
  try {
    // 2. Control: user mới tạo HIỆN trên /users (nếu class này hỏng theo chiều
    //    ngược — list filter quá rộng — sẽ bắt được ở đây).
    await appReady(adm.page, '/users');
    const searchBox = adm.page.getByPlaceholder('Tìm theo username, email, SĐT...');
    await expect(searchBox).toBeVisible({ timeout: 20_000 });
    await searchBox.fill(fixtureUsername);
    await adm.page.waitForTimeout(900); // debounce search
    const rows = adm.page.locator('table tbody tr, [role="row"]');
    await expect(rows.filter({ hasText: fixtureUsername }).first()).toBeVisible({ timeout: 20_000 });
    await shot(adm.page, 'fb061-users-fixture-visible-control');

    // 3. Soft-delete qua API (If-Unmodified-Since = phiên bản user) → tombstone
    //    row phải rời bảng ngay.
    const dbBefore = await psql(`SELECT id, username, deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${userId}`);
    evidence('fb061-db-before-delete.txt', `${dbBefore}\n`);
    const usersList = await api<{ items?: Array<{ id: number; updatedAt: string }> }>(admin.token, 'GET', '/auth/users?limit=500');
    const me = (usersList.body.items ?? []).find((u) => u.id === userId);
    expect(me, 'user còn trong list trước khi xóa').toBeTruthy();
    const delRes = await fetch(`${process.env.REG_API_URL ?? 'http://localhost:3002/api'}/auth/users/${userId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Idempotency-Key': crypto.randomUUID(),
        'If-Unmodified-Since': me!.updatedAt,
      },
    });
    expect(delRes.status, `DELETE status ${delRes.status}`).toBeLessThan(300);
    const dbAfter = await psql(`SELECT id, username, deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${userId}`);
    evidence('fb061-db-after-delete.txt', `${dbAfter}\n`);
    expect(dbAfter).toContain('t');

    await adm.page.reload();
    const searchBox2 = adm.page.getByPlaceholder('Tìm theo username, email, SĐT...');
    await expect(searchBox2).toBeVisible({ timeout: 20_000 });
    await searchBox2.fill(fixtureUsername);
    await adm.page.waitForTimeout(900);
    const goneRows = adm.page.locator('table tbody tr, [role="row"]');
    await expect(goneRows.filter({ hasText: fixtureUsername }).first()).toBeHidden({ timeout: 20_000 });
    await shot(adm.page, 'fb061-users-fixture-deleted-gone');

    // 4. Demo-seed local contract: tài khoản demo còn nguyên (local cần demo
    //    logins — purge surfaces demo là staging-only, không được đụng local).
    await searchBox2.fill('demo');
    await adm.page.waitForTimeout(900);
    const body = await adm.page.locator('body').innerText();
    expect(body, 'demo-seed users còn trên local (cus/dieuvan Demo)').toMatch(/Nhân viên CUS Demo|Điều vận Demo/);
    await shot(adm.page, 'fb061-users-demo-seed-local-intact');
  } finally {
    await adm.close();
  }
});
