/**
 * Card 071026212510 — the "1 tệp" slot badge, measured in the RUNNING APP.
 *
 * Two previous attempts failed on this card:
 *  1. reasoning from the flexbox spec with nothing rendered (unsound), and
 *  2. a synthetic harness comparing a badge width against a control in a
 *     different layout, which produced a FALSE "space missing" verdict and
 *     nearly became a fake fix.
 *
 * This one settles it inside the real page, where the badge actually is. The
 * control is appended to the SAME document — same stylesheet, same font, same
 * stacking context — in a non-flex inline span, so the only difference between
 * the two strings is whether the space survives. If the badge run is narrower
 * than the control by about one space width, the space is being dropped.
 *
 * Also captures the screen itself, which is the evidence this card was missing.
 *
 * Usage: node card071026212510-live-badge-rung.mjs [base] [driver] [tripId]
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://vantai.tingting.vip';
const DRIVER = process.argv[3] || 'lvlo';
const TRIP_ID = process.argv[4] || '126';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
})).json();
if (!login.token) { log('login-failed', { driver: DRIVER }); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let verdict = 'INCONCLUSIVE';
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);
  await page.goto(`${BASE}/my-trips/${TRIP_ID}/pod`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);

  const health = await (await fetch(`${BASE}/api/health`)).json();
  log('build', { buildHash: health.buildHash, base: BASE });

  const measured = await page.evaluate(() => {
    const badges = [...document.querySelectorAll('.trip-pod__state-ok')]
      .filter((n) => /tệp/i.test(n.textContent || ''));
    const badge = badges[0];
    if (!badge) return { found: false, allStateOk: [...document.querySelectorAll('.trip-pod__state-ok')].map((n) => n.textContent) };

    const text = (badge.textContent || '').trim();      // "1 tệp"
    const cs = getComputedStyle(badge);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const widthOf = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };

    // Controls in the SAME document: same font, same stylesheet, no flex.
    const mk = (txt) => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:pre;';
      s.style.font = font;
      s.textContent = txt;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const withSpace = mk(text);
    const noSpace = mk(text.replace(/\s+/g, ''));

    // The badge's BOX includes padding + icon + flex gap, so comparing it to a
    // bare text span is meaningless — that comparison "passed" once already for
    // the wrong reason. Measure the TEXT RUN inside the badge instead: from the
    // left edge of the first non-whitespace text node to the right edge of the
    // last one.
    const rectOf = (node) => { const r = document.createRange(); r.selectNodeContents(node); return r.getBoundingClientRect(); };
    const textNodes = [...badge.childNodes].filter((n) => n.nodeType === 3 && (n.textContent || '').trim());
    let textRun = null;
    if (textNodes.length) {
      const first = rectOf(textNodes[0]);
      const last = rectOf(textNodes[textNodes.length - 1]);
      textRun = { x: Math.round(first.x * 100) / 100, w: Math.round((last.right - first.x) * 100) / 100, nodes: textNodes.length };
    }

    return {
      found: true,
      badgeText: text,
      badgeChildNodes: [...badge.childNodes].map((n) => (n.nodeType === 3 ? `text:${JSON.stringify(n.textContent)}` : n.nodeName)),
      display: cs.display, gap: cs.gap, font,
      badgeTextRun: textRun,
      badgeBoxWidth: Math.round(widthOf(badge) * 100) / 100,
      controlWithSpace: Math.round(withSpace * 100) / 100,
      controlNoSpace: Math.round(noSpace * 100) / 100,
      oneSpaceWidth: Math.round((withSpace - noSpace) * 100) / 100,
    };
  });

  log('badge', measured);

  if (measured.found && measured.oneSpaceWidth >= 1) {
    // The space is real somewhere in this font/size. If the badge run matches
    // the spaced control, the badge is correct.
    const run = measured.badgeTextRun?.w ?? 0;
    const sp = measured.oneSpaceWidth;
    measured.badgeTextRunVsSpacedControl = Math.round((measured.controlWithSpace - run) * 100) / 100;
    measured.badgeTextRunVsGluedControl = Math.round((measured.controlNoSpace - run) * 100) / 100;
    // Closer to the spaced control than to the glued one => the space renders.
    // The run must land ON the spaced control, not merely above the glued one.
    const matchesSpaced = Math.abs(run - measured.controlWithSpace) < 0.5;
    const matchesGlued = Math.abs(run - measured.controlNoSpace) < 0.5;
    verdict = matchesSpaced && !matchesGlued
      ? 'SPACE PRESENT — the live badge renders "1 tệp" with its space'
      : matchesGlued
        ? 'SPACE MISSING — the live badge run matches the glued control'
        : 'INCONCLUSIVE — the run matches neither control';
    log('verdict', { verdict, badgeTextRun: run, controlWithSpace: measured.controlWithSpace, controlNoSpace: measured.controlNoSpace, oneSpaceWidth: sp });
  } else if (measured.found) {
    verdict = 'INCONCLUSIVE — no measurable space in this font size';
    log('verdict', { verdict });
  } else {
    verdict = 'NO BADGE FOUND — the slot state element is absent';
    log('verdict', { verdict });
  }

  await page.screenshot({ path: `${QA}/212510-live-badge.png`, fullPage: false });
  writeFileSync(`${QA}/212510-live-badge.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
} catch (err) {
  log('driver-error', { message: String((err && err.message) || err).slice(0, 300) });
} finally {
  await browser.close();
}
console.log('FINAL VERDICT:', verdict);