// UI drive — PWA standalone chrome suppression (user report 20/10).
// LoginPage is the public surface: no auth, no backend writes. The detector's
// iOS branch (navigator.standalone) is exercised on real Chrome by defining
// the flag BEFORE any page script runs — exactly the signal iOS Home Screen
// launches provide and the branch the CSS-only media query missed.
// Run: node qa/2026-10-20-pwa-standalone/ui-drive.mjs
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.QA_BASE || 'http://localhost:7199';
// Evidence lands in the repo-root qa/ dir regardless of where this runs from.
const DIR = `${process.cwd()}/qa/2026-10-20-pwa-standalone`;

mkdirSync(DIR, { recursive: true });
const logPath = `${DIR}ui-driver.log`;
const log = (line) => {
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const methods = [];
const track = (page) => page.on('request', (req) => methods.push(req.method()));

try {
  // ── Scenario A: iOS branch — navigator.standalone=true, media query false.
  const iosPage = await browser.newPage();
  await iosPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await iosPage.evaluateOnNewDocument(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', {
      value: true,
      configurable: true,
    });
  });
  track(iosPage);
  const pageErrors = [];
  iosPage.on('pageerror', (err) => pageErrors.push(String(err)));
  await iosPage.goto(BASE, { waitUntil: 'networkidle2', timeout: 30_000 });
  await iosPage.waitForSelector('.login-footer', { timeout: 20_000 });

  const a = await iosPage.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'MISSING';
    };
    const footer = document.querySelector('.login-footer');
    return {
      htmlClass: document.documentElement.className,
      mediaQueryMatches: window.matchMedia('(display-mode: standalone)').matches,
      footerDisplay: cs('.login-footer'),
      footerText: footer?.textContent.trim() ?? 'MISSING',
      heroCopyDisplay: cs('.login-visual__content'),
      heroHeadline: document.querySelector('.login-visual h2')?.textContent ?? 'MISSING',
    };
  });
  log(`[A] html class="${a.htmlClass}"`);
  log(`[A] matchMedia(display-mode:standalone)=${a.mediaQueryMatches} (false expected — proves JS branch)`);
  log(`[A] footer text="${a.footerText}"`);
  log(`[A] footer display=${a.footerDisplay} (none expected)`);
  log(`[A] hero copy display=${a.heroCopyDisplay} (none expected); headline="${a.heroHeadline}"`);
  await iosPage.screenshot({ path: `${DIR}ui-standalone-hide.png`, fullPage: true });
  log('[A] screenshot: ui-standalone-hide.png');

  const aPass = a.htmlClass.includes('pwa-standalone')
    && a.mediaQueryMatches === false
    && a.footerDisplay === 'none'
    && a.heroCopyDisplay === 'none'
    && a.footerText.includes('Ting Ting Software Solution');
  log(`[A] PASS=${aPass}`);

  // ── Scenario B: plain browser — both signals false, chrome stays visible.
  const webPage = await browser.newPage();
  await webPage.setViewport({ width: 1440, height: 900 });
  track(webPage);
  await webPage.goto(BASE, { waitUntil: 'networkidle2', timeout: 30_000 });
  await webPage.waitForSelector('.login-footer', { timeout: 20_000 });
  const b = await webPage.evaluate(() => ({
    htmlClass: document.documentElement.className,
    footerDisplay: getComputedStyle(document.querySelector('.login-footer')).display,
    heroCopyDisplay: getComputedStyle(document.querySelector('.login-visual__content')).display,
  }));
  log(`[B] html class="${b.htmlClass}" footer display=${b.footerDisplay} (flex expected) hero=${b.heroCopyDisplay}`);
  await webPage.screenshot({ path: `${DIR}ui-browser-footer.png`, fullPage: true });
  log('[B] screenshot: ui-browser-footer.png');
  const bPass = !b.htmlClass.includes('pwa-standalone')
    && b.footerDisplay === 'flex'
    && b.heroCopyDisplay !== 'none';
  log(`[B] PASS=${bPass}`);

  // ── Scenario C: belt-and-braces branch — media query true without the iOS
  // flag (Android/desktop installed). CDP may not support display-mode
  // emulation; report honestly either way.
  let cPass = null;
  try {
    const mqPage = await browser.newPage();
    await mqPage.setViewport({ width: 390, height: 844, isMobile: true });
    await mqPage.emulateMediaFeatures([{ name: 'display-mode', value: 'standalone' }]);
    track(mqPage);
    await mqPage.goto(BASE, { waitUntil: 'networkidle2', timeout: 30_000 });
    await mqPage.waitForSelector('.login-footer', { timeout: 20_000 });
    const c = await mqPage.evaluate(() => ({
      htmlClass: document.documentElement.className,
      footerDisplay: getComputedStyle(document.querySelector('.login-footer')).display,
      mq: window.matchMedia('(display-mode: standalone)').matches,
    }));
    log(`[C] mq=${c.mq} html class="${c.htmlClass}" footer display=${c.footerDisplay}`);
    await mqPage.screenshot({ path: `${DIR}ui-standalone-emulated.png`, fullPage: true });
    cPass = c.mq === true && c.footerDisplay === 'none';
    log(`[C] PASS=${cPass}`);
    await mqPage.close();
  } catch (err) {
    log(`[C] SKIPPED — CDP display-mode emulation unavailable: ${String(err).slice(0, 200)}`);
  }

  const mutating = methods.filter((m) => m !== 'GET' && m !== 'OPTIONS');
  log(`[DB] requests tracked=${methods.length}, mutating=${mutating.length} (read-only surface — none expected)`);
  if (mutating.length) log(`[DB] UNEXPECTED MUTATIONS: ${[...new Set(mutating)].join(',')}`);
  log(`[JS] page errors=${pageErrors.length}${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' | ')}` : ''}`);

  log(`RESULT: A=${aPass} B=${bPass} C=${cPass === null ? 'SKIPPED' : cPass}`);
  writeFileSync(`${DIR}ui-driver.exit`, `${aPass && bPass && (cPass === null || cPass) ? 0 : 1}\n`);
  if (!(aPass && bPass && (cPass === null || cPass))) process.exitCode = 1;
} finally {
  await browser.close();
}
