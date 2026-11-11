// SIL-789 (KB Ch3 §3.4.3 + Ch2 §2.6.2, QA 10/11 build dc930964): lô đã khóa
// kế toán (Chốt giá bán → [Khóa Lô] — shipment_cost_locks unlockedAt NULL)
// vẫn sửa+lưu được SỐ TỜ KHÁI ở cấp container (POST containers/:id trả 200,
// DECL ghi mới). Luật: khóa kế toán đóng băng tờ khai — chặn TẠI NGUỒN (BE
// command) + wire mở reason để FE caption ô. Pin wiring ở ranh giới unit
// cho phép (không db) — same convention as cus-container-line-tokhai-edit-sync.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '../..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(join(here, '../../../..', rel), 'utf8');

const writes = read('services/cus-shipment-workspace-writes.service.ts');
const slice = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end));

const lineUpdateFlow = () => slice(writes, 'export async function updateCusShipmentContainerLine', 'export async function addCusShipmentContainer');
// copyDeclaration is the FILE's last export — slice to EOF.
const copyDeclFlow = () => writes.slice(writes.indexOf('export async function copyCusShipmentContainerDeclaration'));
const costLock = read('services/shipment-cost-lock.service.ts');
const builders = read('services/cus-workspace-builders.service.ts');
const shared = readRoot('shared/src/schemas/cus-shipment-workspace.ts');

const REASON = 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.';

test('SỬA tờ khai: lệnh chặn TẠI NGUỒN khi lô đang khóa chi phí (409 reason KB)', () => {
  const flow = lineUpdateFlow();
  assert.match(flow, /if \(args\.input\.declarationNumber !== undefined\) \{[\s\S]*?requireContainerDeclarationWriter[\s\S]*?await assertShipmentDeclarationEditableByCostLock\(tx, args\.shipmentId\)/);
  // Guard sits INSIDE the declaration branch: cont/weight/appointment writes
  // keep their own guards — the freeze targets tờ khai only (ticket scope).
  const guardAt = flow.indexOf('assertShipmentDeclarationEditableByCostLock');
  const declAt = flow.indexOf('declarationNumber !== undefined');
  const versionAt = flow.indexOf('expectedShipmentVersion');
  assert.ok(guardAt > declAt, 'guard phải nằm sau nhánh tờ khai');
  assert.ok(guardAt > versionAt, 'guard chạy trong execute (sau version gate)');
});

test('COPY tờ khai: fan-out cùng chịu freeze — guard trước khi đọc source', () => {
  const flow = copyDeclFlow();
  const guardAt = flow.indexOf('assertShipmentDeclarationEditableByCostLock');
  const sourceAt = flow.indexOf('const [source]');
  assert.ok(guardAt > -1, 'copy declaration thiếu guard');
  assert.ok(sourceAt > guardAt, 'guard phải chạy trước khi đọc source row');
});

test('Thông báo 409 đúng câu KB trên service khóa chi phí', () => {
  assert.match(costLock, /SHIPMENT_COST_LOCKED_DECLARATION_MESSAGE = 'Lô hàng đã khóa kế toán; không thể sửa tờ khai\.'/);
  assert.match(costLock, /export async function assertShipmentDeclarationEditableByCostLock\(executor: Executor, shipmentId: number\)/);
  assert.match(costLock, /isNull\(s\.shipmentCostLocks\.unlockedAt\)/);
});

test('Wire: shipmentFieldAccess gập khóa chi phí vào tờ khai với cùng lý do KB', () => {
  const declBranch = builders.slice(builders.indexOf("if (field === 'declarationNumber')"), builders.indexOf("if (field === 'customerNotes'"));
  assert.match(declBranch, /hasActiveLock \|\| costLocked/);
  assert.match(declBranch, new RegExp(REASON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Chỉ nhánh tờ khai — các trường khác giữ luật riêng (notes mở kể cả khi khóa).
  const notesBranch = builders.slice(builders.indexOf("if (field === 'customerNotes'"), builders.indexOf('if (hasActiveLock)'));
  assert.doesNotMatch(notesBranch, /costLocked/);
});

test('buildListItem công bố costLocked từ support cho cả hai mặt workspace', () => {
  assert.match(builders, /costLocked: support\.costLockedByShipment\.has\(row\.shipment\.id\)/);
  assert.match(builders, /costLocked = false/);
});

test('Shared schema: costLocked boolean default false (wire backcompat)', () => {
  assert.match(shared, /costLocked: z\.boolean\(\)\.default\(false\)/);
});
