import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require2('puppeteer');

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-19_181026180300_ui-driver.log');

const LOG = [];
let exitCode = 0;
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const fail = (step, obj = {}) => {
  exitCode = 1;
  log(step, { verdict: 'FAIL', ...obj });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    // 1. Health check
    const healthRes = await fetch(`${API}/health`);
    log('health', { status: healthRes.status });
    if (!healthRes.ok) { fail('health'); process.exit(2); }

    // 2. Auth login
    let token = null;
    let who = null;
    for (const identifier of ['cus', 'thanhdc', 'admin']) {
      for (const password of ['Abc123', 'admin123']) {
        try {
          const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password }),
          });
          if (res.ok) {
            token = (await res.json()).token;
            who = identifier;
            break;
          }
        } catch {
          // ignore error and try next
        }
      }
      if (token) break;
    }
    log('login', { user: who, ok: Boolean(token) });
    if (!token) { fail('login'); process.exit(2); }

    // 3. Launch browser
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    // Inject token into localStorage before page loads
    await page.evaluateOnNewDocument(
      (t, o) => { if (location.origin === o) localStorage.setItem('token', t); },
      token,
      new URL(BASE).origin,
    );

    // 4. Navigate to /shipments/new
    log('navigate', { url: `${BASE}/shipments/new` });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(1000);

    // Wait for the workspace to mount
    await page.waitForSelector('.csc-topline', { timeout: 10000 });

    // 5. Verification (1): On initial page open, panel is completely HIDDEN
    const initialSummary = await page.evaluate(() => {
      const el = document.querySelector('.csc-validation-summary');
      const textMatches = Array.from(document.body.querySelectorAll(':not(script):not(style)'))
        .filter((n) => n.children.length === 0 && (n.textContent || '').includes('Cần bổ sung'));
      const aside = document.querySelector('.csc-summary');
      return {
        hasSummaryElement: Boolean(el),
        matchingTextNodesCount: textMatches.length,
        hasAside: Boolean(aside),
        asideHTML: aside ? aside.outerHTML : null,
      };
    });

    log('evidence-1-pristine-state', initialSummary);

    if (initialSummary.hasSummaryElement || initialSummary.matchingTextNodesCount > 0) {
      fail('evidence-1', { error: 'Panel or text Cần bổ sung is visible on pristine page load' });
    } else {
      log('evidence-1-pass', { message: 'Trang mới mở không thấy panel (hoàn toàn ẩn)' });
    }

    const shot1Path = path.join(OUT, '2026-10-19_181026180300_ui-1-pristine-hidden.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    log('screenshot-1-saved', { path: shot1Path });

    // 6. Click "Tạo lô hàng" button
    log('click-create-button', { selector: '.csc-topline button' });
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.csc-topline button'));
      const createBtn = buttons.find((b) => (b.textContent || '').trim().includes('Tạo lô hàng'));
      if (createBtn) {
        createBtn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      fail('click-create', { error: 'Could not find Tạo lô hàng button in topline' });
    } else {
      log('clicked-create-button', { ok: true });
    }

    await sleep(500);

    // 7. Verification (2): Panel appears as compact neutral card under header
    await page.waitForSelector('.csc-validation-summary', { timeout: 5000 });

    const cardDetails = await page.evaluate(() => {
      const card = document.querySelector('.csc-validation-summary');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(card);
      const title = card.querySelector('.csc-validation-summary__title');
      const titleStyle = title ? window.getComputedStyle(title) : null;
      const items = Array.from(card.querySelectorAll('ol li')).map((li) => li.textContent?.trim());

      return {
        exists: true,
        role: card.getAttribute('role'),
        text: card.textContent?.trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        maxWidth: style.maxWidth,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        color: style.color,
        titleColor: titleStyle ? titleStyle.color : null,
        itemsCount: items.length,
        items: items.slice(0, 5),
      };
    });

    log('evidence-2-card-inspection', cardDetails);

    // Assertions for card
    if (!cardDetails) {
      fail('evidence-2', { error: 'Card .csc-validation-summary did not appear after submit' });
    } else {
      // Check neutral background: should be white rgb(255, 255, 255)
      const isNeutralBg = cardDetails.backgroundColor === 'rgb(255, 255, 255)';
      // Check compact width: width should be bounded around 520px or less, definitely < 600px
      const isCompact = cardDetails.width <= 540;
      const hasCorrectRole = cardDetails.role === 'alert';
      const hasItems = cardDetails.itemsCount > 0;

      log('evidence-2-checks', {
        isNeutralBg,
        isCompact,
        hasCorrectRole,
        hasItems,
        backgroundColor: cardDetails.backgroundColor,
        width: cardDetails.width,
        maxWidth: cardDetails.maxWidth,
      });

      if (!isNeutralBg) {
        fail('evidence-2-neutral-bg', { actualBg: cardDetails.backgroundColor });
      }
      if (!isCompact) {
        fail('evidence-2-compact-width', { actualWidth: cardDetails.width });
      }
      if (!hasCorrectRole) {
        fail('evidence-2-role', { actualRole: cardDetails.role });
      }
      if (!hasItems) {
        fail('evidence-2-items', { actualCount: cardDetails.itemsCount });
      }
    }

    const shot2Path = path.join(OUT, '2026-10-19_181026180300_ui-2-click-create-neutral-card.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    log('screenshot-2-saved', { path: shot2Path });

    // 8. Mobile viewport verification (390px)
    await page.setViewport({ width: 390, height: 844 });
    await sleep(400);

    const mobileDetails = await page.evaluate(() => {
      const card = document.querySelector('.csc-validation-summary');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        fitsViewport: rect.width <= 390 && rect.right <= 390,
      };
    });
    log('evidence-3-mobile-inspection', mobileDetails);

    const shot3Path = path.join(OUT, '2026-10-19_181026180300_ui-3-mobile-card.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    log('screenshot-3-saved', { path: shot3Path });

    await browser.close();

    log('summary', {
      exitCode,
      verdict: exitCode === 0 ? 'PASS' : 'FAIL',
      artifacts: [shot1Path, shot2Path, shot3Path, LOG_PATH],
    });
  } catch (err) {
    fail('unhandled-exception', { message: err.message, stack: err.stack });
  } finally {
    fs.writeFileSync(LOG_PATH, LOG.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    console.log(`Driver log written to ${LOG_PATH} with exit code ${exitCode}`);
    process.exit(exitCode);
  }
})();
