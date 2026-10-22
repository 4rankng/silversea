#!/usr/bin/env node
/**
 * 2026-10-23 LCL day-filter repro/verify — card 231026000252 (ticket 261022201006b).
 *
 * Law under test (the same on BOTH CUS surfaces, Tổng quan + Chi tiết):
 *   - undated (no transport day at all)          -> ALWAYS visible, any filter;
 *   - dated (appointment or lot transportDate)   -> must pass the date filter.
 *
 * Case matrix (fixtures, each scoped by its own BL prefix so "0 kết quả" is exact):
 *   LCL-DATED-IN   LCL fixture transportDate=2026-10-17, filter 17/10..17/10 -> present BOTH surfaces
 *   LCL-DATED-OUT  SAME fixture, filter 23/10..23/10                          -> 0 results BOTH surfaces
 *   LCL-UNDATED    LCL fixture with NO transportDate                          -> present BOTH surfaces
 *                                                         under 23/10, 17/10 AND bare
 *   SYNC           per filter the fixture sets on Tổng quan == Chi tiết
 *                  (LCL-01 goal kept: overview/detail never disagree)
 *   REAL-LOT       booking K547238574983 (transportDate=2026-10-17) raw JSON
 *                  saved per surface x filter -> qa/2026-10-23-filter-lcl-day/
 *
 * Run (from anywhere; paths resolve off the repo root):
 *   BACKEND="$BE_URL" RUN_LABEL=before \
 *     node testplan/qa/scripts/2026-10-23-lcl-dayfilter-repro.mjs
 *   BACKEND="$BE_URL" RUN_LABEL=after \
 *     node testplan/qa/scripts/2026-10-23-lcl-dayfilter-repro.mjs
 *
 * BEFORE the fix the dated-out / undated / SYNC checks fail (that IS the repro);
 * AFTER the fix every check must pass. Exit 1 on any failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { login, api } from '../../../scripts/lib/http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_DIR = path.join(ROOT, 'qa', '2026-10-23-filter-lcl-day');
const BACKEND = process.env.BACKEND ?? 'http://localhost:3002/api';
const LABEL = process.env.RUN_LABEL ?? 'after';
const REAL_LOT = 'K547238574983'; // booking / billOrBookNumber, transportDate=2026-10-17

const stamp = String(Date.now()).slice(-8);
// Distinct BL prefixes so each fixture query is exactly one lot ("0 kết quả" literal).
const BL_DATED = `LDAYD${stamp}`; // LCL dated 2026-10-17
const BL_UNDATED = `LDAYU${stamp}`; // LCL undated (no transportDate)

const FILTERS = [
  { name: '23/10..23/10', from: '2026-10-23', to: '2026-10-23' },
  { name: '17/10..17/10', from: '2026-10-17', to: '2026-10-17' },
  { name: 'bare', from: undefined, to: undefined },
];

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const findHits = (body, needle) => {
  const rows = body?.items ?? body?.rows ?? body?.data?.items ?? body?.data ?? [];
  return Array.isArray(rows) ? rows.filter((r) => JSON.stringify(r).includes(needle)) : [];
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`# LCL day-filter repro — ${LABEL} — backend ${BACKEND} — stamp ${stamp}`);

  const tok = await login('admin', { backend: BACKEND });

  // ---- fixtures: one dated LCL lot (mirror of the real lot), one undated LCL lot ----
  for (const [bl, expectedDeliveryDate] of [
    [BL_DATED, '2026-10-17'],
    [BL_UNDATED, undefined],
  ]) {
    const created = await api(tok, 'POST', '/shipments', {
      customerId: 2,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: bl,
      packageType: 'BAG',
      packageCount: 5,
      cargoWeightKg: 500,
      ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
    }, { backend: BACKEND, headers: { 'Idempotency-Key': randomUUID() } });
    if (created.status !== 201 && created.status !== 200) {
      throw new Error(`create ${bl} -> ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
    }
    console.log(`fixture created: ${bl} transportDate=${expectedDeliveryDate ?? 'NULL'}`);
  }

  // ---- surface x filter matrix, scoped per fixture / real lot ----
  const matrix = {}; // matrix[needle][surface][filterName] = body
  for (const needle of [BL_DATED, BL_UNDATED, REAL_LOT]) {
    matrix[needle] = { tongquan: {}, chitiet: {}, core: {} };
    for (const f of FILTERS) {
      const q = { searchSuffix: needle, transportDateFrom: f.from, transportDateTo: f.to };
      matrix[needle].tongquan[f.name] = (
        await api(tok, 'GET', '/shipments/cus-workspace', undefined, { backend: BACKEND, query: q })
      ).data;
      matrix[needle].chitiet[f.name] = (
        await api(tok, 'GET', '/shipments/cus-workspace/containers', undefined, { backend: BACKEND, query: q })
      ).data;
      // sibling consumer of the same lot-level law: dispatch master-plan (core.routes)
      matrix[needle].core[f.name] = (
        await api(tok, 'GET', '/shipments', undefined, {
          backend: BACKEND,
          query: {
            q: needle,
            deliveryDateFrom: f.from,
            deliveryDateTo: f.to,
          },
        })
      ).data;
    }
  }

  // ---- LCL-DATED-IN: dated fixture visible under 17/10 on both surfaces ----
  for (const surface of ['tongquan', 'chitiet', 'core']) {
    const hits = findHits(matrix[BL_DATED][surface]['17/10..17/10'], BL_DATED);
    check(`LCL-DATED-IN filter 17/10 on ${surface}`, hits.length >= 1, `${hits.length} row(s)`);
  }

  // ---- LCL-DATED-OUT: dated fixture ABSENT under 23/10 on both surfaces (THE FIX) ----
  for (const surface of ['tongquan', 'chitiet', 'core']) {
    const body = matrix[BL_DATED][surface]['23/10..23/10'];
    const hits = findHits(body, BL_DATED);
    check(
      `LCL-DATED-OUT filter 23/10 -> 0 ket qua on ${surface}`,
      hits.length === 0,
      `${hits.length} row(s), total=${body?.total ?? '?'}`,
    );
  }

  // ---- LCL-UNDATED: undated fixture visible under EVERY filter on both surfaces ----
  for (const surface of ['tongquan', 'chitiet', 'core']) {
    for (const f of FILTERS) {
      const hits = findHits(matrix[BL_UNDATED][surface][f.name], BL_UNDATED);
      check(`LCL-UNDATED always visible on ${surface} filter ${f.name}`, hits.length >= 1, `${hits.length} row(s)`);
    }
  }

  // ---- SYNC: per filter the fixture set is identical on Tổng quan and Chi tiết ----
  for (const f of FILTERS) {
    const needles = [BL_DATED, BL_UNDATED];
    const onTq = needles.filter((n) => findHits(matrix[n].tongquan[f.name], n).length > 0);
    const onCt = needles.filter((n) => findHits(matrix[n].chitiet[f.name], n).length > 0);
    check(
      `SYNC Tong quan == Chi tiet filter ${f.name}`,
      onTq.join() === onCt.join(),
      `Tong quan=[${onTq.join()}] Chi tiet=[${onCt.join()}]`,
    );
  }

  // ---- REAL-LOT evidence: raw JSON per surface x filter ----
  fs.writeFileSync(
    path.join(OUT_DIR, `2026-10-23_filter-lcl-day_lot-${REAL_LOT}-${LABEL}.json`),
    JSON.stringify({ backend: BACKEND, stamp, label: LABEL, matrix: matrix[REAL_LOT] }, null, 2),
  );
  for (const surface of ['tongquan', 'chitiet', 'core']) {
    for (const f of FILTERS) {
      const hits = findHits(matrix[REAL_LOT][surface][f.name], REAL_LOT);
      const expectPresent = f.name === '23/10..23/10' ? 0 : 1; // transportDate=2026-10-17
      check(
        `REAL-LOT ${REAL_LOT} on ${surface} filter ${f.name} (expect ${expectPresent ? 'present' : 'absent'})`,
        hits.length >= expectPresent && (expectPresent === 1 ? true : hits.length === 0),
        `${hits.length} row(s)`,
      );
    }
  }

  // ---- summary ----
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks pass (${LABEL})`);
  fs.writeFileSync(
    path.join(OUT_DIR, `2026-10-23_filter-lcl-day_repro-${LABEL}.log`),
    [
      `# 2026-10-23 LCL day-filter repro — label=${LABEL} backend=${BACKEND} stamp=${stamp}`,
      `# fixtures: ${BL_DATED} (LCL dated 2026-10-17), ${BL_UNDATED} (LCL undated)`,
      ...checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
      `${checks.length - failed.length}/${checks.length} checks pass (${LABEL})`,
      '',
    ].join('\n'),
  );
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((c) => c.name).join(' | ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
