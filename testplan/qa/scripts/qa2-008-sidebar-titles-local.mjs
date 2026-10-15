// qa2-008 rung-3 driver — sidebar label === page title, on the local
// contract-port pair (7175 FE / 3002 API via env override to isolated stack).
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = `http://localhost:${process.env.QA_LOCAL_FRONTEND_PORT ?? 7175}`;
const dir = 'qa/evidence/2026-10-14_qa2-008-sidebar-titles';
mkdirSync(dir, { recursive: true });
const log = `${dir}/driver.log`;
appendFileSync(log, '');
const step = (entry) => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); appendFileSync(log, line + '\n'); console.log(line); };
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const sidebarLabels = () => page.evaluate(() => [...document.querySelectorAll('aside .sidebar-item-label, .sidebar-item-label')].map((el) => (el.textContent || '').trim()).filter(Boolean));

const drive = async (username, checks) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input[name="username"]', username, { delay: 8 });
  await page.type('input[name="password"]', 'Abc123', { delay: 8 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 2000));
  for (const [label, path] of checks) {
    // Sidebar sections are collapsible; expand every group first so the
    // target label exists in the DOM, then click it.
    await page.evaluate(() => {
      for (const toggle of [...document.querySelectorAll('.sidebar-section-toggle')]) {
        const section = toggle.closest('.sidebar-section');
        if (section && !section.querySelector('.sidebar-item-label')) toggle.click();
      }
    });
    await new Promise((r) => setTimeout(r, 400));
    // Click the sidebar item by its visible label (sidebar items are buttons).
    const click = await page.evaluate((lbl) => {
      const labels = [...document.querySelectorAll('.sidebar-item-label')];
      const el = labels.find((n) => (n.textContent || '').trim() === lbl);
      if (!el) return false;
      const btn = el.closest('button');
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    await new Promise((r) => setTimeout(r, 1800));
    const topbar = await page.evaluate(() => document.title);
    const url = page.url();
    const visibleLabel = await page.evaluate((lbl) => {
      const el = [...document.querySelectorAll('.sidebar-item-label')].find((n) => (n.textContent || '').trim() === lbl);
      return el ? el.textContent.trim() : null;
    }, label);
    step({ step: 'click', user: username, sidebarLabel: label, visibleLabel, found: click, topbarTitle: topbar, url, path });
    await shot(page, `${username}-${path.replaceAll('/', '_')}`);
  }
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' }).catch(() => {});
  await page.evaluate(() => localStorage.clear()).catch(() => {});
};

try {
  // OPS: the renamed My-work items.
  await drive('giaonhan', [
    ['Tạm ứng', '/my-advances'],
    ['Phiếu thanh toán', '/my-settlements'],
  ]);
  // ADMIN: the heaviest drift set.
  await drive('admin', [
    ['Kế hoạch Tổng quát', '/dispatch'],
    ['Phân chia lợi nhuận', '/profit'],
    ['Nhật ký người dùng', '/audit-logs'],
    ['Cấu hình hệ thống', '/config'],
    ['Cảng / Bãi', '/config/ports'],
    ['Người dùng', '/users'],
  ]);
  step({ step: 'DONE', ok: true });
} catch (error) {
  await shot(page, '99-failure');
  step({ step: 'FAIL', error: String(error) });
  process.exitCode = 1;
} finally {
  await browser.close();
}
