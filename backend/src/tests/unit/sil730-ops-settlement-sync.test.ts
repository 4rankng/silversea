/**
 * SIL-730 (id 850) — Ops sidebar duplicate cleanup + settlement data source sync:
 *   1. mapOpsStatusToSettlementStatus: maps OPS settlement statuses to valid AdvanceSettlementStatus
 *   2. OPS_SETTLEMENT_ID_OFFSET: offset constant (1,000,000) avoids id collision with advance_settlements
 *   3. advance-settlement.service.ts: listAdvanceSettlementsPaginated checks opsSettlements when forwarderId is provided
 *   4. advance-settlement.service.ts: getAdvanceSettlement resolves ops_settlements when id >= OPS_SETTLEMENT_ID_OFFSET
 *   5. forwarder/advances.ts: export delegates OS-* settlements to exportOpsSettlementXlsx
 *   6. Layout.tsx: Role.OPS omits /my-orders from navigation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  mapOpsStatusToSettlementStatus,
  OPS_SETTLEMENT_ID_OFFSET,
} from '../../services/advance.service';
import { AdvanceSettlementStatus } from '@tingting/shared';

describe('SIL-730 (id 850) — Ops settlement data sync and sidebar cleanup', () => {
  it('mapOpsStatusToSettlementStatus maps all ops statuses correctly', () => {
    assert.equal(mapOpsStatusToSettlementStatus('RECORDED'), AdvanceSettlementStatus.RECORDED);
    assert.equal(mapOpsStatusToSettlementStatus('APPROVED'), AdvanceSettlementStatus.RECORDED);
    assert.equal(mapOpsStatusToSettlementStatus('VOIDED'), AdvanceSettlementStatus.VOIDED);
    assert.equal(mapOpsStatusToSettlementStatus('REJECTED'), AdvanceSettlementStatus.VOIDED);
    assert.equal(mapOpsStatusToSettlementStatus('DRAFT'), AdvanceSettlementStatus.DRAFT);
    assert.equal(mapOpsStatusToSettlementStatus('PENDING'), AdvanceSettlementStatus.DRAFT);
    assert.equal(mapOpsStatusToSettlementStatus('UNKNOWN'), AdvanceSettlementStatus.DRAFT);
  });

  it('OPS_SETTLEMENT_ID_OFFSET is 1_000_000', () => {
    assert.equal(OPS_SETTLEMENT_ID_OFFSET, 1_000_000);
  });

  it('advance-settlement.service.ts routes forwarder listing to ops_settlements when present', () => {
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/advance-settlement.service.ts'),
      'utf8',
    );
    assert.ok(
      serviceSource.includes('listOpsSettlementsForForwarderPaginated'),
      'must include listOpsSettlementsForForwarderPaginated',
    );
    assert.ok(
      serviceSource.includes('getAdvanceSettlementFromOps'),
      'must include getAdvanceSettlementFromOps',
    );
    assert.ok(
      serviceSource.includes('if (id >= OPS_SETTLEMENT_ID_OFFSET)'),
      'getAdvanceSettlement must check OPS_SETTLEMENT_ID_OFFSET',
    );
  });

  it('forwarder/advances.ts routes OS-* settlement export to exportOpsSettlementXlsx', () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/routes/forwarder/advances.ts'),
      'utf8',
    );
    assert.ok(
      routeSource.includes("settlement.code.startsWith('OS-')"),
      'export route must inspect settlement.code for OS- prefix',
    );
    assert.ok(
      routeSource.includes('exportOpsSettlementXlsx'),
      'export route must call exportOpsSettlementXlsx for OS-* settlements',
    );
  });

  it('Layout.tsx removes /my-orders from OPS navigation items', () => {
    const layoutSource = fs.readFileSync(
      path.resolve(process.cwd(), '../frontend/src/components/Layout.tsx'),
      'utf8',
    );
    const opsCaseStart = layoutSource.indexOf("case 'OPS':");
    const driverCaseStart = layoutSource.indexOf("case 'DRIVER':", opsCaseStart);
    const opsBlock = layoutSource.slice(opsCaseStart, driverCaseStart);

    assert.equal(
      opsBlock.includes("key: 'my-orders'"),
      false,
      'OPS sidebar must NOT contain my-orders item',
    );
    assert.ok(
      opsBlock.includes("key: 'my-settlements'"),
      'OPS sidebar must retain my-settlements item',
    );
    assert.ok(
      opsBlock.includes("key: 'ops-orders'"),
      'OPS sidebar must retain ops-orders item',
    );
  });
});
