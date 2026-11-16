#!/usr/bin/env node
/**
 * SIL-824 — NÂNG/HẠ 'Cảng VipGreenPort' clip repro driver (READ-ONLY UI drive).
 * Usage: node qa/2026-11-16_sil824-route-clip.mjs <WxH> <open|closed> <tag>
 *   e.g. node qa/2026-11-16_sil824-route-clip.mjs 1920x1080 open before
 * Drives the local dev stack (FE :7175) as admin, /shipments-detail,
 * quick filter Tất cả, then measures every NÂNG/HẠ cell for token clipping.
 */
import { login, DEFAULT_FRONTEND, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import puppeteer from 'puppeteer';

const [, , sizeArg = '1920x1080', sideArg = 'open', tag = 'run'] = process.argv;
const [W, H] = sizeArg.split('x').map(Number);

const MEASURE = () => {
  const out = { mode: null, canvas: null, cells: [], clipCount: 0 };
  const ledger = document.querySelector('.shipment-container-ledger');
  if (!ledger) return { ...out, error: 'no ledger' };
  const table = ledger.querySelector('table');
  const tbody = table?.querySelector('tbody');
  const tbodyDisplay = tbody ? getComputedStyle(tbody).display : null;
  out.mode = tbodyDisplay === 'block' ? 'card' : 'table';
  out.canvas = Math.round(ledger.getBoundingClientRect().width);
  if (out.mode !== 'table') return out;
  const tds = [...table.querySelectorAll("td[data-label='Nâng / hạ']")];
  for (const td of tds) {
    const span = td.querySelector('.shipment-container-ledger__route > span');
    if (!span) continue;
    const text = span.textContent.replace(/^Đóng|^Nâng|^Hạ/, (m) => m);
    // per-line rects
    const range = document.createRange();
    range.selectNodeContents(span);
    const lines = [...range.getClientRects()].filter((b) => b.width > 2).map((b) => ({ y: Math.round(b.y), x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) }));
    // measure the longest WORD in the span (the unbreakable token)
    let tokenW = 0; let tokenText = '';
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent;
      for (const word of t.split(/\s+/)) {
        if (!word) continue;
        const idx = t.indexOf(word);
        const r = document.createRange();
        r.setStart(node, idx); r.setEnd(node, idx + word.length);
        const rect = r.getBoundingClientRect();
        if (rect.width > tokenW) { tokenW = Math.round(rect.width * 10) / 10; tokenText = word; }
      }
    }
    const tdW = Math.round(td.getBoundingClientRect().width * 10) / 10;
    const pad = getComputedStyle(td).paddingInline;
    const spanCW = span.clientWidth;
    const clipped = lines.some((l) => l.right > Math.round(td.getBoundingClientRect().right) - 2);
    const shatter = tokenW > spanCW + 0.5;
    out.cells.push({
      text: span.textContent.slice(0, 40),
      tdW, pad, spanCW,
      tokenW, tokenText,
      clipped, shatter,
      lineCount: lines.length,
      lines,
    });
    if (clipped || shatter) out.clipCount += 1;
  }
  return out;
};

const token = await login('admin', { backend: DEFAULT_BACKEND, frontend: DEFAULT_FRONTEND });

await withSession(token, async (page, ctx) => {
  await page.setViewport({ width: W, height: H });
  await page.goto(`${DEFAULT_FRONTEND}/shipments-detail`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  // quick date filter: Tất cả
  const clicked = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const all = tabs.find((t) => (t.textContent || '').trim() === 'Tất cả');
    if (all) { all.click(); return true; }
    return false;
  });
  await new Promise((r) => setTimeout(r, 1500));
  if (sideArg === 'closed') {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Đóng menu|Thu gọn/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 900));
  }
  const data = await page.evaluate(MEASURE);
  ctx.log.push(`[${tag}] viewport=${W}x${H} sidebar=${sideArg} quickFilterAll=${clicked}`);
  ctx.log.push(`[${tag}] ${JSON.stringify(data)}`);
  await page.screenshot({ path: `${ctx.dir}/sil824-${tag}-${W}-${sideArg}.png`, fullPage: false });
  console.log(JSON.stringify({ tag, viewport: `${W}x${H}`, sidebar: sideArg, data }, null, 1));
}, { viewport: { width: W, height: H }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: `2026-11-16_sil824-${tag}-${W}-${sideArg}` });
