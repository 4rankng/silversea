// Card 091026164530 — capture the full accessibility tree of the quick-view
// dialog at 1440 and 390 px, three opens each, to see what a snapshot tool
// (QA's likely method) reports for 'Tổng quan'/'Chi tiết' tablist claims.
// READ-ONLY staging pass as admin.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card091026164530';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-09_${CARD}_axtree-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e).slice(0, 1200)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const cdp = await page.createCDPSession();
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`https://vantai.tingting.vip/shipments?searchSuffix=TEST-LCL-362`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let ready = false;
    for (let i = 0; i < 15 && !ready; i++) {
      await sleep(3000);
      ready = await page.evaluate(() => document.body.innerText.includes('TEST-LCL-362'));
    }
    step('page', { width, ready });
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Mở chi tiết lô hàng'));
        btn?.click();
      });
      await sleep(2500);
      const ax = await cdp.send('Accessibility.getFullAXTree');
      const flat = [];
      const walk = (nodes) => {
        for (const n of nodes) {
          if (n.role?.value) flat.push(`${n.role.value}${n.name?.value ? ` "${n.name.value.slice(0, 40)}"` : ''}`);
          if (n.children) walk(n.children.map((c) => c.node ?? c));
        }
      };
      walk(ax.nodes.filter((n) => !n.parent || !ax.nodes.some((m) => m.children?.some?.((c) => c.node?.nodeId === n.nodeId))) ?? ax.nodes.slice(0, 0));
      // Simpler: map every node's role+name once; dialog subtree via containment is hard in CDP flat tree, so record all tablist/tab/dialog nodes.
      const interesting = ax.nodes
        .filter((n) => ['tablist', 'tab', 'dialog'].includes(n.role?.value ?? ''))
        .map((n) => `${n.role?.value}${n.name?.value ? ` "${n.name.value.replace(/\s+/g, ' ').slice(0, 60)}"` : ''}`);
      step(`open-${width}-${i}`, { tabNodes: interesting, total: ax.nodes.length });
      await page.screenshot({ path: `${QA}/2026-10-09_${CARD}_ax_open${width}_${i}.png` });
      await page.evaluate(() => {
        document.querySelector('aside[role="dialog"] button[aria-label="Đóng"]')?.click();
      });
      await sleep(1500);
    }
  }
  console.log('AXTREE EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('AXTREE FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
