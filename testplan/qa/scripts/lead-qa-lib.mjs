// Lead QA rung driver — puppeteer helpers with REAL trusted input + hit-testing.
// Used by per-card rung scripts; mirrors testplan/qa/scripts/input-probe-* patterns.
import puppeteer from 'puppeteer';

export const BASE = process.env.QA_BASE || 'http://localhost:7175';

export async function launch({ width = 1440, height = 900, base = BASE } = {}) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=2600,1800'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument(() => {
    window.__probe = { pointerdown: 0, click: 0, keydown: 0, any: 0, anyPointer: 0 };
    for (const t of ['pointerdown', 'click', 'keydown']) {
      document.addEventListener(t, (e) => {
        window.__probe.any += 1;
        if (t === 'pointerdown') window.__probe.anyPointer += 1;
        if (e.isTrusted) window.__probe[t] += 1;
      }, { capture: true, passive: true });
    }
  });
  return { browser, page, base };
}

export async function login(page, base, user = 'dungnv') {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input', user);
  await (await page.$('input[type="password"]')).type('Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    page.keyboard.press('Enter'),
  ]);
  await new Promise((r) => setTimeout(r, 2500));
}

export async function probe(page) {
  return page.evaluate(() => ({ ...window.__probe }));
}

// Real tap: hit-test at element center, then mouse move → down → up; verify trusted events arrived.
export async function tap(page, selector, { expectEvent = true } = {}) {
  const el = await page.$(selector);
  if (!el) throw new Error(`tap: no element for ${selector}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`tap: no box for ${selector}`);
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const hit = await page.evaluate((x, y) => {
    const e = document.elementFromPoint(x, y);
    return e ? { tag: e.tagName, cls: (e.className || '').toString().slice(0, 60) } : null;
  }, cx, cy);
  const before = await probe(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 600));
  const after = await probe(page);
  if (expectEvent && after.pointerdown <= before.pointerdown) {
    throw new Error(`tap: NO trusted pointer events reached document at ${cx},${cy} (hit=${JSON.stringify(hit)})`);
  }
  return { cx, cy, hit, before, after };
}

export async function typeInto(page, selector, text) {
  const el = await page.$(selector);
  if (!el) throw new Error(`typeInto: no element for ${selector}`);
  await el.focus();
  await page.keyboard.type(text, { delay: 30 });
  await new Promise((r) => setTimeout(r, 400));
}

export async function shot(page, path, { full = true } = {}) {
  await page.screenshot({ path, fullPage: full });
  return path;
}

export async function setViewport(page, width, height) {
  await page.setViewport({ width, height });
  await new Promise((r) => setTimeout(r, 900));
}

// Arm an abort for URL substring, run fn (which navigates), keep abort through settleMs, then disarm.
export async function withAborted(page, urlPart, fn, { settleMs = 9000 } = {}) {
  await page.setRequestInterception(true);
  const handler = (req) => {
    if (req.url().includes(urlPart)) return req.abort().catch(() => {});
    return req.continue().catch(() => {});
  };
  page.on('request', handler);
  try {
    await fn();
    await new Promise((r) => setTimeout(r, settleMs));
  } finally {
    page.off('request', handler);
    await page.setRequestInterception(false);
  }
}

export async function domText(page, sel = 'main') {
  return page.evaluate((s) => (document.querySelector(s) || document.body).innerText.slice(0, 400), sel);
}
