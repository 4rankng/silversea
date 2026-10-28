// SIL-570 probe — collapsed sidebar: where does the last nav item sit relative
// to the pinned .sidebar-user footer at 1280×800 / 1024×768, and what does a
// click at the footer center actually hit?
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

  const measure = () => page.evaluate(() => {
    const nav = document.querySelector('.sidebar-nav');
    const footer = document.querySelector('.sidebar-footer');
    const user = document.querySelector('.sidebar-user');
    const items = [...document.querySelectorAll('.sidebar-item')];
    const last = items[items.length - 1];
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const footerRect = r(footer);
    const userRect = r(user);
    const lastRect = last ? r(last) : null;
    const overlap = lastRect && lastRect.y < userRect.y + userRect.h && lastRect.y + lastRect.h > userRect.y;
    const navStyle = getComputedStyle(nav);
    return {
      appClosed: document.querySelector('.app')?.className.includes('sidebar-closed'),
      nav: { ...r(nav), overflowY: navStyle.overflowY, paddingTop: navStyle.paddingTop, paddingBottom: navStyle.paddingBottom, scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight },
      footer: footerRect, user: userRect, lastItem: lastRect,
      lastItemText: last?.textContent?.trim().slice(0, 40),
      lastItemVisible: last ? getComputedStyle(last).visibility : null,
      overlapWithUser: overlap,
      hitAtFooterCenter: (el) => el,
      elementAtFooterCenter: (() => { const b = footer.getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : 'none'; })(),
    };
  });

  say(`@1280 before scroll: ${JSON.stringify(await measure(), null, 1)}`);
  await page.evaluate(() => { const nav = document.querySelector('.sidebar-nav'); nav.scrollTop = nav.scrollHeight; });
  await new Promise((r) => setTimeout(r, 400));
  say(`@1280 after scroll-to-bottom: ${JSON.stringify(await measure(), null, 1)}`);

  await page.setViewport({ width: 1024, height: 768 });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => { const nav = document.querySelector('.sidebar-nav'); nav.scrollTop = nav.scrollHeight; });
  await new Promise((r) => setTimeout(r, 400));
  say(`@1024 after scroll-to-bottom: ${JSON.stringify(await measure(), null, 1)}`);

  await page.screenshot({ path: `${OUT}/2026-10-29_sil570_ui-sidebar-1024-probe.png` });
} finally { await browser.close(); }
writeFileSync(`${OUT}/2026-10-29_sil570_probe.log`, log.join('\n') + '\n');
