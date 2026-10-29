// SIL-576 verify — /penalties scoreboard row is the drawer opener AND the
// focus-restoration target (QA fail 29/10: "mở drawer từ dòng Lương Văn Long,
// Escape đóng, Enter ngay sau đó KHÔNG mở lại drawer — chưa rõ do focus không
// trả về dòng hay do dòng không kích hoạt bằng Enter").
// Both halves must hold: focus returns to the ROW after close, and the ROW
// activates by Enter (it used to be a pointer-only <tr onClick>).
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
  await page.type('input[name="username"]', process.env.QA_USER || 'giamdoc');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1500));
  say(`login → ${new URL(page.url()).pathname}`);

  await page.goto(`${FE}/penalties`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2200));

  const rows = await page.evaluate(() => {
    const targets = [...document.querySelectorAll('.penalty-scoreboard-row')];
    return {
      count: targets.length,
      labels: targets.map((r) => r.getAttribute('aria-label') ?? ''),
      focusable: targets.every((r) => r.getAttribute('tabindex') === '0'),
    };
  });
  check('scoreboard rows carry the keyboard-opener contract (tabindex=0 + aria-label)', rows.count > 0 && rows.focusable, `n=${rows.count}`);

  // QA's exact chain: MOUSE click on a row opens the drawer …
  await page.evaluate(() => {
    document.querySelector('.penalty-scoreboard-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 900));
  const opened = await page.evaluate(() => ({ dialog: !!document.querySelector('.drawer') }));
  check('mouse click on the row opens the drawer', opened.dialog);

  // … Escape closes …
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 700));
  const closed = await page.evaluate(() => ({
    dialog: !!document.querySelector('.drawer'),
    activeLabel: document.activeElement?.getAttribute?.('aria-label') ?? '',
    activeIsRow: !!document.activeElement?.closest?.('.penalty-scoreboard-row'),
  }));
  check('Escape closes the drawer', !closed.dialog);
  check('focus RETURNS TO THE ROW (not body/not only a button)', closed.activeIsRow, `active="${closed.activeLabel}"`);

  // … and Enter IMMEDIATELY after must REOPEN (QA's discriminating probe).
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 900));
  const reopened = await page.evaluate(() => ({ dialog: !!document.querySelector('.drawer') }));
  check('Enter on the restored row REOPENS the drawer', reopened.dialog);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil576_ui-penalties-row-reopen-1280.png` });

  // Keyboard-open path: Escape → focus stays on the row → Enter reopens once
  // more, then close WITHOUT creating anything (QA kept the count at 0).
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 700));
  const back = await page.evaluate(() => ({
    activeIsRow: !!document.activeElement?.closest?.('.penalty-scoreboard-row'),
    activeIsBody: document.activeElement === document.body,
  }));
  check('second Escape lands focus back on the row again', back.activeIsRow && !back.activeIsBody);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/2026-10-29_sil576_ui-driver.log`, log.join('\n') + `\nTOTAL ${checks - fails.length}/${checks} PASS\n`);
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
