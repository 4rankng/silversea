/**
 * SIL-638 (id 742) TC6(1) — the 40ft-Kẹp hard block. QA 01/11: a 40ft Kẹp
 * SAVED (lot 00048) — the DOC law only lived inside the pairing core
 * (createTripPairCoreInTx, trip-pairs.service), and the dispatch lane QA used
 * (assign + issue) never creates a pair row, so nothing blocked.
 *
 * The leaking paths, now closed and pinned: the ISSUE/REISSUE path
 * (issueOrderCreateOrUpdate) and BOTH assign-time sites (atomic plan save +
 * legacy plate endpoint) call assertKepIssuingContainerClass, which hard-409s
 * with the DOC verbatim text whenever a declared DOUBLE leg's container is a
 * proven non-20' shell. An undeclared size keeps "bổ sung sau" (skip).
 *
 * DB-free per the BE unit-only ruling (2026-10-19).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  containerFootClass,
  KEP_CONTAINER_SIZE_BLOCK_MESSAGE,
} from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): string =>
  readFileSync(path.join(here, '../../services', name), 'utf8');

describe('TC6(1) — pure foot-class law', () => {
  it('the block message is the DOC verbatim text', () => {
    assert.equal(KEP_CONTAINER_SIZE_BLOCK_MESSAGE, 'Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft');
  });

  it('length classes resolve from the type code', () => {
    assert.equal(containerFootClass('20DV'), '20');
    assert.equal(containerFootClass('40HC'), '40');
    assert.equal(containerFootClass(null), null);
    assert.equal(containerFootClass(''), null);
  });
});

describe('TC6(1) — every dispatch-write path stamps the 20ft law', () => {
  it('the shared guard refuses a declared DOUBLE leg on a proven non-20ft container', () => {
    const source = read('dispatch-resource-availability.service.ts');
    assert.match(source, /export async function assertKepIssuingContainerClass/);
    assert.match(source, /args\.classification !== 'DOUBLE' \|\| args\.shipmentContainerId == null/);
    assert.match(source, /throw new ApiError\(409, KEP_CONTAINER_SIZE_BLOCK_MESSAGE\)/);
    // "bổ sung sau": an undeclared size (no type link → null class) skips.
    assert.match(source, /if \(foot != null && foot !== '20'\)/);
  });

  it('the ISSUE/REISSUE path (issueOrderCreateOrUpdate) runs the guard — the path QA used', () => {
    const source = read('dispatch-planning-commands.service.ts');
    assert.match(
      source,
      /await assertKepIssuingContainerClass\(tx, \{\s*\n\s*shipmentContainerId: fulfillment\.shipmentContainerId,\s*\n\s*classification: fulfillment\.dispatchClassification,\s*\n\s*\}\);/,
    );
  });

  it('the atomic plan save runs the guard with the EFFECTIVE classification', () => {
    const source = read('dispatch-planning-detail-plan.service.ts');
    assert.match(
      source,
      /classification: input\.classification \?\? fulfillment\.dispatchClassification,\s*\n\s*\}\);\s*\n\s*await assertPlanRowRigAvailable/,
    );
  });

  it('the legacy plate endpoint runs the guard too', () => {
    const source = read('dispatch-planning-detail-plan.service.ts');
    const plateGuardBlock = source.match(/SIL-638 \(id 742\) TC6\(1\) — the 40ft-Kẹp hard block at assign time\.\s*\n\s*await assertKepIssuingContainerClass[\s\S]*?\}\);\s*\n\s*await assertPlanRowRigAvailable/);
    assert.ok(plateGuardBlock, 'the plate endpoint guard call must precede its rig guard');
  });

  it('the pairing core keeps its own DOC-text gate (pair-creation law unchanged)', () => {
    const source = read('trip-pairs.service.ts');
    assert.match(source, /kepContainerSizeBlockMessage\(/);
  });
});
