// Lead QA harness — shared helpers for the post-cut staging rungs (2026-10-08).
// Per-card rungs import these; every assertion tap is a REAL mouse event chain.
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const BASE = process.env.QA_BASE ?? 'https://vantai.tingting.vip';
export const WIDTHS = [1280, 1440, 1920, 2560];

export function evidenceDir(slug) {
  const dir = `testplan/qa/evidence/2026-10-08_${slug}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function step(logPath, entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(logPath, line + '\n');
  console.log(line);
}

export async function launch({ width = 1440, height = 900 } = {}) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  return { browser, page };
}

/** Real UI login (never token-inject — the login flow itself is part of the run). */
export async function login(page, username, password = 'Abc123') {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input[name="username"]', username, { delay: 8 });
  await page.type('input[name="password"]', password, { delay: 8 });
  const btn = await page.$('button[type="submit"]');
  const bb = await btn.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
}

/** Real mouse tap with hit-test — the only tap form valid as QA evidence. */
export async function tap(page, selector, logPath, what) {
  const el = await page.$(selector);
  if (!el) throw new Error(`tap target missing: ${selector}`);
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 250));
  const bb = await el.boundingBox();
  const x = bb.x + bb.width / 2;
  const y = bb.y + bb.height / 2;
  const hit = await page.evaluate(
    ({ x, y }) => {
      const n = document.elementFromPoint(x, y);
      return n ? n.tagName + '.' + (n.className || '') : null;
    },
    { x, y },
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  step(logPath, { step: 'tap', what, selector, x: Math.round(x), y: Math.round(y), hit });
}

/** Hover (for disabled-action tooltips) + optional keyboard focus — both reveal paths. */
export async function hoverAndFocus(page, selector, logPath, what) {
  const el = await page.$(selector);
  if (!el) throw new Error(`hover target missing: ${selector}`);
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 250));
  const bb = await el.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await new Promise((r) => setTimeout(r, 350));
  await el.evaluate((n) => n.focus());
  await new Promise((r) => setTimeout(r, 250));
  step(logPath, { step: 'hover+focus', what, selector });
}

export async function shot(page, path) {
  await page.screenshot({ path, fullPage: true });
}

export function watchNet(page, logPath) {
  const fails = [];
  page.on('response', (r) => {
    if (r.status() >= 400) fails.push(`${r.status()} ${r.url().slice(-80)}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') step(logPath, { step: 'console-error', text: m.text().slice(0, 160) });
  });
  return fails;
}
