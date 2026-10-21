// DIS-08 lan-2 probe v3 — is the 600 face of Be Vietnam Pro ACTUALLY available
// at render time on staging? If the face is missing, computed font-weight stays
// 600 but glyphs render with the nearest face — visually NOT bold.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const OUT = path.resolve('qa/2026-10-21-dis08-lan2');

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login -> ${res.status}`);
  return (await res.json()).token;
};
const token = await login(process.env.QA_USER || 'dungnv');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2000);

  const fontReport = await page.evaluate(async () => {
    await document.fonts.ready;
    const check600 = document.fonts.check('600 12px "Be Vietnam Pro"');
    const check400 = document.fonts.check('400 12px "Be Vietnam Pro"');
    const check700 = document.fonts.check('700 12px "Be Vietnam Pro"');
    const faces = [];
    document.fonts.forEach((f) => faces.push(`${f.family} ${f.weight} ${f.style} ${f.status}`));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const probe = 'MEDU1234567';
    const widthAt = (w) => { ctx.font = `${w} 16px "Be Vietnam Pro"`; return Math.round(ctx.measureText(probe).width * 100) / 100; };
    return {
      check600, check400, check700,
      width400: widthAt(400), width500: widthAt(500), width600: widthAt(600), width700: widthAt(700),
      loadedFaces: faces.slice(0, 12),
      fontURLs: Array.from(document.styleSheets).length,
    };
  });
  console.log(JSON.stringify(fontReport, null, 2));
  fs.writeFileSync(path.join(OUT, 'staging-font-probe.json'), JSON.stringify(fontReport, null, 2));

  // Which font URLs does the page actually load?
  const fontReqs = [];
  page.on('response', (r) => { if (/\.ttf|\.woff2?|fonts/i.test(r.url())) fontReqs.push({ url: r.url().split('/').slice(-2).join('/'), status: r.status() }); });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2000);
  console.log(JSON.stringify({ fontRequests: fontReqs }, null, 2));
  fs.writeFileSync(path.join(OUT, 'staging-font-requests.json'), JSON.stringify(fontReqs, null, 2));
} finally {
  await browser.close();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
