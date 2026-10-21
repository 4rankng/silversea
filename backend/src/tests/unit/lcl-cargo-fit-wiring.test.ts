import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// REQ-19 depth audit (2026-10-21) — wiring pin. The cargo-fit law itself is
// pure and unit-tested in shared (lcl-cargo-fit.test.ts); BE tests are
// unit-only (owner ruling 2026-10-19), so this pins that the grouping
// service actually stamps the shared assessment on the cost-group assign
// result AND the audit trail — the two surfaces the audit relies on.
const servicePath = join(fileURLToPath(new URL('.', import.meta.url)), '../../services/lcl-grouping.service.ts');
const service = readFileSync(servicePath, 'utf8');

describe('REQ-19 cargo-fit wiring (assignLclCostGroup)', () => {
  test('imports the shared assessor', () => {
    assert.match(service, /assessLclCargoFit/);
    assert.match(service, /LclCargoFitAssessment/);
  });

  test('stamps cargoFit on the assign result contract', () => {
    assert.match(service, /cargoFit\?: LclCargoFitAssessment/);
    assert.match(service, /memberCount: ordered\.length,\s*\n\s*cargoFit,/);
  });

  test('rides the audit metadata so the fit fact is queryable later', () => {
    assert.match(service, /principalFreight,\s*\n\s*cargoFit,/);
  });

  test('computes fit from the members\' stored cargoWeightKg vs the chosen class', () => {
    assert.match(
      service,
      /assessLclCargoFit\(\{\s*\n\s*isContainer: vehicleClass\.isContainer,\s*\n\s*vehicleClassCode: vehicleClass\.code,\s*\n\s*cargoWeightKg: ordered\.map/,
    );
  });
});
