// Summarize qa/role-sweep/report.json into a triage list.
// Usage: cd frontend && node role-ui-sweep-report.mjs [--json] [--role=ops] [--width=390]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), process.env.OUT || '../qa/role-sweep');
const report = JSON.parse(readFileSync(`${OUT}/report.json`, 'utf8'));
const onlyRole = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
const onlyWidth = Number(process.argv.find((a) => a.startsWith('--width='))?.split('=')[1] ?? 0);
const asJson = process.argv.includes('--json');

const rows = [];
for (const [role, data] of Object.entries(report)) {
  if (onlyRole && role !== onlyRole) continue;
  for (const p of data.pages) {
    if (onlyWidth && p.width !== onlyWidth) continue;
    const issues = [];
    if (p.horizontalOverflow > 0) issues.push(`H-SCROLL ${p.horizontalOverflow}px`);
    if (p.width < 600 && p.smallCount) issues.push(`TAP<40 x${p.smallCount}`);
    if (p.clippedCount) issues.push(`CLIP x${p.clippedCount}`);
    if (p.tinyCount) issues.push(`FONT<11 x${p.tinyCount}`);
    if (p.netErrors?.length) issues.push(`NET x${p.netErrors.length}`);
    rows.push({ role, width: p.width, path: p.path, title: p.title, docH: p.docHeight, chromeH: p.chromeH, issues, page: p });
  }
}

if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

// Aggregate: which issue classes hit how many role/page combos.
const byIssue = new Map();
for (const r of rows) for (const i of r.issues) {
  const key = i.split(' ')[0];
  if (!byIssue.has(key)) byIssue.set(key, []);
  byIssue.get(key).push(`${r.role}/${r.width}${r.path}`);
}
console.log('=== issue totals ===');
for (const [k, v] of [...byIssue].sort((a, b) => b[1].length - a[1].length)) console.log(`${k.padEnd(10)} ${v.length}`);

console.log('\n=== per page ===');
for (const r of rows.sort((a, b) => (a.role + a.path).localeCompare(b.role + b.path) || a.width - b.width)) {
  console.log(`${r.role.padEnd(8)} ${String(r.width).padEnd(5)} ${r.path.padEnd(34)} chrome=${String(r.chromeH).padEnd(4)} docH=${String(r.docH).padEnd(5)} ${r.issues.join(' | ')}`);
}

console.log('\n=== clipped details (no-truncation law §4) ===');
for (const r of rows) for (const c of r.page.clipped ?? []) {
  if (c.textOverflow === 'ellipsis' || c.scrollW - c.clientW > 8) {
    console.log(`${r.role}/${r.width}${r.path} :: ${c.el} (${c.clientW}→${c.scrollW})`);
  }
}

console.log('\n=== tap targets <40 on phones ===');
for (const r of rows) {
  if (r.width >= 600) continue;
  for (const s of r.page.small ?? []) console.log(`${r.role}/${r.width}${r.path} :: ${s.el} ${s.w}x${s.h}`);
}

console.log('\n=== <11px text ===');
for (const r of rows) for (const t of r.page.tiny ?? []) console.log(`${r.role}/${r.width}${r.path} :: ${t.el} ${t.fs}px`);

console.log('\n=== console/network errors ===');
for (const r of rows) for (const e of r.page.netErrors ?? []) console.log(`${r.role}/${r.width}${r.path} :: ${e}`);
