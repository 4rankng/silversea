// SIL-1073 (K3.104, KB Ch3 §3.5.4 Lớp 2) — the lot's ORIGINAL document set
// state: Còn thiếu · Đang bổ sung · Đã đủ, with 'Đã đủ' reachable ONLY when
// Người nhận + Ngày nhận thực tế are recorded. The write lives in the same
// idempotent envelope as the custody facts; the "Nợ chứng từ" list is a
// separate read for the bảng kê audience (Chứng từ/Kế toán + the supervisor
// pair). Pinned here without a database:
//   (A) the zod write schema's shape (version gate, name caps);
//   (B) the service law — the COMPLETE gate, the writer trio, the MISSING
//       default the summary renders, and the MISSING-first debt floor;
//   (C) the route wiring — same envelope, audit scope, debt route placed
//       BEFORE the /:id leaf and CUS-scoped roles.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shipmentDocumentSetUpdateSchema, shipmentDocumentSetSchema } from '@tingting/shared';
import {
  buildShipmentDocumentSetSummary,
  canWriteDocumentSet,
  DOCUMENT_SET_WRITER_ROLES,
  getLatestShipmentDocumentSetFact,
} from '../../services/shipment-document-set.service';
import { ShipmentDocumentSetStatus, Role } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(here, '..', '..', 'services', 'shipment-document-set.service.ts'),
  'utf8',
);
const routesSource = readFileSync(
  join(here, '..', '..', 'routes', 'shipments', 'cus-workspace.routes.ts'),
  'utf8',
);
const readsSource = readFileSync(
  join(here, '..', '..', 'services', 'cus-shipment-workspace-reads.service.ts'),
  'utf8',
);

function actorOf(role: Role) {
  return { userId: 9, role, username: 'actor', fullName: null, email: null, phone: null, capabilities: [] } as never;
}

describe('SIL-1073 — the Lớp-2 write schema', () => {
  it('carries the optimistic version gate and caps the missing-document names', () => {
    const parsed = shipmentDocumentSetUpdateSchema.safeParse({
      expectedShipmentVersion: 12,
      status: ShipmentDocumentSetStatus.SUPPLEMENTING,
      missingDocuments: ['Biên bản giao nhận (bản gốc)'],
      receiverName: null,
      receivedOn: null,
    });
    assert.equal(parsed.success, true);
    const bad = shipmentDocumentSetUpdateSchema.safeParse({
      expectedShipmentVersion: 12,
      status: ShipmentDocumentSetStatus.MISSING,
      missingDocuments: Array.from({ length: 31 }, (_, i) => `tài liệu ${i}`),
    });
    assert.equal(bad.success, false);
  });

  it('the wire summary always carries a status + label (never null — absence IS the debt)', () => {
    const view = shipmentDocumentSetSchema.safeParse({
      status: ShipmentDocumentSetStatus.MISSING,
      label: 'Còn thiếu',
      missingDocuments: [],
      receiverName: null,
      receivedOn: null,
      changedAt: null,
      changedByName: null,
      editable: false,
    });
    assert.equal(view.success, true);
    const noStatus = shipmentDocumentSetSchema.safeParse({ label: 'Còn thiếu' });
    assert.equal(noStatus.success, false);
  });
});

describe('SIL-1073 — the service law', () => {
  it("the KB gate: 'Đã đủ' needs Người nhận + Ngày nhận thực tế, refused in the service before any write", () => {
    const gate = serviceSource.indexOf("args.input.status === ShipmentDocumentSetStatus.COMPLETE");
    assert.ok(gate > -1, 'the COMPLETE gate must exist');
    assert.match(serviceSource, /throw new ApiError\(400, 'Chuyển "Đã đủ" cần ghi đủ Người nhận và Ngày nhận thực tế\.'\)/);
    // The gate fires BEFORE the transaction body (no lock, no insert).
    const executeStart = serviceSource.indexOf('const execute = async (tx: Tx) =>');
    assert.ok(gate < executeStart, 'the gate must run outside the tx');
  });

  it('writes are the bảng kê trio (ADMIN/MANAGER/CUS) and the lot must be unlocked + version-matched', () => {
    assert.deepEqual(DOCUMENT_SET_WRITER_ROLES, [Role.ADMIN, Role.MANAGER, Role.CUS]);
    assert.equal(canWriteDocumentSet(actorOf(Role.CUS)), true);
    assert.equal(canWriteDocumentSet(actorOf(Role.ACCOUNTANT)), false);
    assert.equal(canWriteDocumentSet(actorOf(Role.DISPATCHER)), false);
    assert.match(serviceSource, /assertShipmentAccountingUnlocked\(tx, args\.shipmentId\)/);
    assert.match(serviceSource, /shipment\.version !== args\.input\.expectedShipmentVersion/);
  });

  it("the summary defaults to MISSING ('Còn thiếu') when no fact exists — absence IS the debt", () => {
    const summary = buildShipmentDocumentSetSummary(null, actorOf(Role.CUS), false);
    assert.equal(summary.status, ShipmentDocumentSetStatus.MISSING);
    assert.equal(summary.label, 'Còn thiếu');
    assert.equal(summary.editable, true);
    const locked = buildShipmentDocumentSetSummary(null, actorOf(Role.CUS), true);
    assert.equal(locked.editable, false);
  });

  it('the latest-fact read orders newest-first and resolves the changer name', () => {
    assert.match(serviceSource, /orderBy\(desc\(s\.shipmentDocumentSetFacts\.changedAt\), desc\(s\.shipmentDocumentSetFacts\.id\)\)/);
    assert.match(serviceSource, /coalesce\(\$\{s\.users\.fullName\}, \$\{s\.users\.username\}\)/);
    void getLatestShipmentDocumentSetFact;
  });

  it('the debt list floors at the fact-less lots and drops only the "Đã đủ" ones', () => {
    assert.match(serviceSource, /selectDistinctOn\(\[s\.shipmentDocumentSetFacts\.shipmentId\]/);
    assert.match(serviceSource, /row\.status !== ShipmentDocumentSetStatus\.COMPLETE/);
    // The fact-less lots floor the debt: the LEFT JOIN's null-fact guard.
    assert.match(serviceSource, /s\.shipmentDocumentSetFacts\.id\} is null/);
    // The CUS scope rides the one visibility law — never a hand-written WHERE.
    assert.match(serviceSource, /cusVisibilityCondition\(db, actor\)/);
  });
});

describe('SIL-1073 — the route wiring', () => {
  it('the write rides the same idempotent envelope + audit scope as custody', () => {
    assert.match(routesSource, /IDEMPOTENCY_ENDPOINTS\.SHIPMENT_CUS_DOCUMENT_SET_UPDATE/);
    assert.match(routesSource, /scope: SHIPMENT_AUDIT_SCOPES\.documentSet/);
    assert.match(routesSource, /requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.CUS\)/);
  });

  it('the debt read is registered BEFORE /cus-workspace/:id and admits only the bảng kê audience', () => {
    const debtStart = routesSource.indexOf("'/cus-workspace/document-debt'");
    assert.ok(debtStart > -1, 'the debt route must exist');
    // Search for the :id leaf AFTER the debt route — the debt route's own
    // comment names the leaf and must not win the ordering probe.
    const idStart = routesSource.indexOf("'/cus-workspace/:id'", debtStart);
    assert.ok(idStart > -1, 'the per-lot leaf must exist');
    assert.ok(debtStart < idStart, 'the static segment must win over the :id leaf');
    const debtBlock = routesSource.slice(debtStart, idStart);
    assert.match(debtBlock, /requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT, Role\.CUS\)/);
    assert.match(debtBlock, /listShipmentDocumentDebt\(getUser\(req\)\)/);
  });

  it('the workspace rows carry the documentSet summary built from the batched latest fact', () => {
    assert.match(readsSource, /documentSetByShipment/);
    assert.match(readsSource, /from\(s\.shipmentDocumentSetFacts\)/);
  });
});
