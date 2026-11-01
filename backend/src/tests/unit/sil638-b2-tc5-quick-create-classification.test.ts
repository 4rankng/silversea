/**
 * SIL-638 (id 742) TC5 — quick-create nhận per-container classification
 * (QA verdict 01/11: FE đã gửi `containers[].classification` nhưng server
 * DROP → 2 cont khai Kẹp vẫn ra fulfillment ĐƠN trên dispatch rows).
 *
 * Contract (brief-sil-638-be): containers[].classification →
 * fulfillment dispatch_classification; omitted = SINGLE. Pinned here:
 *  - `containerClassificationToFulfillment` — the CUS choice wins verbatim
 *    (Kẹp/Kết hợp); undeclared keeps the legacy lot law (isCombined →
 *    COMBINED, otherwise SINGLE) — bit-for-bit the pre-TC5 behavior.
 *  - the persistence wiring: the container column is durable (migration),
 *    the reconcile persists it with the undefined-preservation contract,
 *    and EVERY fulfillment-creation site reads it (from-empty decompose,
 *    partial-set heal, add-container) instead of recomputing from the lot
 *    flag; a replacement fulfillment inherits the canceled row's own value.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { containerClassificationToFulfillment } from '../../services/shipment-intake-classification';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const servicesDir = path.join(backendRoot, 'src/services');

describe('containerClassificationToFulfillment (SIL-638 TC5 — classification → fulfillment)', () => {
  it('Kẹp (DOUBLE) / Kết hợp (COMBINED) khai rõ → thắng verbatim', () => {
    assert.equal(containerClassificationToFulfillment('DOUBLE', false), 'DOUBLE');
    assert.equal(containerClassificationToFulfillment('DOUBLE', true), 'DOUBLE');
    assert.equal(containerClassificationToFulfillment('COMBINED', false), 'COMBINED');
    assert.equal(containerClassificationToFulfillment('COMBINED', true), 'COMBINED');
  });

  it('chưa khai (null/undefined) → luật lô cũ: isCombined ? COMBINED : SINGLE', () => {
    assert.equal(containerClassificationToFulfillment(null, false), 'SINGLE');
    assert.equal(containerClassificationToFulfillment(null, true), 'COMBINED');
    assert.equal(containerClassificationToFulfillment(undefined, true), 'COMBINED');
    assert.equal(containerClassificationToFulfillment(undefined, false), 'SINGLE');
  });

  it('giá trị lạ (không phải SINGLE/DOUBLE/COMBINED) → rơi về luật lô', () => {
    assert.equal(containerClassificationToFulfillment('KEP', false), 'SINGLE');
    assert.equal(containerClassificationToFulfillment('LCL', true), 'COMBINED');
  });
});

describe('SIL-638 TC5 wiring lock — server không còn DROP classification', () => {
  const containersSource = readFileSync(path.join(servicesDir, 'shipment-containers.service.ts'), 'utf8');
  const fulfillmentSource = readFileSync(path.join(servicesDir, 'shipment-fulfillment.service.ts'), 'utf8');
  const lifecycleSource = readFileSync(path.join(servicesDir, 'shipment-lifecycle.service.ts'), 'utf8');

  it('migration tạo cột shipment_containers.classification + journal đăng ký', () => {
    const migrationPath = path.join(backendRoot, 'drizzle/20261101090000_container_intake_classification.sql');
    assert.equal(existsSync(migrationPath), true, 'migration file phải tồn tại');
    const migration = readFileSync(migrationPath, 'utf8');
    assert.match(migration, /ADD COLUMN IF NOT EXISTS classification text/);
    const journal = JSON.parse(readFileSync(path.join(backendRoot, 'drizzle/meta/_journal.json'), 'utf8'));
    assert.equal(
      journal.entries.some((entry: { tag: string }) => entry.tag === '20261101090000_container_intake_classification'),
      true,
      'journal phải đăng ký migration',
    );
  });

  it('reconcile persist classification với undefined-preservation như ports/factory', () => {
    assert.match(containersSource, /const resolvedClassification = container\.classification !== undefined/);
    assert.match(containersSource, /classification: resolvedClassification/);
    assert.match(containersSource, /reclassifiedContainerIds/);
  });

  it('mọi fulfillment-creation site đọc lựa chọn CUS (decompose + heal + add-container)', () => {
    const callSites = fulfillmentSource.match(/containerClassificationToFulfillment\(/g) ?? [];
    assert.ok(callSites.length >= 3, `cần >=3 call site (decompose/heal/add), thấy ${callSites.length}`);
    // Không còn site nào recompute từ lot flag mà bỏ qua lựa chọn CUS.
    assert.doesNotMatch(fulfillmentSource, /dispatchClassification: shipment\.isCombined \? ('COMBINED' as const|\('COMBINED' as const\))/);
  });

  it('replacement fulfillment kế thừa classification của chính row bị cancel', () => {
    assert.match(lifecycleSource, /dispatchClassification: fulfillment\.dispatchClassification/);
  });
});
