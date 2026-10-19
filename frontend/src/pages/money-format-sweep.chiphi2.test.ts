/**
 * Card 191026160000 (§1) — money surfaces still printing the raw integer get
 * the house formatters: the Timesheet salary hint renders grouped
 * ("18.500.000 ₫"), and the config money inputs become NumberField-grouped
 * (typed free of separators, displayed grouped, payload shape unchanged).
 * Cases CP2-M1..M3.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatMoney } from '../lib/format';

const ROOT = join(process.cwd(), 'src');

async function src(rel: string): Promise<string> {
  return readFile(join(ROOT, rel), 'utf8');
}

describe('money-format sweep (card 191026160000 §1)', () => {
  it('behavioral pin: formatMoney renders vi-VN grouping for the surfaces above', () => {
    expect(formatMoney(18500000)).toBe('18.500.000');
    expect(formatMoney(1200000)).toBe('1.200.000');
    expect(formatMoney(-500000)).toBe('-500.000');
    expect(formatMoney('4500')).toBe('4.500');
  });
  it('CP2-M1: the Timesheet salary hint formats both salary modes through formatMoney', async () => {
    const page = await src('pages/TimesheetGridPage.tsx');
    expect(page).toContain('Lương ngày ${formatMoney(timesheet.dailyBase)} ₫');
    expect(page).toContain('Lương tháng ${formatMoney(timesheet.flatAmount)} ₫');
    // The raw interpolation is gone.
    expect(page).not.toMatch(/Lương ngày \$\{timesheet\.dailyBase\}/);
    expect(page).not.toMatch(/Lương tháng \$\{timesheet\.flatAmount\}/);
  });

  it('CP2-M2: the lift-pricing đơn giá input is NumberField grouped, payload unchanged', async () => {
    const page = await src('pages/config/LiftPricingConfigPage.tsx');
    expect(page).toMatch(/<NumberField[^>]*label="Đơn giá \(₫\)"/);
    expect(page).toMatch(/<NumberField[^>]*grouped/);
    // The wire contract: the save still sends the string the endpoint takes.
    expect(page).toContain('onsave({ portId: Number(portId), containerTypeId: Number(containerTypeId), direction, loadState, unitPrice })');
    expect(page).not.toMatch(/Đơn giá \(₫\)"?\)?><input className="input"/);
  });

  it('CP2-M3: weight-tier giá/kg, cap-table vốn góp, ancillary số tiền inputs are grouped (ancillary signed for hoàn tiền)', async () => {
    const tiers = await src('pages/config/WeightPricingTiersConfigPage.tsx');
    expect(tiers).toMatch(/<NumberField[^>]*label="Giá\/kg \(₫\)"/);
    const cap = await src('pages/config/CapTableConfigPage.tsx');
    expect(cap).toMatch(/<NumberField[^>]*label="Số vốn góp \(₫\)"/);
    const ancillary = await src('pages/config/AncillaryRevenueConfigPage.tsx');
    expect(ancillary).toMatch(/<NumberField[^>]*label="Số tiền \(₫\)"/);
    // Hoàn tiền rows are negative — the grouped field must accept the sign.
    expect(ancillary).toMatch(/grouped\n +signed/);
  });
});
