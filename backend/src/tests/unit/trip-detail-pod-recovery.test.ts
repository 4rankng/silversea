// SIL-694 — the trip GET carries the POD-gốc gate state so the governed close
// modal can show readiness (the completion transition 409s while
// trips.pod_recovered_at is null). Unit source pin in the wiring-test style
// (no db, no app boot — 2026-10-19 owner ruling): the detail select must read
// the composite view's pod columns, the same trip-status-machine gate they
// feed stays pinned by trip-status-machine.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/services/trip-queries.service.ts'),
  'utf8',
);

test('getTripById exposes pod_recovered_at/by so the close modal can show the gate state', () => {
  const select = source.slice(
    source.indexOf('export async function getTripById'),
    source.indexOf('router-attach helpers', source.indexOf('export async function getTripById')) > 0
      ? source.indexOf('router-attach helpers', source.indexOf('export async function getTripById'))
      : source.length,
  );
  assert.match(select, /podRecoveredAt: s\.tripsComposite\.podRecoveredAt/);
  assert.match(select, /podRecoveredBy: s\.tripsComposite\.podRecoveredBy/);
});

test('the pod-recovered mark route keeps its ACCOUNTANT/CUS allowlist (the close-modal affordance mirrors it)', () => {
  const route = readFileSync(
    path.resolve(process.cwd(), 'src/routes/trips/pod.ts'),
    'utf8',
  );
  assert.match(route, /requireRoles\(Role\.ACCOUNTANT, Role\.CUS\)/);
});
