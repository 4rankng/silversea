/**
 * 4 thẻ chỉ số nhanh (spec §1.1, SIL-156): tổng chuyến + phân rã kích cỡ,
 * chuyến xe nhà / đầu kéo hoạt động, chuyến xe ngoài, cảnh báo vận hành
 * (hàng Xuất thiếu thông số vỏ). Số liệu từ dispatchKpis — không hardcode.
 */
import { AlertTriangle } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import type { DispatchKpis } from './dispatch-model';

function KpiCard({
  label,
  value,
  sub,
  warning,
  testId,
}: {
  label: string;
  value: string | number;
  sub: string;
  warning?: boolean;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-secondary_alt bg-primary p-4 shadow-xs">
      <p className="text-sm font-medium text-tertiary">{label}</p>
      <p
        data-testid={testId}
        className={cx(
          'mt-1.5 text-display-xs font-semibold',
          warning && Number(value) > 0 ? 'text-utility-red-600' : 'text-primary',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-quaternary">{sub}</p>
    </div>
  );
}

export function DispatchKpiCards({ kpis }: { kpis: DispatchKpis }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="demo-dispatch-kpis">
      <KpiCard
        label="Tổng chuyến trong ngày"
        value={kpis.total}
        sub={`${kpis.size20} cont 20′ · ${kpis.size40} cont 40′`}
        testId="demo-kpi-total"
      />
      <KpiCard
        label="Chuyến xe nhà"
        value={kpis.inhouseTrips}
        sub={`${kpis.activeTrucks}/${kpis.totalTrucks} đầu kéo hoạt động`}
        testId="demo-kpi-inhouse"
      />
      <KpiCard
        label="Chuyến xe ngoài"
        value={kpis.vendorTrips}
        sub="Nhà xe phụ đang chạy"
        testId="demo-kpi-vendor"
      />
      <div
        className={cx(
          'rounded-xl border p-4 shadow-xs',
          kpis.specWarnings > 0 ? 'border-utility-orange-300 bg-utility-orange-50' : 'border-secondary_alt bg-primary',
        )}
      >
        <p className="flex items-center gap-1.5 text-sm font-medium text-tertiary">
          <AlertTriangle className="size-4 text-utility-orange-500" aria-hidden="true" />
          Cảnh báo vận hành
        </p>
        <p
          data-testid="demo-kpi-warnings"
          className={cx(
            'mt-1.5 text-display-xs font-semibold',
            kpis.specWarnings > 0 ? 'text-utility-red-600' : 'text-primary',
          )}
        >
          {kpis.specWarnings}
        </p>
        <p className="mt-1 text-xs text-quaternary">Hàng Xuất thiếu thông số vỏ (chì / trọng lượng)</p>
      </div>
    </div>
  );
}
