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

  // Card 191026160000 §1 sweep lan 2 (spec 19/10 "TOÀN BỘ trường phải điền số
  // tiền"): the remaining money inputs across phân hệ — ops tạm ứng, treasury,
  // expense accounting (create/entry/cash), driver correction + fuel, salary
  // timesheets, shipment finance (hóa đơn/phí/cược/hoàn), freight override
  // and the fuel-threshold config — all render through the grouped
  // NumberField. Signed only where the business already allows negatives
  // (Thực chi / correction / fuel per FB-100).
  it('CP2-M4: ops/treasury/expense/salary/shipment-finance money inputs are grouped', async () => {
    const cases: Array<[string, RegExp]> = [
      ['features/ops/OpsAdvanceRequestModal.tsx', /<NumberField[^>]*label="Số tiền \(VND\)"[^>]*grouped/],
      ['features/treasury/TreasuryAccountDrawer.tsx', /<NumberField[^>]*label="Số dư đầu kỳ \(VND\)"[^>]*grouped/],
      ['features/expense-accounting/ExpenseEntryDrawer.tsx', /<NumberField[^>]*label="Thực chi \(VND\)"[^>]*min=\{-999_999_999_999_999\}[^>]*grouped signed/],
      ['features/expense-accounting/ExpenseEntryDrawer.tsx', /<NumberField[^>]*label="Thực thu — thu khách \(VND\)"[^>]*grouped/],
      ['features/expense-accounting/ExpenseCreateDrawer.tsx', /<NumberField[^>]*label="Thực chi \(VND\)"[^>]*grouped signed/],
      ['features/expense-accounting/ExpenseCreateDrawer.tsx', /<NumberField[^>]*label="Thực thu — thu khách \(VND\)"[^>]*grouped/],
      ['features/expense-accounting/ExpenseCashDrawer.tsx', /<NumberField[^>]*label=\{reconciliation \? 'Tiền hoàn ứng \(VND\)' : 'Tiền tạm ứng \(VND\)'\}[^>]*grouped/],
      ['components/trip/DriverExpenseCorrection.tsx', /<NumberField[^>]*label="Thực chi \(VND\)"[^>]*grouped signed/],
      ['components/trip/FuelRefillReportForm.tsx', /<NumberField[^>]*label="Số tiền đổ dầu \(VND\)"[^>]*grouped/],
      ['pages/TimesheetGridPage.tsx', /<NumberField[^>]*label="Lương ngày \(VND\)"[^>]*grouped/],
      ['pages/TimesheetGridPage.tsx', /<NumberField[^>]*label="Lương tháng cố định \(VND\)"[^>]*grouped/],
      ['pages/TimesheetReconciliationPage.tsx', /<NumberField[^>]*label="Lương ngày \(VND\)"[^>]*grouped/],
      ['pages/TimesheetReconciliationPage.tsx', /<NumberField[^>]*label="Lương tháng cố định \(VND\)"[^>]*grouped/],
      ['features/shipment-finance/ShipmentFinanceForm.tsx', /<NumberField[^>]*label="Giá trị hóa đơn \(đ\)"[^>]*grouped/],
      ['features/shipment-finance/ShipmentFinanceForm.tsx', /<NumberField[^>]*label="Phí nhà cung cấp \(đ\)"[^>]*grouped/],
      ['features/shipment-finance/ShipmentFinanceForm.tsx', /<NumberField[^>]*label="Tiền cược \(đ\)"[^>]*grouped/],
      ['features/shipment-finance/ShipmentFinanceForm.tsx', /<NumberField[^>]*label="Đã nhận hoàn \(đ\)"[^>]*grouped/],
    ];
    for (const [rel, pattern] of cases) {
      const source = await src(rel);
      expect(source, rel).toMatch(pattern);
    }
  });

  it('CP2-M5: the remaining raw money inputs became grouped NumberFields', async () => {
    const freight = await src('components/billing/DebitNoteFreightOverride.tsx');
    expect(freight).toMatch(/<NumberField[^>]*label="Giá cước đàm phán"/);
    expect(freight).toMatch(/grouped/);
    expect(freight).not.toMatch(/<input[^>]*aria-label="Giá cước đàm phán"/);
    const terms = await src('pages/config/FreightRateTermsConfigPage.tsx');
    // Review F4: ngưỡng VNĐ trên lít là per-liter decimal (positiveNumeric,
    // numeric storage) — stays a RAW decimal input like its fuel sibling;
    // only its state became number|'' with the same null-or-number payload.
    expect(terms).toMatch(/<input[^>]*aria-label="Giá trị ngưỡng VNĐ trên lít"/);
    expect(terms).not.toMatch(/<input[^>]*aria-label="Giá trị ngưỡng VNĐ trên lít"[^>]*type="text"/);
    // The wire contract survives the string→number state change.
    expect(terms).toContain("surchargeThresholdAbs: modeAbs ? (thresholdAbs === '' ? null : thresholdAbs) : null");
    // Batch 2 — the long tail across phân hệ (all bridge string state; wire
    // contracts unchanged). Signed only where negatives are legal.
    const cases: Array<[string, RegExp]> = [
      ['pages/ForwarderAdvancesPage.tsx', /<NumberField[^>]*grouped[^>]*required/],
      ['features/forwarder/ForwarderExpenseForm.tsx', /aria-label="Giá mua vào \(VNĐ\)"[^>]*grouped/],
      ['features/forwarder/ForwarderExpenseForm.tsx', /aria-label="Giá bán ra \(VNĐ\)"[^>]*grouped/],
      ['features/tires/tire-controls.tsx', /<NumberField id="tire-cost" grouped/],
      ['features/salary-attendance/salary-attendance-components.tsx', /<NumberField[^>]*id="payout-amount"[^>]*grouped/],
      ['features/app-settings/OperationalPolicySection.tsx', /<NumberField[^>]*id="credit-tier-one-amount-cap"[^>]*grouped/],
      ['features/app-settings/PairSalarySection.tsx', /<NumberField[^>]*id="pair-surcharge-kep"[^>]*grouped/],
      ['features/app-settings/PairSalarySection.tsx', /<NumberField[^>]*id="pair-surcharge-ket-hop"[^>]*grouped/],
      ['features/penalties/components/PenaltyFormDrawer.tsx', /<NumberField grouped placeholder="0"/],
      ['pages/PayableDetailPage.tsx', /<NumberField[^>]*id="payment-amount"[^>]*grouped/],
      ['pages/DebtDetailPage.tsx', /<NumberField[^>]*id="pay-amount"[^>]*grouped/],
      ['pages/ForwarderSettlementCreatePage.tsx', /grouped\n\s+signed/],
      ['pages/SettlementPrintPage.tsx', /<NumberField grouped value=\{editedAmount === ''/],
      ['pages/PayableListPage.tsx', /<NumberField[^>]*id="commission-amount"[^>]*grouped/],
      ['pages/TripDetailPage.tsx', /<NumberField id="adjustAmount"[^>]*grouped signed/],
      ['pages/config/CarrierPricingConfigPage.tsx', /<Field label="Cước trả nhà xe \(đ\)"><NumberField grouped/],
      ['pages/config/PenaltyReasonsConfigPage.tsx', /<NumberField\n\s+grouped/],
      ['pages/config/PricingTablesConfigPage.tsx', /<Field label="Cước thu khách \(đ\)"><NumberField grouped/],
      ['pages/config/PortZoneSurchargesConfigPage.tsx', /Giá mỗi lần nâng\/hạ \(đ\)">\s*<NumberField grouped/],
    ];
    // Review F1: giá dầu gốc (đ/lít) is per-liter DECIMAL (numeric(12,4)
    // domain, decimal sibling field) — it stays raw, like payables fuel
    // invoices' Đơn giá (VND/lít). The grouping sweep never touches
    // decimal-step per-liter fields.
    const fuel = await src('pages/config/FuelConfigPage.tsx');
    expect(fuel).toMatch(/<input id="fuel-base-unit-price"[^>]*type="number"/);
    expect(fuel).not.toMatch(/fuel-base-unit-price[^>]*grouped/);
    for (const [rel, pattern] of cases) {
      const source = await src(rel);
      expect(source, rel).toMatch(pattern);
    }
    // The billing builder's disabled money mirrors render grouped digits.
    const builder = await src('components/billing/BillingDocumentBuilder.tsx');
    expect(builder).toMatch(/value=\{formatCurrency\(amount\)\.replace\(' ₫', ''\)\}/);
    expect(builder).not.toMatch(/type="number"[\s\S]{0,120}billing-builder__amount/);
  });

  it('CP2-M6: shared money primitives declare tabular-nums (spec 19/10 mục 2)', async () => {
    const money = await readFile(join(process.cwd(), 'src/components/shared/Money.css'), 'utf8');
    expect(money).toMatch(/\.money\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    const typography = await readFile(join(process.cwd(), 'src/styles/typography.css'), 'utf8');
    expect(typography).toMatch(/\.typo-num,\s*\.num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    const recordTable = await readFile(join(process.cwd(), 'src/styles/record-table.css'), 'utf8');
    expect(recordTable).toMatch(/\.record-table \.num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    const numberField = await readFile(join(process.cwd(), 'src/design-system/forms/NumberField.css'), 'utf8');
    expect(numberField).toMatch(/\.ds-field--money input\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
    // The grouped NumberField wires the class that carries the rule.
    const numberFieldTs = await readFile(join(process.cwd(), 'src/design-system/forms/NumberField.tsx'), 'utf8');
    expect(numberFieldTs).toContain("['ds-field--money', className]");
  });
});
