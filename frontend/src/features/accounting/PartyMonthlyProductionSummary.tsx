import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { round2dp } from '@tingting/shared';
import { financialClient } from '../../api/financialClient';
import { getPhoiPhieuReport, type PhoiPhieuReportRow } from '../../api/phoiPhieuClient';
import { useAuth } from '../../hooks/useAuth';
import { formatCurrency } from '../../lib/format';
import { EmptyState } from '../../design-system';
import './PartyMonthlyProductionSummary.css';

/**
 * Card 380 — bảng tổng hợp sản lượng vận tải theo tháng (chi tiết phải thu/trả)
 * under the ledger tables on /debt and /payables.
 *
 * Composition over EXISTING endpoints — never a parallel aggregation:
 * - SL / cước VC / đã thanh toán / tồn cuối kỳ per side come verbatim from the
 *   phoi-phieu period report (`getPhoiPhieuReport('THU' | 'TRA')`, including its
 *   own TỔNG CỘNG `grand` row) — the same numbers the phoi-phieu report table
 *   prints, so the month-close totals match the detailed source by construction.
 * - "Còn nợ" is the party's existing outstanding on THIS page's ledger
 *   (`getCustomerAging` on /debt, `getPayablesSummary` on /payables) joined by
 *   display name, so the column reconciles with the page's `Tổng nợ` by
 *   construction. A party the ledger endpoint does not surface (its balance is
 *   ≤ 0) renders the computed 0 — the nothing-left-to-settle case.
 *
 * Named gaps, rendered as '—' (see the card DEV NOTE):
 * - No endpoint returns per-party period VAT (thuế) or invoice (HĐ / số CT /
 *   ngày) facts — the phoi-phieu report has no VAT dimension.
 * - "Số ĐNTT" (đề nghị thanh toán) has no per-party in-period source reachable
 *   from these surfaces.
 * - "Lập Phiếu" needs a party→trips resolution the existing endpoints do not
 *   guarantee (the phoi-phieu rows board caps at a 300-row window), so the
 *   button renders disabled with that reason instead of risking a voucher
 *   built from a partial trip set.
 */

export type PartyMonthlySummaryVariant = 'receivable' | 'payable';

// Feature-local query keys, built the same way useSalaryQueries builds its
// module-local key factory: one named factory per key family so invalidation
// sites stay discoverable without opening the shared qk registry.
const periodReportKey = (kind: 'THU' | 'TRA', from: string, to: string) =>
  ['accounting', 'party-monthly-production', kind, from, to] as const;
const ledgerOutstandingKey = (variant: PartyMonthlySummaryVariant) =>
  ['accounting', 'party-monthly-production', 'ledger', variant] as const;

const DASH = '—';

/** The phoi-phieu report's own requireRoles set (ADMIN/MANAGER/ACCOUNTANT). */
function canReadPeriodReport(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'ACCOUNTANT';
}

/** Calendar-month default for the Từ ngày/Đến ngày filter (local time). */
export function calendarMonthBounds(now = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`,
  };
}

interface SummaryRow {
  party: string;
  slThu: number;
  cuocThu: number;
  slTra: number;
  cuocTra: number;
  /** Variant-primary side's recorded cash in the period. */
  daThanhToan: number;
  tonCuoiThu: number;
  tonCuoiTra: number;
  /** Outstanding on the page's own ledger — reconciles with the `Tổng nợ` column. */
  conNo: number;
}

/** Party name → existing outstanding, from the ledger endpoint this page uses. */
async function fetchLedgerOutstandingMap(variant: PartyMonthlySummaryVariant): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (variant === 'receivable') {
    // Aging endpoint caps at limit 500 (maxLimit) — one call covers the full set.
    const res = await financialClient.getCustomerAging({ page: 1, limit: 500 });
    for (const c of res.customers) {
      if (!map.has(c.customerName)) map.set(c.customerName, c.totalOutstanding);
    }
  } else {
    const res = await financialClient.getPayablesSummary({ page: 1, limit: 500 });
    for (const item of res.items) {
      if (!map.has(item.supplier.name)) map.set(item.supplier.name, item.totalOutstanding);
    }
  }
  return map;
}

function mergeSummaryRows(
  thuRows: PhoiPhieuReportRow[],
  traRows: PhoiPhieuReportRow[],
  ledger: Map<string, number> | undefined,
  variant: PartyMonthlySummaryVariant,
): SummaryRow[] {
  const thuByParty = new Map(thuRows.map((row) => [row.party, row]));
  const traByParty = new Map(traRows.map((row) => [row.party, row]));
  const parties = new Set<string>([...thuByParty.keys(), ...traByParty.keys()]);
  const merged: SummaryRow[] = [...parties].map((party) => {
    const thu = thuByParty.get(party);
    const tra = traByParty.get(party);
    return {
      party,
      slThu: thu?.soLuong ?? 0,
      cuocThu: round2dp(thu?.tongPhaiThuTra ?? 0),
      slTra: tra?.soLuong ?? 0,
      cuocTra: round2dp(tra?.tongPhaiThuTra ?? 0),
      daThanhToan: round2dp((variant === 'receivable' ? thu?.daThuTra : tra?.daThuTra) ?? 0),
      tonCuoiThu: round2dp(thu?.conLai ?? 0),
      tonCuoiTra: round2dp(tra?.conLai ?? 0),
      conNo: round2dp(ledger?.get(party) ?? 0),
    };
  });
  // The period report's own order — busiest subjects first — on the variant's
  // primary side, name as the stable tiebreaker.
  const primarySl = (row: SummaryRow) => (variant === 'receivable' ? row.slThu : row.slTra);
  return merged.sort((a, b) => primarySl(b) - primarySl(a) || a.party.localeCompare(b.party, 'vi'));
}

export function PartyMonthlyProductionSummary({
  variant,
  className = '',
}: {
  /** receivable = the /debt surface (customers lead); payable = /payables. */
  variant: PartyMonthlySummaryVariant;
  /** The host page's own data-card skin (`.debt-data-card` / `.payables-data-card`). */
  className?: string;
}) {
  // The section is accounting-staff tooling: hidden for roles the period
  // report's requireRoles would 403, so the page never renders a dead panel.
  // The hook is null outside an AuthProvider (unwrapped render contexts) —
  // treated as no role, never a crash.
  const auth = useAuth();
  const role = auth?.user?.role;
  const allowed = canReadPeriodReport(role);

  const bounds = useMemo(calendarMonthBounds, []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);

  const period = { dateFrom: from, dateTo: to };
  const thu = useQuery({
    queryKey: periodReportKey('THU', from, to),
    queryFn: () => getPhoiPhieuReport('THU', period),
    enabled: allowed,
  });
  const tra = useQuery({
    queryKey: periodReportKey('TRA', from, to),
    queryFn: () => getPhoiPhieuReport('TRA', period),
    enabled: allowed,
  });
  // Reconciliation source: the SAME ledger endpoint/field the page's table
  // prints as Tổng nợ, so "còn nợ khớp số liệu công nợ hiện có" is structural.
  const ledger = useQuery({
    queryKey: ledgerOutstandingKey(variant),
    queryFn: () => fetchLedgerOutstandingMap(variant),
    enabled: allowed,
  });

  const rows = useMemo(
    () => mergeSummaryRows(thu.data?.rows ?? [], tra.data?.rows ?? [], ledger.data, variant),
    [thu.data, tra.data, ledger.data, variant],
  );
  const loading = thu.isLoading || tra.isLoading || ledger.isLoading;
  const error = [thu.error, tra.error, ledger.error].find(Boolean) as Error | undefined;

  // The role gate stays AFTER every hook (rules of hooks) — the queries above
  // are `enabled: allowed`, so a gated-out render never fetches either.
  if (!allowed) return null;

  const grandThu = thu.data?.grand;
  const grandTra = tra.data?.grand;
  const primaryGrand = variant === 'receivable' ? grandThu : grandTra;
  const tongConNo = round2dp(rows.reduce((sum, row) => sum + row.conNo, 0));

  const vatNote =
    'Tổng hợp công nợ theo tháng — Phải thu: ' +
    `${formatCurrency(round2dp(grandThu?.tongPhaiThuTra ?? 0))} · Phải trả: ` +
    `${formatCurrency(round2dp(grandTra?.tongPhaiThuTra ?? 0))} · VAT: ${DASH} (chưa có dữ liệu hóa đơn trong kỳ)`;

  return (
    <section className={`pm-summary${className ? ` ${className}` : ''}`} aria-label="Tổng hợp sản lượng vận tải theo tháng">
      <div className="pm-summary__head">
        <div>
          <h2 className="pm-summary__title">Tổng hợp sản lượng vận tải theo tháng</h2>
          <p className="pm-summary__sub">
            Đối soát cuối tháng theo khoảng Từ ngày – Đến ngày · SL và cước lấy từ báo cáo phôi phiếu kỳ ·
            còn nợ trùng sổ công nợ của trang
          </p>
        </div>
        <div className="pm-summary__period">
          <label className="pm-summary__period-field">
            <span>Từ ngày</span>
            <input
              type="date"
              className="input"
              name="pmSummaryFrom"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Tổng hợp sản lượng từ ngày"
            />
          </label>
          <label className="pm-summary__period-field">
            <span>Đến ngày</span>
            <input
              type="date"
              className="input"
              name="pmSummaryTo"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Tổng hợp sản lượng đến ngày"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="pm-summary__error" role="alert">{error.message || 'Lỗi tải tổng hợp sản lượng.'}</div>
      )}

      {loading ? (
        <div className="pm-summary__loading" role="status">Đang tải tổng hợp sản lượng…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          variant="compact"
          context={variant === 'receivable' ? 'debts' : 'payables'}
          title="Không có sản lượng vận tải trong kỳ đã chọn."
        />
      ) : (
        <>
          <div className="record-table-wrap record-table-wrap--scroll pm-summary__scroll">
            <table className="record-table ops-table pm-summary__table">
              <thead>
                <tr>
                  <th scope="col" rowSpan={2} className="pm-summary__stt">STT</th>
                  <th scope="col" rowSpan={2} className="pm-summary__party">Chủ xe</th>
                  <th scope="col" colSpan={3} className="pm-summary__group">Phải thu</th>
                  <th scope="col" colSpan={3} className="pm-summary__group">Phải trả</th>
                  <th scope="col" rowSpan={2} className="pm-summary__money-head">Đã thanh toán</th>
                  <th scope="col" colSpan={2} className="pm-summary__group">Tồn cuối kỳ</th>
                  <th scope="col" rowSpan={2} className="pm-summary__money-head pm-summary__conno-head">Còn nợ</th>
                  <th scope="col" rowSpan={2}>Số ĐNTT</th>
                  <th scope="col" rowSpan={2} className="pm-summary__invoice-head">% thuế · HĐ · số CT/ngày</th>
                  <th scope="col" rowSpan={2} className="pm-summary__act-head">Lập Phiếu</th>
                </tr>
                <tr>
                  <th scope="col" className="num pm-summary__sl">SL</th>
                  <th scope="col" className="num">Cước VC</th>
                  <th scope="col" className="num">Thuế</th>
                  <th scope="col" className="num pm-summary__sl">SL</th>
                  <th scope="col" className="num">Cước VC</th>
                  <th scope="col" className="num">Thuế</th>
                  <th scope="col" className="num">Phải thu</th>
                  <th scope="col" className="num">Phải trả</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.party}>
                    <td className="num pm-summary__stt">{index + 1}</td>
                    <td data-label="Chủ xe" className="pm-summary__party">{row.party}</td>
                    <td data-label="Phải thu SL" className="num">{row.slThu}</td>
                    <td data-label="Phải thu cước" className="num typo-mono">{formatCurrency(row.cuocThu)}</td>
                    <td data-label="Phải thu thuế" className="num pm-summary__gap">{DASH}</td>
                    <td data-label="Phải trả SL" className="num">{row.slTra}</td>
                    <td data-label="Phải trả cước" className="num typo-mono">{formatCurrency(row.cuocTra)}</td>
                    <td data-label="Phải trả thuế" className="num pm-summary__gap">{DASH}</td>
                    <td data-label="Đã thanh toán" className="num typo-mono">{formatCurrency(row.daThanhToan)}</td>
                    <td data-label="Tồn cuối kỳ phải thu" className="num typo-mono">{formatCurrency(row.tonCuoiThu)}</td>
                    <td data-label="Tồn cuối kỳ phải trả" className="num typo-mono">{formatCurrency(row.tonCuoiTra)}</td>
                    <td data-label="Còn nợ" className="num typo-mono pm-summary__conno">{formatCurrency(row.conNo)}</td>
                    <td data-label="Số ĐNTT" className="pm-summary__gap">{DASH}</td>
                    <td data-label="% thuế · HĐ · số CT/ngày" className="pm-summary__gap">{DASH}</td>
                    <td data-label="Lập Phiếu" className="pm-summary__act">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled
                        title="Chưa lập được từ bảng tổng hợp: cần tra cứu danh sách chuyến theo chủ xe trong kỳ (dịch vụ chưa có). Hãy lập phiếu từ bảng kiểm soát phôi phiếu."
                        aria-label={`Lập phiếu cho ${row.party} (chưa khả dụng)`}
                      >
                        Lập Phiếu
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pm-summary__totals">
                  <td colSpan={2}>Tổng cộng theo báo cáo kỳ</td>
                  <td className="num">{grandThu?.soLuong ?? 0}</td>
                  <td className="num typo-mono">{formatCurrency(round2dp(grandThu?.tongPhaiThuTra ?? 0))}</td>
                  <td className="num pm-summary__gap">{DASH}</td>
                  <td className="num">{grandTra?.soLuong ?? 0}</td>
                  <td className="num typo-mono">{formatCurrency(round2dp(grandTra?.tongPhaiThuTra ?? 0))}</td>
                  <td className="num pm-summary__gap">{DASH}</td>
                  <td className="num typo-mono">{formatCurrency(round2dp(primaryGrand?.daThuTra ?? 0))}</td>
                  <td className="num typo-mono">{formatCurrency(round2dp(grandThu?.conLai ?? 0))}</td>
                  <td className="num typo-mono">{formatCurrency(round2dp(grandTra?.conLai ?? 0))}</td>
                  <td className="num typo-mono pm-summary__conno">{formatCurrency(tongConNo)}</td>
                  <td colSpan={3} className="pm-summary__gap">VAT: {DASH}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="pm-summary__vat-note">{vatNote}</p>
        </>
      )}
    </section>
  );
}
