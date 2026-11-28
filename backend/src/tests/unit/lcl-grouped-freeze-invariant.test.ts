// Merged-LCL 0-share supersede law — service-seam regression for the QA
// logic wave 28/11 double-count (groups d25e82a1 / 9c0f42bb): a merge-group
// member re-froze its OWN lane price AFTER grouping through a per-lot engine
// freeze (intake create/edit, container reconcile, dispatch issue), and the
// INSERT-only max-id-wins snapshot reads surfaced the secondary's freight
// again while Lô 1 still carried the group freight.
//
// The law (pure half pinned in freight-lot-basis.test.ts: classifyLotPricingBasis
// answers SKIP REV_GROUPED for ANY member with revGroupId, whatever the
// grounds): `lockShipmentFreightRate` — the ONE per-lot freeze writer —
// derives its grounds through `deriveLotPricingGrounds` (now carrying
// shipments.rev_group_id) and consults the classifier BEFORE resolving, so a
// grouped member can never receive a fresh non-zero freight snapshot. The
// only remaining freight_rate_snapshots writers are the grouping service
// itself (the group law's own stamps) and that guarded lock.
//
// Wiring is pinned at the unit boundary (no db) — same source-scan convention
// as sil1152-reimport-version.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8');

const lifecycle = read('../../services/freight-rate-snapshot-lifecycle.service.ts');
const lockBody = () => lifecycle.slice(lifecycle.indexOf('export async function lockShipmentFreightRate'));

function slice(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from);
  assert.ok(from > -1 && to > from, `mất mốc slice: ${start} → ${end}`);
  return src.slice(from, to);
}

test('grounds derivation mang revGroupId của lô (cờ thành viên nhóm ghép)', () => {
  const grounds = slice(lifecycle, 'export async function deriveLotPricingGrounds', 'export async function lockShipmentFreightRate');
  assert.match(grounds, /revGroupId: s\.shipments\.revGroupId/);
  assert.match(grounds, /revGroupId: shipment\.revGroupId \?\? null/);
});

test('lock chay bộ phân loại TRƯỚC khi resolve — SKIP REV_GROUPED chặn mọi freeze của thành viên', () => {
  const body = lockBody();
  const classifyAt = body.indexOf('const decision = classifyLotPricingBasis(grounds);');
  const resolveAt = body.indexOf('resolveFreightRateWithManualFallback(');
  const persistAt = body.indexOf('persistFreightRateSnapshot(');
  assert.ok(classifyAt > -1 && resolveAt > classifyAt && persistAt > classifyAt,
    'classifier (nơi SKIP REV_GROUPED sống) phải chạy trước resolve/persist');
  // SKIP → không ghi snapshot nào (theo đúng luật INSERT-only supersede: hàng
  // ghép giữ nguyên stamps của nhóm, Tách nhóm khôi phục tiền ghép nguyên vẹn).
  assert.match(body, /if \(decision\.action === 'SKIP'\) \{/);
});

test('writer audit: persistFreightRateSnapshot chỉ được gọi từ lock (có guard) và grouping service (luật nhóm)', () => {
  const writer = read('../../services/freight-pricing-engine.service.ts');
  assert.match(writer, /export async function persistFreightRateSnapshot/);
  // Sweep every non-test service file for call sites; any NEW caller must be
  // audited into this list or it bypasses the 0-share law.
  const callers: Record<string, number> = {
    'freight-rate-snapshot-lifecycle.service.ts': 1,
    'lcl-grouping.service.ts': 3,
  };
  for (const [file, expected] of Object.entries(callers)) {
    const src = read(`../../services/${file}`);
    const count = [...src.matchAll(/persistFreightRateSnapshot\(/g)].length;
    assert.equal(count, expected, `${file}: persistFreightRateSnapshot call sites đổi — audit lại writer của luật 0-share`);
  }
});

test('mọi đường freeze ngoài nhóm đều đi qua lockShipmentFreightRate (không writer rải rác)', () => {
  // Intake create (2), intake update (1), container reconcile (1), CUS
  // workspace writes (4), dispatch issue (1) — mỗi file pin số lần gọi, để
  // một freeze mới tự persist (nước rút quanh luật) làm test đỏ.
  const callSites: Record<string, number> = {
    'shipment-create.service.ts': 2,
    'shipment-update.service.ts': 1,
    'shipment-containers.service.ts': 1,
    'cus-shipment-workspace-writes.service.ts': 4,
    'dispatch-planning-commands.service.ts': 1,
  };
  for (const [file, expected] of Object.entries(callSites)) {
    const src = read(`../../services/${file}`);
    const count = [...src.matchAll(/lockShipmentFreightRate\(/g)].length;
    assert.equal(count, expected, `${file}: lockShipmentFreightRate call sites đổi — đường freeze mới phải qua guard nhóm`);
    assert.ok(!src.includes('persistFreightRateSnapshot('), `${file} tự persist snapshot — luồng quanh luật 0-share`);
  }
});

test('luật đông nhất với mặt đọc: sửa freeze không đụng effectiveLclFreight (read law khác, đã pin riêng)', () => {
  // The read side (lcl-effective-freight.ts) keeps its FB-145 contract; this
  // fix is writer-side only. Pin the module boundary so a future "read repair"
  // stays a deliberate act, not an accidental coupling.
  const effective = read('../../services/lcl-effective-freight.ts');
  assert.ok(!effective.includes('freight-rate-snapshot-lifecycle'), 'read law không được phụ thuộc writer');
  assert.ok(!effective.includes('persistFreightRateSnapshot'));
});
