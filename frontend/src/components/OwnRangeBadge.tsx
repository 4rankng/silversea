import { useMonthOptional } from '../hooks/useMonth';
// The dedicated design-system period hook — the SAME query key as the
// topbar's (qk.catalogs.salaryPeriod) so the two surfaces share one cache;
// importing it separately keeps the chip out of the useCatalogQueries barrel,
// which test harnesses partially mock.
import { useSalaryPeriod } from '../design-system/hooks/useSalaryPeriod';
import { formatISODate } from '../lib/format';
import './OwnRangeBadge.css';

/**
 * Chip explaining a page that filters its OWN date range — different from the
 * header work period (e.g. a page defaulting 01/11–28/11 while the header
 * reads 01/11–30/11). Without it, the page totals and the header period read
 * as a contradiction; with it, the separate range is named right at the
 * page's filter. Display only — the chip owns no state and never changes the
 * period; the comparison reads the same source as the header (useMonth +
 * useSalaryPeriod, shared query cache) so the two surfaces cannot disagree.
 *
 * Hidden when: the header period is still unknown, the page has not chosen a
 * complete range (that is "everything", not a separate range), or the two
 * ranges are equal.
 */
export function OwnRangeBadge({ from, to }: { from: string; to: string }) {
  const monthContext = useMonthOptional();
  const { data: period } = useSalaryPeriod(monthContext?.month ?? 0, monthContext?.year ?? 0);
  if (!monthContext || !period || !from || !to) return null;
  if (period.start === from && period.end === to) return null;
  return (
    <span
      className="own-range-badge"
      title={`Trang này lọc ${formatISODate(from)} – ${formatISODate(to)}, khác kỳ làm việc ${formatISODate(period.start)} – ${formatISODate(period.end)} trên header`}
    >
      Đang dùng khoảng riêng
    </span>
  );
}
