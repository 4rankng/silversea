// SIL-498 (khách 25/10, drawer tờ khai per-cont): nút "Copy tờ khai cho các
// dòng dưới" ở dòng đầu ride endpoint copy-declaration CÓ SẴN (card
// 261013200312) — fan-out CHỈ vào dòng trống, không ghi đè dòng đã có số
// khác; số copy là số PERSISTED của dòng nguồn (draft chưa lưu không copy
// được). SPEC cũng yêu cầu verify cả ĐƯỜNG TẠO (create) lô kéo
// syncDeclarationOntoEmptyContainers — pin wiring nguồn ở ranh giới unit cho
// phép (không db), cùng style bộ tokhai SIL-166/173/184.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shipmentCusContainerDeclarationCopyResultSchema,
  shipmentCusContainerDeclarationCopySchema,
} from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const writes = readFileSync(join(here, '../../services/cus-shipment-workspace-writes.service.ts'), 'utf8');
const createService = readFileSync(join(here, '../../services/shipment-create.service.ts'), 'utf8');
const documents = readFileSync(join(here, '../../services/shipment-documents.service.ts'), 'utf8');

const copyFlow = () => {
  const start = writes.indexOf('export async function copyCusShipmentContainerDeclaration');
  assert.ok(start > -1, 'copyCusShipmentContainerDeclaration phải còn tồn tại trong workspace writes service');
  return writes.slice(start);
};

// ─── Wire: copy request/result giữ nguyên contract ───────────────────────────

test('copy-declaration wire: expectedShipmentVersion vào, updatedContainerIds + shipmentVersion ra', () => {
  const parsed = shipmentCusContainerDeclarationCopySchema.parse({ expectedShipmentVersion: 9 });
  assert.equal(parsed.expectedShipmentVersion, 9);
  const result = shipmentCusContainerDeclarationCopyResultSchema.parse({
    updatedContainerIds: [12, 13],
    shipmentVersion: 10,
  });
  assert.deepEqual(result.updatedContainerIds, [12, 13]);
});

test('copy-result strict: trường lạ bị từ chối', () => {
  assert.equal(shipmentCusContainerDeclarationCopyResultSchema.safeParse({
    updatedContainerIds: [12], shipmentVersion: 10, copiedNumbers: 'x',
  }).success, false);
});

// ─── Nguồn copy là số PERSISTED của dòng nguồn (SIL-498-R4) ─────────────────

test('copy đọc declarationNumber từ DB (FOR UPDATE) — không phải draft FE', () => {
  const flow = copyFlow();
  assert.match(flow, /declarationNumber: s\.shipmentContainers\.declarationNumber/);
  assert.match(flow, /\.for\('update'\)/);
});

test('nguồn trống bị chặn 400 — không có gì để copy', () => {
  assert.match(copyFlow(), /Container nguồn chưa có số tờ khai để copy sang các container khác\./);
});

// ─── Fan-out CHỈ dòng trống — divergence không bao giờ bị ghi đè ─────────────

test('copy fan-out giữ predicate TRỐNG (IS NULL OR btrim = "") — không đụng dòng có số khác', () => {
  const flow = copyFlow();
  // Predicate định nghĩa MỘT LẦN (const emptyDeclaration) và CẢ lúc đọc
  // target lẫn lúc update đều dùng lại nó (one-statement law, card
  // 261013200312): một dòng có số giữa read và write tự rời tập.
  assert.match(
    flow,
    /const emptyDeclaration = sql`\(\$\{s\.shipmentContainers\.declarationNumber\} IS NULL OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = ''\)`;/,
  );
  const uses = flow.match(/emptyDeclaration,/g) ?? [];
  assert.ok(uses.length >= 2, `predicate trống phải khóa cả read lẫn write, thấy ${uses.length}`);
  assert.match(flow, /ne\(s\.shipmentContainers\.id, args\.containerId\)/);
});

test('hết dòng trống → 409 "Mọi container trong lô đã có số tờ khai."', () => {
  assert.match(copyFlow(), /Mọi container trong lô đã có số tờ khai\./);
});

test('copy phải qua CẢ requireWorkspaceWriter lẫn requireContainerDeclarationWriter', () => {
  const flow = copyFlow();
  const writerAt = flow.indexOf('requireWorkspaceWriter(args.actor)');
  const declAt = flow.indexOf('requireContainerDeclarationWriter(args.actor)');
  assert.ok(writerAt > -1 && declAt > writerAt, 'copy phải qua đủ 2 tầng gate');
});

test('copy bump lot version ĐÚNG 1 lần sau khi ghi (reconcile đồng thời)', () => {
  const flow = copyFlow();
  assert.match(flow, /const shipmentVersion = shipment\.version \+ 1;/);
  const updateAt = flow.indexOf('await tx.update(s.shipmentContainers)');
  const bumpAt = flow.indexOf('shipment.version + 1');
  assert.ok(updateAt > -1 && bumpAt > updateAt, 'bump sau ghi container');
});

// ─── SPEC verify ĐƯỜNG TẠO: SIL-521 bỏ input cấp lô lúc tạo ─────────────────

test('create path: KHÔNG còn fan-out tờ khai cấp lô lúc tạo lô (SIL-521 supersede SIL-166 create leg)', () => {
  // Owner 26/10: tờ khai chỉ nhập/sửa ở cấp cont. Lô mới sinh ra với các dòng
  // cont TRỐNG tờ khai — CUS tự nhập per-cont (hoặc copy) sau khi tạo.
  assert.doesNotMatch(
    createService,
    /syncDeclarationOntoEmptyContainers/,
    'create không được còn kéo số cấp lô xuống dòng cont',
  );
  assert.doesNotMatch(createService, /input\.declarationNumber/);
});

test('helper fan-out dùng chung giữ luật fill-trống ở một chỗ (SIL-166/173)', () => {
  assert.match(
    documents,
    /export async function syncDeclarationOntoEmptyContainers/,
  );
  const helper = documents.slice(
    documents.indexOf('export async function syncDeclarationOntoEmptyContainers'),
    documents.indexOf('/** The declaration fan-out wrote container rows'),
  );
  assert.match(helper, /IS NULL OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = ''/);
});
