// SIL-701 (owner ruling 30/10): per-cont số tờ khai rides the create/edit
// reconcile batch. Pin ở ranh giới unit cho phép (không db): wiring nguồn của
// flow persist trong reconcileShipmentContainersInTx — hợp đồng
// undefined-preservation (surface không quản lý field thì GIỮ giá trị đã lưu),
// guard cross-lô CHỈ cho số THAY ĐỔI (identity write không đụng guard), dedupe
// mỗi số mỗi batch, và KHÔNG có fan-out kiểu FB-109 trong batch (lưu đúng giá
// trị từng dòng). Regression class đã thấy: một field-less update wipe sạch
// tờ khai đã lưu nếu fallback đổi thành `?? null`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const containersService = readFileSync(join(here, '../../services/shipment-containers.service.ts'), 'utf8');
const lifecycleShared = readFileSync(join(here, '../../services/shipment-lifecycle-shared.service.ts'), 'utf8');

const reconcileFlow = () => containersService.slice(
  containersService.indexOf('export async function reconcileShipmentContainersInTx'),
  containersService.indexOf('export async function reconcileShipmentContainersWithFulfillmentGuard'),
);

test('SIL701-B1 payload ghi declarationNumber của DÒNG đó (insert + update cùng một payload)', () => {
  const flow = reconcileFlow();
  assert.match(flow, /declarationNumber: resolvedDeclarationNumber/);
  const payloadAt = flow.indexOf('declarationNumber: resolvedDeclarationNumber');
  const insertAt = flow.indexOf('tx.insert(s.shipmentContainers)');
  const updateAt = flow.indexOf('tx.update(s.shipmentContainers)');
  assert.ok(payloadAt > -1 && payloadAt < updateAt, 'payload khai báo trước nhánh update');
  assert.ok(payloadAt < insertAt, 'payload khai báo trước nhánh insert');
});

test('SIL701-B2 undefined-preservation: field vắng = GIỮ giá trị đã lưu (update) / null (insert)', () => {
  const flow = reconcileFlow();
  assert.match(flow, /const previousDeclarationNumber = isUpdate\s*\n\s*\? currentById\.get\(container\.id as number\)\?\.declarationNumber \?\? null\s*\n\s*: null;/);
  // Fallback MUST read the stored value — a `?? null` regression here wipes
  // every stored declaration on any field-less update.
  assert.match(flow, /container\.declarationNumber !== undefined\s*\n\s*\? container\.declarationNumber\?\.trim\(\) \|\| null\s*\n\s*: previousDeclarationNumber;/);
});

test('SIL701-B3 guard cross-lô CHỈ cho số thay đổi + dedupe mỗi số mỗi batch', () => {
  const flow = reconcileFlow();
  assert.match(flow, /const guardedDeclarationNumbers = new Set<string>\(\);/);
  assert.match(flow, /resolvedDeclarationNumber != null\s*\n\s*&& resolvedDeclarationNumber !== previousDeclarationNumber\s*\n\s*&& !guardedDeclarationNumbers\.has\(resolvedDeclarationNumber\.toLowerCase\(\)\)/);
  assert.match(flow, /await assertContainerDeclarationNumberAvailable\(tx, shipmentId, resolvedDeclarationNumber\);/);
});

test('SIL701-B4 guard dùng chung bản shipment-lifecycle-shared (một luật, mọi writer)', () => {
  assert.match(containersService, /import \{ assertContainerDeclarationNumberAvailable \} from '\.\/shipment-lifecycle-shared\.service';/);
  assert.match(lifecycleShared, /export async function assertContainerDeclarationNumberAvailable/);
  // The line-save writer imports the SAME guard — no second implementation.
  const writes = readFileSync(join(here, '../../services/cus-shipment-workspace-writes.service.ts'), 'utf8');
  assert.match(writes, /import \{ assertContainerDeclarationNumberAvailable \} from '\.\/shipment-lifecycle-shared\.service';/);
  assert.doesNotMatch(writes, /async function assertContainerDeclarationNumberAvailable/);
});

test('SIL701-B5 batch KHÔNG fan-out FB-109 — persist đúng giá trị từng dòng', () => {
  const flow = reconcileFlow();
  // The only declarationNumber VALUE WRITE in the flow is the per-row payload
  // field (`declarationNumber: resolvedDeclarationNumber`) — a fan-out would
  // introduce a second write (bulk update to sibling rows).
  const valueWrites = [...flow.matchAll(/declarationNumber:\s*(\S+?),?\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(valueWrites, ['resolvedDeclarationNumber']);
  assert.doesNotMatch(flow, /set\(\{[^}]*declarationNumber[^}]*\}\)\s*\.where\(and\(/);
});
