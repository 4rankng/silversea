/**
 * F3 — Per-vehicle profit distribution exactness invariant.
 *
 * Asserts the core financial guarantee: Σ distribution rows == Σ_t P_t
 * (== entity netProfit), within ≤0.01 VND. The per-truck floor+remainder
 * math guarantees each truck sums exactly, so the total does too. Also
 * verifies that an ownerless truck's profit is held aside (undistributed),
 * NOT emitted as distribution rows.
 *
 * The full `computeDistribution` is DB-coupled, so we test the pure
 * `distributeTruckProfit` helper + the exactness reconciliation logic it
 * underpins. This is the load-bearing math — if it drifts, distributions
 * would over/under-allocate owner payouts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { distributeTruckProfit } from '../services/profit-distribution.service';
import { resolveTruckCapSnapshot } from '../services/reporting-shared';

describe('F3 distributeTruckProfit — exactness', () => {
  test('single truck, two 50% owners, odd profit → rows sum exactly to profit', () => {
    // Classic over-allocation case: 7₫ × 50% = 3.5 → naive rounding gives 4+4=8.
    // Floor+remainder-to-last must give 3+4=7 (exact).
    const profit = 7;
    const owners = [
      { partnerName: 'A', percentage: 50 },
      { partnerName: 'B', percentage: 50 },
    ];
    const { partners } = distributeTruckProfit(1, profit, owners);
    const sum = partners.reduce((s, p) => s + p.amount, 0);
    assert.strictEqual(sum, profit, `rows must sum exactly to ${profit}, got ${sum}`);
    assert.deepStrictEqual(
      partners.map(p => p.amount).sort((a, b) => a - b),
      [3, 4],
    );
  });

  test('two trucks → Σ all rows == Σ_t P_t (entity invariant)', () => {
    // Truck 1: profit 100, owners A(60%)/B(40%). Truck 2: profit 50, owner C(100%).
    const t1 = distributeTruckProfit(1, 100, [
      { partnerName: 'A', percentage: 60 },
      { partnerName: 'B', percentage: 40 },
    ]);
    const t2 = distributeTruckProfit(2, 50, [
      { partnerName: 'C', percentage: 100 },
    ]);

    const allRows = [...t1.partners, ...t2.partners];
    const sigmaRows = allRows.reduce((s, p) => s + p.amount, 0);
    const sigmaP = 100 + 50;
    assert.ok(
      Math.abs(sigmaRows - sigmaP) < 0.01,
      `Σ rows (${sigmaRows}) must equal Σ_t P_t (${sigmaP})`,
    );

    // Entity view = group by partner_name, Σ amount.
    const byPartner = new Map<string, number>();
    for (const p of allRows) byPartner.set(p.partnerName, (byPartner.get(p.partnerName) ?? 0) + p.amount);
    const entityTotal = Array.from(byPartner.values()).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(entityTotal - sigmaP) < 0.01, 'entity Σ must also match');
    assert.strictEqual(byPartner.get('A'), 60);
    assert.strictEqual(byPartner.get('B'), 40);
    assert.strictEqual(byPartner.get('C'), 50);
  });

  test('ownerless truck → no rows; its profit contributes to undistributed, not distributions', () => {
    // An ownerless truck returns zero partner rows; the caller holds its profit
    // aside as undistributedProfit. Simulate the invariant: Σ rows (0) must
    // equal distributableProfit (netProfit − undistributedProfit).
    const { partners } = distributeTruckProfit(9, 80, []);
    assert.strictEqual(partners.length, 0);

    const netProfit = 80;            // only this ownerless truck had profit
    const undistributedProfit = 80;  // all of it held aside
    const distributableProfit = netProfit - undistributedProfit; // 0
    const sigmaRows = partners.reduce((s, p) => s + p.amount, 0); // 0
    assert.ok(
      Math.abs(sigmaRows - distributableProfit) < 0.01,
      'ownerless truck profit must NOT appear in distribution rows',
    );
  });

  test('three-way split with remainder → still exact', () => {
    // 10₫ across 33/33/34. 10*0.33=3.3→floor 3 (×2), last gets 10−6=4. Sum=10.
    const { partners } = distributeTruckProfit(3, 10, [
      { partnerName: 'X', percentage: 33 },
      { partnerName: 'Y', percentage: 33 },
      { partnerName: 'Z', percentage: 34 },
    ]);
    const sum = partners.reduce((s, p) => s + p.amount, 0);
    assert.strictEqual(sum, 10);
  });
});

// ─── B2 (feedback202606 GAP 7) — driver profit contributors ──────────────────
// A driver is modeled as a per-truck profit contributor via `truck_cap_table`
// with role=DRIVER. The split math is owner-agnostic (a driver-contributor is
// just an owner with a % share); `role` only labels the row for UI. These
// tests confirm (1) a mixed investor+driver owner set splits correctly and the
// result rows carry their role, and (2) `resolveTruckCapSnapshot` passes the
// row's role through to the active snapshot.
describe('B2 truck_cap role — driver profit contributors', () => {
  test('mixed owner set (1 investor 80% + 1 driver 20%) splits correctly and rows carry role', () => {
    // Truck profit 1000₫. Investor A 80% → 800₫. Driver B 20% → 200₫. Sum exact.
    const profit = 1000;
    const owners = [
      { partnerName: 'A (đối tác)', percentage: 80, role: 'INVESTOR' as const },
      { partnerName: 'B (lái xe)', percentage: 20, role: 'DRIVER' as const },
    ];
    const { partners } = distributeTruckProfit(1, profit, owners);

    // Exactness still holds — driver rows count toward the total.
    const sum = partners.reduce((s, p) => s + p.amount, 0);
    assert.strictEqual(sum, profit, `rows must sum exactly to ${profit}, got ${sum}`);

    // Each partner's role is carried through unchanged.
    const byName = new Map(partners.map(p => [p.partnerName, p]));
    assert.strictEqual(byName.get('A (đối tác)')?.role, 'INVESTOR');
    assert.strictEqual(byName.get('B (lái xe)')?.role, 'DRIVER');

    // The driver-contributor gets exactly their % share (no rounding bias here).
    assert.strictEqual(byName.get('A (đối tác)')?.amount, 800);
    assert.strictEqual(byName.get('B (lái xe)')?.amount, 200);
  });

  test('owners without an explicit role default to INVESTOR on the result row', () => {
    // Legacy callers (pre-B2) don't supply `role`; they must still work and
    // label as INVESTOR so the UI never shows an unlabeled partner.
    const { partners } = distributeTruckProfit(2, 100, [
      { partnerName: 'Legacy', percentage: 100 },
    ]);
    assert.strictEqual(partners.length, 1);
    assert.strictEqual(partners[0].role, 'INVESTOR');
  });

  test('resolveTruckCapSnapshot passes role through and filters percentage > 0', () => {
    // Two rows on the same effectiveDate: an investor and a driver-contributor.
    // The snapshot must keep both, carry each role, and drop zero-percentage rows.
    const cutoff = '2026-01-15';
    const rows = [
      { partnerName: 'A', effectiveDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', percentage: '80', role: 'INVESTOR' },
      { partnerName: 'B', effectiveDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', percentage: '20', role: 'DRIVER' },
      { partnerName: 'C', effectiveDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', percentage: '0', role: 'INVESTOR' },
    ];
    const snap = resolveTruckCapSnapshot(rows, cutoff);
    const byName = new Map(snap.map(p => [p.partnerName, p]));
    assert.strictEqual(snap.length, 2, 'zero-percentage row must be filtered out');
    assert.strictEqual(byName.get('A')?.role, 'INVESTOR');
    assert.strictEqual(byName.get('B')?.role, 'DRIVER');
  });

  test('resolveTruckCapSnapshot defaults a null/missing role to INVESTOR (legacy rows)', () => {
    const cutoff = '2026-01-15';
    const rows = [
      { partnerName: 'A', effectiveDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', percentage: '100', role: null },
      { partnerName: 'B', effectiveDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', percentage: '50' },
    ];
    const snap = resolveTruckCapSnapshot(rows, cutoff);
    assert.ok(snap.every(p => p.role === 'INVESTOR'), 'null/missing role must default to INVESTOR');
  });
});
