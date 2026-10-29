// SIL-589 / SIL-590 / SIL-591 — one UI drive, three tickets (2026-10-29).
// dungnv (dispatcher) on local dev :7175.
//
// 589: /dispatch — an LCL row's "Tổng quan hàng hóa" cell carries the "Lẻ"
//      flag; a ghép-group member reads "Lẻ · Ghép" (grouped: KK95249354).
// 590: /dispatch-detail — an UNGROUPED LCL row's ⋯ menu offers "Gộp hàng";
//      clicking it turns the merge mode ON with the row pre-picked and the
//      floating selection bar visible, WITHOUT navigating to /dispatch.
// 591: /dispatch-detail — quick-issue ONE lot of a 2-lot ghép group → the
//      sibling auto-issues on the same rig: toast names it, both rows flip
//      "Đã phát lệnh". Group target via QA_691_PRIMARY/QA_691_SIBLING
//      (default R39B1-LCL01 → R39B1-LCL02, group 3192c04d…).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve('qa');
const GROUP = {
  primary: process.env.QA_691_PRIMARY || 'R39B1-LCL01',
  sibling: process.env.QA_691_SIBLING || 'R39B1-LCL02',
};
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled input's value through the native setter (a plain
 *  el.value = … is wiped by the next controlled render), then fire input. */
const typeReact = (page, ariaLabel, text) => page.evaluate((label, value) => {
  const el = document.querySelector(`input[aria-label="${label}"]`);
  if (!el) return null;
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
}, ariaLabel, text);

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'dungnv');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1800);
  say(`login → ${new URL(page.url()).pathname}`);

  // ── SIL-589: the cargo flag on Kế hoạch Tổng quát ─────────────────────────
  say('PART 689 — master plan cargo flag');
  await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3500); // the FilterBar remounts after the grid's first fetch — wait it out
  let groupedFlag = { found: false };
  for (let attempt = 0; attempt < 3 && !groupedFlag.found; attempt += 1) {
    await typeReact(page, 'Tìm kiếm lô hàng', 'KK95249354');
    await sleep(2600);
    groupedFlag = await page.evaluate(() => {
      const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('KK95249354'));
      if (!row) return { found: false };
      const cell = row.querySelector('td[data-label="Tổng quan hàng hóa"]');
      return { found: true, flag: cell?.textContent ?? '' };
    });
  }
  check('689 grouped KK95249354 cargo cell reads "Lẻ · Ghép"', groupedFlag.found && groupedFlag.flag.includes('Lẻ · Ghép'), JSON.stringify(groupedFlag));
  await typeReact(page, 'Tìm kiếm lô hàng', 'R42RV-D2');
  await sleep(2600);
  const ungroupedFlag = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('R42RV-D2'));
    if (!row) return { found: false };
    const cell = row.querySelector('td[data-label="Tổng quan hàng hóa"]');
    return { found: true, flag: cell?.textContent ?? '', hasGhep: (cell?.textContent ?? '').includes('Ghép') };
  });
  check('689 ungrouped R42RV-D2 cargo cell reads "Lẻ" without Ghép', ungroupedFlag.found && ungroupedFlag.flag.includes('Lẻ') && !ungroupedFlag.hasGhep, JSON.stringify(ungroupedFlag));
  await page.screenshot({ path: resolve(OUT, '2026-10-29_sil589_ui-dispatch-le-flag.png') });
  say('  screenshot qa/2026-10-29_sil589_ui-dispatch-le-flag.png');

  // ── SIL-590: the row menu's "Gộp hàng" merges in place ────────────────────
  say('PART 690 — row menu Gộp hàng (ungrouped LCL, in place)');
  await page.goto(`${FE}/dispatch-detail?q=R42RV-D2`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2800);
  const opened690 = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('R42RV-D2'));
    if (!row) return false;
    row.querySelector('.dispatch-row-menu__trigger')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  await sleep(600);
  const menu690 = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()));
  check('690 ungrouped LCL row menu offers "Gộp hàng"', opened690 && menu690.some((t) => t.includes('Gộp hàng')), JSON.stringify(menu690));
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('Gộp hàng'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(900);
  const mergeState = await page.evaluate(() => ({
    path: new URL(location.href).pathname,
    bar: document.querySelector('.lcl-selection-bar')?.textContent ?? null,
    checkedBoxes: [...document.querySelectorAll('tbody [role="checkbox"][aria-checked="true"]')].map((c) => c.getAttribute('aria-label')),
  }));
  check('690 URL stays /dispatch-detail (no navigation)', mergeState.path === '/dispatch-detail', mergeState.path);
  check('690 merge mode ON, row pre-picked — bar "Đang chọn 1 lô"', (mergeState.bar ?? '').includes('Đang chọn 1 lô'), (mergeState.bar ?? '').slice(0, 90));
  check('690 exactly 1 CHỌN checkbox ticked — the R42RV-D2 row', mergeState.checkedBoxes.length === 1 && (mergeState.checkedBoxes[0] ?? '').includes('R42RV-D2'), JSON.stringify(mergeState.checkedBoxes));
  await page.screenshot({ path: resolve(OUT, '2026-10-29_sil590_ui-detail-row-menu-gop-hang.png') });
  say('  screenshot qa/2026-10-29_sil590_ui-detail-row-menu-gop-hang.png');

  // Negative: a GROUPED row never offers "Gộp hàng".
  say('PART 690b — grouped row negative');
  await page.goto(`${FE}/dispatch-detail?q=KK95249354`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2800);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('KK95249354'));
    row?.querySelector('.dispatch-row-menu__trigger')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(600);
  const groupedMenu = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()));
  check('690b grouped KK95249354 menu has NO "Gộp hàng" (has Đổi nhà xe/BKS)', !groupedMenu.some((t) => t.includes('Gộp hàng')) && groupedMenu.some((t) => t.includes('Đổi nhà xe/BKS')), JSON.stringify(groupedMenu));
  await page.keyboard.press('Escape');
  await sleep(400);

  // ── SIL-591: issue one lot of the ghép group → sibling auto-issues ────────
  say(`PART 691 — issue ${GROUP.primary} → ${GROUP.sibling} auto-issues`);
  await page.goto(`${FE}/dispatch-detail?q=${GROUP.primary}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3800);
  const issueClicked = await page.evaluate((ref) => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(ref));
    if (!row) return { ok: false, why: 'row not found' };
    const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Phát lệnh'));
    if (!btn) return { ok: false, why: 'no quick-issue button', buttons: [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) };
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { ok: true };
  }, GROUP.primary);
  check('691 quick-issue clicked on ' + GROUP.primary, issueClicked.ok === true, JSON.stringify(issueClicked));
  // The toast lives a few seconds — poll instead of one late read.
  let issueState = { toast: [], primaryIssued: false };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(1200);
    issueState = await page.evaluate((ref) => ({
      toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()),
      primaryIssued: [...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent.includes(ref) && tr.textContent.includes('Đã phát lệnh')),
    }), GROUP.primary);
    if (issueState.toast.some((t) => t.includes('tự phát thêm 1 lô ghép cùng xe'))) break;
  }
  check('691 toast names auto-issued sibling ' + GROUP.sibling, issueState.toast.some((t) => t.includes('tự phát thêm 1 lô ghép cùng xe') && t.includes(GROUP.sibling)), JSON.stringify(issueState.toast));
  check('691 primary row ' + GROUP.primary + ' flipped "Đã phát lệnh"', issueState.primaryIssued);
  await page.screenshot({ path: resolve(OUT, '2026-10-29_sil591_ui-detail-cascade-toast.png') });
  say('  screenshot qa/2026-10-29_sil591_ui-detail-cascade-toast.png');

  await page.goto(`${FE}/dispatch-detail?q=${GROUP.sibling}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3800);
  const siblingIssued = await page.evaluate((ref) => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(ref));
    return { found: !!row, issued: !!row && row.textContent.includes('Đã phát lệnh') };
  }, GROUP.sibling);
  check('691 sibling ' + GROUP.sibling + ' row reads "Đã phát lệnh" (cascade)', siblingIssued.found && siblingIssued.issued, JSON.stringify(siblingIssued));
  await page.screenshot({ path: resolve(OUT, '2026-10-29_sil591_ui-detail-sibling-issued.png') });
  say('  screenshot qa/2026-10-29_sil591_ui-detail-sibling-issued.png');
} finally {
  await browser.close();
}

writeFileSync(resolve(OUT, '2026-10-29_sil589-590-591_ui-driver.log'), log.join('\n'), 'utf8');
say(`DONE checks=${checks} fails=${fails.length}`);
if (fails.length > 0) {
  say(`FAILED: ${fails.join(' | ')}`);
  process.exit(1);
}
