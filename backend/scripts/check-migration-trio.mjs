#!/usr/bin/env node
// check-migration-trio.mjs — journal/sql/snapshot coherence gate for hand-landed
// migration trios (card 20260924_7 interim, Director-approved 2026-09-24).
// Read-only. Exit 0 = HARD clean; exit 1 = HARD violation (or CHAIN under --strict).
//
// Usage (from backend/):
//   node scripts/check-migration-trio.mjs             # repo-local checks
//   DATABASE_URL=postgres://... node scripts/check-migration-trio.mjs
//                                                     # + applied hash-chain check
//   node scripts/check-migration-trio.mjs --strict    # CHAIN debt fails too

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const drizzleDir = join(backendDir, 'drizzle');
const metaDir = join(drizzleDir, 'meta');
const journalPath = join(metaDir, '_journal.json');
const strict = process.argv.includes('--strict');

const hard = [];
const chain = [];

// ── Load journal ────────────────────────────────────────────────────────────
let entries;
try {
  entries = JSON.parse(readFileSync(journalPath, 'utf8')).entries ?? [];
} catch (err) {
  console.error('FATAL: journal unreadable: %s', err.message);
  process.exit(1);
}
if (entries.length === 0) {
  console.error('FATAL: journal has no entries');
  process.exit(1);
}

// ── HARD: journal internal consistency ──────────────────────────────────────
{
  const seenIdx = new Set();
  const seenTag = new Set();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (seenIdx.has(e.idx)) hard.push(`duplicate journal idx ${e.idx} (${e.tag})`);
    if (seenTag.has(e.tag)) hard.push(`duplicate journal tag ${e.tag}`);
    seenIdx.add(e.idx);
    seenTag.add(e.tag);
    if (i > 0 && e.when <= entries[i - 1].when) {
      hard.push(`journal when not strictly increasing at idx ${e.idx} (${e.tag})`);
    }
  }
}

// ── HARD: journal/sql both directions (920a2078 desync class) ───────────────
{
  for (const e of entries) {
    if (!existsSync(join(drizzleDir, `${e.tag}.sql`))) {
      hard.push(`idx ${e.idx} tag ${e.tag}: drizzle/${e.tag}.sql missing`);
    }
  }
  const journaledTags = new Set(entries.map((x) => x.tag));
  for (const f of readdirSync(drizzleDir)) {
    if (!f.endsWith('.sql')) continue;
    if (!journaledTags.has(f.replace(/\.sql$/, ''))) {
      hard.push(`sql without journal entry: drizzle/${f} — shipped-but-unjournaled ` +
        'silently skips the migration on fresh envs');
    }
  }
}

// ── CHAIN: snapshot coverage, orphans, dup ids, fan-out ─────────────────────
{
  const snapFiles = readdirSync(metaDir).filter((f) => f.endsWith('_snapshot.json'));
  const resolve = (tag) => {
    const ts = tag.split('_')[0];
    if (snapFiles.includes(`${tag}_snapshot.json`)) return `${tag}_snapshot.json`;
    if (snapFiles.includes(`${ts}_snapshot.json`)) return `${ts}_snapshot.json`;
    return null;
  };
  const expected = new Set();
  for (const e of entries) {
    const file = resolve(e.tag);
    if (file == null) {
      chain.push(`no snapshot file for journal tag ${e.tag}`);
    } else {
      expected.add(file);
    }
  }
  for (const f of snapFiles) {
    if (!expected.has(f)) {
      chain.push(`orphan snapshot: drizzle/meta/${f} — second chain-head candidate`);
    }
  }
  const idTo = new Map();
  const prevTo = new Map();
  for (const f of snapFiles) {
    const snap = JSON.parse(readFileSync(join(metaDir, f), 'utf8'));
    if (idTo.has(snap.id)) {
      chain.push(`duplicate snapshot id ${snap.id}: ${idTo.get(snap.id)} <-> ${f}`);
    } else {
      idTo.set(snap.id, f);
    }
    const k = snap.prevId;
    if (!prevTo.has(k)) prevTo.set(k, []);
    prevTo.get(k).push(f);
  }
  for (const [prev, files] of prevTo) {
    if (files.length > 1) {
      chain.push(`fan-out: ${files.length} snapshots with prevId ${prev} — ` +
        `drizzle-kit parent collision: ${files.join(', ')}`);
    }
  }
}

// ── DB mode: applied hash chain vs sha256(sql), in journal idx order ───────
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (process.env.DATABASE_URL) {
  const { default: postgres } = await import('postgres');
  const conn = postgres(process.env.DATABASE_URL, { max: 1 });
  const rows = await conn`select hash, created_at from drizzle.__drizzle_migrations order by created_at asc`;
  await conn.end();
  let verified = 0;
  const warns = [];
  const seenWhen = new Set();
  for (const e of entries) {
    const atWhen = rows.filter((r) => String(r.created_at) === String(e.when));
    const digest = sha(join(drizzleDir, `${e.tag}.sql`));
    if (atWhen.length === 0) {
      const byHash = rows.some((r) => r.hash === digest);
      if (!byHash) {
        hard.push(`DB: ${e.tag} has no applied row (no row at its when, none by hash) — ` +
          'silently skipped migration');
      } else {
        warns.push(`${e.tag}: applied but its when (${e.when}) has no row — journal was ` +
          'restamped after apply (tracking desync)');
      }
    } else {
      if (atWhen.length > 1) warns.push(`${e.tag}: applied ${atWhen.length}x`);
      const appliedDigest = atWhen[0].hash;
      if (appliedDigest !== digest) {
        warns.push(`${e.tag}: applied content differs from current sql bytes ` +
          '(file edited post-apply, or manual marker row)');
      } else {
        verified += 1;
      }
    }
    seenWhen.add(String(e.when));
  }
  for (const r of rows) {
    if (!seenWhen.has(String(r.created_at))) {
      warns.push(`row at ${r.created_at} matches no journal when — orphan tracking row`);
    }
  }
  for (const w of warns) console.error('  [DB] ' + w);
  console.log(`applied hash chain: ${verified}/${entries.length} journal entries verified against env DB`);
}

// ── Summary + exit ──────────────────────────────────────────────────────────
console.log('');
console.log('HARD violations: %d', hard.length);
for (const h of hard) console.log('  [HARD] ' + h);
console.log('CHAIN violations: %d', chain.length);
for (const c of chain) console.log('  [CHAIN] ' + c);
if (hard.length > 0 || (strict && chain.length > 0)) {
  process.exit(1);
}
console.log('RESULT: HARD clean%s', strict ? '' : ' (CHAIN debt reported, not gating)');
process.exit(0);
