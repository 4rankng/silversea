import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.env.PHASE ?? 'after';
const USERNAME = process.env.DRIVER_USER ?? 'bqhuong'; // bqhuong per brief, dvthuc has 15H-021.39
const FRONT = process.env.FRONT_URL ?? 'http://localhost:7175';
const API = process.env.API_URL ?? 'http://localhost:3002/api';
const OUT = path.resolve(`qa/2026-11-03_sil670/${PHASE}`);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `ui-driver.log`);

const log = (msg) => {
  console.log(msg);
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
};

log(`=== Running probe PHASE=${PHASE} USER=${USERNAME} ===`);

// Login
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USERNAME, password: 'Abc123' }),
});
const loginData = await loginRes.json();
if (!loginData.token) {
  log(`Login failed: ${JSON.stringify(loginData)}`);
  process.exit(1);
}
log(`Login successful for ${USERNAME}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

async function measureViewport(width, height, label) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  // Token injection before navigation
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('token', t), loginData.token);

  await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('header.topbar.topbar--driver', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1000));

  // Measure header
  const data = await page.evaluate(() => {
    const header = document.querySelector('header.topbar.topbar--driver');
    if (!header) return null;
    const rect = header.getBoundingClientRect();
    const computed = window.getComputedStyle(header);

    const left = header.querySelector('.topbar__left-driver');
    const center = header.querySelector('.topbar__center-driver');
    const actions = header.querySelector('.topbar__actions');
    const bellBtn = header.querySelector('.notif-bell__btn');
    const badge = header.querySelector('.notif-bell__btn .badge');
    const monthTrigger = header.querySelector('.topbar-date__trigger');

    const getBox = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        top: s.top,
        position: s.position,
      };
    };

    return {
      headerRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      headerStyles: {
        height: computed.height,
        minHeight: computed.minHeight,
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
        gap: computed.gap,
        rowGap: computed.rowGap,
        alignItems: computed.alignItems,
      },
      leftBox: getBox(left),
      centerBox: getBox(center),
      actionsBox: getBox(actions),
      bellBtnBox: getBox(bellBtn),
      badgeBox: getBox(badge),
      monthTriggerBox: getBox(monthTrigger),
    };
  });

  log(`Viewport ${label} (${width}x${height}):`);
  log(`  Header height: ${data?.headerRect?.height}px (computed: ${data?.headerStyles?.height})`);
  log(`  Header padding: top=${data?.headerStyles?.paddingTop}, bottom=${data?.headerStyles?.paddingBottom}, left=${data?.headerStyles?.paddingLeft}, right=${data?.headerStyles?.paddingRight}`);
  log(`  Left box height: ${data?.leftBox?.height}px`);
  log(`  Center box height: ${data?.centerBox?.height}px`);
  log(`  Actions box height: ${data?.actionsBox?.height}px`);
  log(`  Bell button height: ${data?.bellBtnBox?.height}px, y=${data?.bellBtnBox?.y}`);
  log(`  Badge height: ${data?.badgeBox?.height}px, y=${data?.badgeBox?.y}, top=${data?.badgeBox?.top}`);
  log(`  Month trigger height: ${data?.monthTriggerBox?.height}px`);

  // Screenshot header
  const screenshotPath = path.join(OUT, `screenshot-${label}.png`);
  await page.screenshot({ path: screenshotPath });
  log(`  Saved screenshot: ${screenshotPath}`);

  // Test notification bell dropdown click
  const bellSelector = '.notif-bell__btn';
  await page.waitForSelector(bellSelector);
  await page.click(bellSelector);
  await new Promise((r) => setTimeout(r, 500));

  const dropdownOpen = await page.evaluate(() => {
    const panel = document.querySelector('.notif-panel');
    return !!panel;
  });
  log(`  Notification dropdown opened: ${dropdownOpen}`);

  const dropdownScreenshot = path.join(OUT, `screenshot-${label}-dropdown.png`);
  await page.screenshot({ path: dropdownScreenshot });
  log(`  Saved dropdown screenshot: ${dropdownScreenshot}`);

  // Close notification dropdown with Escape
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));

  // Test Month picker click
  const monthSelector = '.topbar-date__trigger';
  await page.waitForSelector(monthSelector);
  await page.click(monthSelector);
  await new Promise((r) => setTimeout(r, 500));

  const monthPickerOpen = await page.evaluate(() => {
    const picker = document.querySelector('.month-picker');
    return !!picker;
  });
  log(`  Month picker opened: ${monthPickerOpen}`);

  const monthScreenshot = path.join(OUT, `screenshot-${label}-monthpicker.png`);
  await page.screenshot({ path: monthScreenshot });
  log(`  Saved month picker screenshot: ${monthScreenshot}`);

  await page.close();
  return data;
}

const data1440 = await measureViewport(1440, 900, '1440');
const data390 = await measureViewport(390, 844, '390');

fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ data1440, data390 }, null, 2));

await browser.close();
log('Probe complete.');
