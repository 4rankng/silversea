// Card 071026212510 — lead decision rung on cut 22837bc3 (decision authority
// 08/10). MiniMax needs exactly one thing: a REAL screenshot of the running
// app showing the e-POD slot counter for a DRIVER-owned submission with
// files. Trip 79 (bqhuong) carries lead's uploaded fixture photo. This rung
// opens /my-trips/79/pod as bqhuong, screenshots the 'Phiếu bãi / phiếu hạ'
// slot header, and measures the rendered gap between the count digit and
// 'tệp' via Range rects on the .trip-pod__state-ok badge. Read-only.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card071026212510-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: 'bad3fede' });
if (!String(health.buildHash || '').startsWith('bad3fede')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }
const auth = { Authorization: `Bearer ${token}` };

// Find a trip whose pod submission has files (trip 79 first, then scan).
const trips = await fetch(`${API}/driver/me/trips?limit=20`, { headers: auth }).then((r) => r.json());
const tripList = trips.items ?? trips.trips ?? trips;
log('trips', { n: Array.isArray(tripList) ? tripList.length : Object.keys(trips).slice(0, 10) });
let target = null;
for (const t of (Array.isArray(tripList) ? tripList : []).slice(0, 20)) {
  const id = t.id;
  const det = await fetch(`${API}/driver/me/trips/${id}`, { headers: auth }).then((r) => r.json()).catch(() => null);
  const d = det?.trip ?? det;
  const fid = d?.fulfillmentId ?? d?.fulfillment_id ?? d?.fulfillment?.id;
  if (!fid) continue;
  const pod = await fetch(`${API}/driver/me/fulfillments/${fid}/pod`, { headers: auth }).then((r) => r.json()).catch(() => null);
  const subs = pod?.items ?? [];
  const withFiles = subs.find((s) => (s.files || []).length > 0);
  if (withFiles) { target = { tripId: id, sub: withFiles }; log('target-found', { tripId: id, subId: withFiles.id, files: withFiles.files.length, status: withFiles.status }); break; }
}
if (!target) { log('fixture-FAIL', { why: 'no driver trip with pod files' }); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/my-trips/${target.tripId}/pod`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);

  const scan = await page.evaluate(() => {
    const out = { badges: [], slotHeader: null };
    const hdr = [...document.querySelectorAll('h1,h2,h3,h4,[class*="slot"]')].find((e) => /Phiếu bãi|phiếu hạ/i.test(e.textContent || '') && e.offsetParent !== null);
    out.slotHeader = hdr ? (hdr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null;
    for (const b of [...document.querySelectorAll('.trip-pod__state-ok')].filter((e) => e.offsetParent !== null)) {
      const text = b.textContent || '';
      if (!/tệp/.test(text)) continue;
      const nodes = [];
      for (const n of b.childNodes) {
        if (n.nodeType === 3) {
          const range = document.createRange();
          range.selectNodeContents(n);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
          nodes.push({ kind: 'text', data: n.data, rects: rects.map((r) => ({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top) })) });
        } else nodes.push({ kind: n.tagName?.toLowerCase() || 'node' });
      }
      out.badges.push({ text, codepoints: [...text].map((ch) => ch.codePointAt(0).toString(16)).slice(0, 12).join(' '), nodes });
    }
    return out;
  });
  log('badge-scan', JSON.parse(JSON.stringify(scan)));
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-pod-page.png`, fullPage: false });
  // close-up: scroll badge into view and shoot again
  await page.evaluate(() => { const b = document.querySelector('.trip-pod__state-ok'); if (b) b.scrollIntoView({ block: 'center' }); });
  await sleep(600);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-badge-closeup.png` });

  // Gap between the digit text node and the FIRST GLYPH of 'tệp' — a plain
  // node-to-node rect reads 0 because the unit node's rect swallows its own
  // leading space. Substring range skips the space: gap>0 ⇔ the space glyph
  // actually rendered between the count and the unit.
  const glyph = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.trip-pod__state-ok')].find((e) => e.offsetParent !== null && /tệp/.test(e.textContent || ''));
    if (!b) return { err: 'no badge' };
    // post-fix shape: label is ONE span with a single text node; pre-fix it was
    // loose text children of the flex badge
    const host = b.querySelector('span') ?? b;
    const textNodes = [...host.childNodes].filter((n) => n.nodeType === 3);
    if (textNodes.length === 0) return { err: 'no text nodes', hostTag: host.tagName, structure: [...host.childNodes].map((n) => n.nodeType === 3 ? 'text' : n.tagName) };
    const single = textNodes.length === 1 ? { nodes: textNodes.length, data: (textNodes[0].data || '').slice(0, 20) } : null;
    const digitNode = textNodes.find((n) => /\d/.test(n.data || ''));
    const unitNode = textNodes.filter((n) => /tệp/.test(n.data || '')).pop();
    if (!digitNode || !unitNode) return { err: 'no count/unit nodes', single, structure: textNodes.map((n) => (n.data || '').slice(0, 16)) };
    const rDigit = document.createRange(); const rUnit = document.createRange();
    if (digitNode === unitNode) {
      // single text node "1 tệp": '1' at offset 0-1, space at 1, 't' at 2-3
      rDigit.setStart(digitNode, 0); rDigit.setEnd(digitNode, 1);
      rUnit.setStart(unitNode, 2); rUnit.setEnd(unitNode, 3);
    } else {
      rDigit.selectNodeContents(digitNode);
      rUnit.setStart(unitNode, 1); rUnit.setEnd(unitNode, unitNode.length); // skip leading space
    }
    const d = rDigit.getClientRects()[0], u = rUnit.getClientRects()[0];
    if (!d || !u) return { err: 'no rects' };
    return { digit: { l: Math.round(d.left), r: Math.round(d.right) }, tGlyph: { l: Math.round(u.left), r: Math.round(u.right) }, gapPx: Math.round((u.left - d.right) * 10) / 10, unitNodeWidth: Math.round(u.width), singleTextNode: single };
  });
  log('gap-measure', glyph);
  if (glyph.err) { log('INCONCLUSIVE', glyph); exitCode = 2; }
  else if (glyph.gapPx >= 2) log('PASS-rendered-with-space', { gapPx: glyph.gapPx, note: 'space glyph renders between count and unit — "N tệp", not "Ntệp"' });
  else { log('REPRO-no-space', glyph); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
