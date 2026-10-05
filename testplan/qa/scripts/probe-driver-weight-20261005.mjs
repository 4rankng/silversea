// Card 20261004_356 staging rung — the driver journey card and the trip
// detail bento must show the container weight ("15.000 kg"). Fresh-page
// protocol (input-death days): token-inject, eval navigation only.
// Usage: BASE=https://vantai.tingting.vip IDENTIFIER=bqhuong node <script>
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const API = process.env.API || BASE;
const OUT = process.env.OUT_DIR || 'qa/2026-10-05_card356-staging';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'bqhuong', password: 'Abc123' }) });
if (!login.ok) throw new Error(`API login failed: ${login.status}`);
const { token } = await login.json();
console.log(`API login OK (${process.env.IDENTIFIER || 'bqhuong'})`);
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/my-trips`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(4000);
const cardProbe = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.driver-journey-card')];
  const target = cards.find((c) => c.querySelector('.driver-journey-card__cont-no')) ?? null;
  if (!target) return { found: false, cardCount: cards.length, codes: cards.slice(0, 5).map((c) => c.querySelector('.driver-journey-card__cont-no')?.textContent) };
  return {
    found: true,
    cont: target.querySelector('.driver-journey-card__cont-no')?.textContent,
    type: target.querySelector('.driver-journey-card__cont-type')?.textContent,
    weight: target.querySelector('[data-testid="cont-weight"]')?.textContent ?? null,
  };
});
console.log('card probe:', JSON.stringify(cardProbe));
await page.screenshot({ path: `${OUT}/driver-card-weight.png` });
let detailProbe = { skipped: 'card not found' };
if (cardProbe.found) {
  // Driver cards navigate via handlers, not anchors — and trusted clicks are
  // dead on input-death days. Resolve the trip id from the board API and go
  // directly (fresh load).
  const tripId = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/driver/me/journey-board', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    const card = (json.items ?? []).find((c) => c.containerNumber);
    return card?.tripId ?? null;
  });
  console.log('tripId:', tripId);
  if (tripId) {
    await page.goto(`${BASE}/my-trips/${tripId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(4000);
  }
  const detailUrl = tripId ? `/my-trips/${tripId}` : null;
  await settle(500);
  detailProbe = await page.evaluate(() => {
    const bento = document.querySelector('.dcc-bento__hero-meta');
    return { url: location.pathname, bentoMeta: bento?.textContent?.trim() ?? null, hasWeight: Boolean(bento?.textContent?.includes('kg')) };
  });
  console.log('detail probe:', JSON.stringify(detailProbe), '(link:', detailUrl, ')');
  await page.screenshot({ path: `${OUT}/driver-detail-bento-weight.png` });
}
const verdict = cardProbe.found && cardProbe.weight?.includes('15.000') && detailProbe.hasWeight ? 'WEIGHT SHOWN (card + bento)' : 'CHECK OUTPUT';
console.log('VERDICT:', verdict);
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify({ cardProbe, detailProbe, verdict }, null, 2));
await browser.close();
