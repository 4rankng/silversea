// SIL-574 verify — the Đổi mật khẩu dialog offers password generation:
// the "Tạo mật khẩu" button fills new + confirm with ONE strong password and
// leaves the current-password field untouched (QA fail 29/10: "dialog không
// có tính năng tạo mật khẩu — mong đợi: có nút tạo mật khẩu theo AC").
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const FE = process.env.QA_BASE_URL || 'http://localhost:7202';
const OUT = 'qa';
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'giamdoc');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 800));
  say(`login → ${new URL(page.url()).pathname}`);

  // Sidebar user menu → Đổi mật khẩu (the QA repro path: driver /my-trips →
  // Tài khoản → Đổi mật khẩu — the menu lives in the sidebar footer).
  await page.click('button.sidebar-user');
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Đổi mật khẩu'));
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 800));

  const before = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const gen = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Tạo mật khẩu'));
    return {
      dialogOpen: !!dialog,
      hasGenerate: !!gen,
      newFilled: (document.querySelector('input[autocomplete="new-password"]') || {}).value || '',
    };
  });
  check('Đổi mật khẩu dialog opens', before.dialogOpen);
  check('Tạo mật khẩu button is present (QA: was missing)', before.hasGenerate);

  await page.evaluate(() => {
    const gen = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Tạo mật khẩu'));
    gen?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 400));

  const after = await page.evaluate(() => {
    const news = [...document.querySelectorAll('input[autocomplete="new-password"]')].map((i) => i.value);
    const current = document.querySelector('input[autocomplete="current-password"]')?.value ?? '';
    return { news, current };
  });
  const [first, second] = after.news;
  check('both new-password fields filled with the SAME password', !!first && first === second, `len=${first?.length ?? 0}`);
  check('generated password is 16 chars over 4 classes', first?.length === 16 && /[a-z]/.test(first) && /[A-Z]/.test(first) && /[0-9]/.test(first) && /[!@#$%^&*?\-_=+]/.test(first));
  check('current-password field untouched', after.current === '', `value=${JSON.stringify(after.current)}`);

  await page.screenshot({ path: `${OUT}/2026-10-29_sil574_ui-password-modal-1280.png` });
} finally {
  await browser.close();
  writeFileSync(`${OUT}/2026-10-29_sil574_ui-driver.log`, log.join('\n') + `\nTOTAL ${checks - fails.length}/${checks} PASS\n`);
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
