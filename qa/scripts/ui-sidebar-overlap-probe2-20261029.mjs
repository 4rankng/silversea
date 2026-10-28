// SIL-570 probe round 2 — EXPANDED sidebar at 1280×800 + focus-path check:
// does Tab-focus (or programmatic .focus()) on the last nav item translate it
// under the pinned footer? Also measure the expanded rail geometry.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7285';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const measure = (label) => page.evaluate((lbl) => {
    const nav = document.querySelector('.sidebar-nav');
    const user = document.querySelector('.sidebar-user');
    const items = [...document.querySelectorAll('.sidebar-item')];
    const last = items[items.length - 1];
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    nav.scrollTop = nav.scrollHeight;
    return new Promise((res) => setTimeout(() => {
      const userRect = r(user);
      const lastRect = r(last);
      res({
        label: lbl,
        expanded: !document.querySelector('.app')?.className.includes('sidebar-closed'),
        navClientH: nav.clientHeight, navScrollH: nav.scrollHeight, navScrollTop: Math.round(nav.scrollTop),
        user: userRect, last: lastRect,
        lastText: last.textContent.trim().slice(0, 30),
        overlap: lastRect.y < userRect.y + userRect.h && lastRect.y + lastRect.h > userRect.y,
        focusTest: (() => {
          last.focus();
          const after = last.getBoundingClientRect();
          const u = user.getBoundingClientRect();
          return {
            focused: document.activeElement === last,
            yAfterFocus: +after.y.toFixed(1),
            overlapsUserAfterFocus: after.y < u.y + u.h && after.y + after.h > u.y,
          };
        })(),
      });
    }, 300));
  }, label);

  say(JSON.stringify(await measure('collapsed-1280'), null, 1));

  // Expand the sidebar (toggle button) and repeat.
  const toggle = await page.$('.sidebar-toggle-btn, .topbar__toggle, [aria-label*="menu" i], [aria-label*="Menu" i]');
  if (toggle) {
    await toggle.click();
    await new Promise((r) => setTimeout(r, 700));
  }
  say(JSON.stringify(await measure('after-toggle-1280'), null, 1));

  // Keyboard path: shift-focus backwards through the app until focus enters nav.
  const keyPath = await page.evaluate(async () => {
    const nav = document.querySelector('.sidebar-nav');
    const user = document.querySelector('.sidebar-user');
    const items = [...document.querySelectorAll('.sidebar-item')];
    nav.scrollTop = 0;
    // simulate the last item receiving focus via keyboard: focus with preventScroll
    const last = items[items.length - 1];
    last.focus({ preventScroll: true });
    // then the browser-visible geometry without any scroll-into-view
    const u = user.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    return {
      preventScrollY: +b.y.toFixed(1),
      overlapsUser: b.y < u.y + u.h && b.y + b.h > u.y,
      userY: +u.y.toFixed(1),
    };
  });
  say(`focus preventScroll check: ${JSON.stringify(keyPath)}`);

  await page.screenshot({ path: `${OUT}/2026-10-29_sil570_ui-sidebar-1280-probe2.png` });
} finally { await browser.close(); }
writeFileSync(`${OUT}/2026-10-29_sil570_probe2.log`, log.join('\n') + '\n');
