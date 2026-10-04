import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { fleetProductivityClient } from '../../api/fleetProductivityClient';
import { qk } from '../../api/keys';
import { Btn } from '../../components/UI';
import { EmptyState, FilterBar, UuiSelectField } from '../../design-system';
import { SkeletonTable } from '../../components/shared/Skeleton';

export function MonthlyProductivityView() {
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [monthlyYear, setMonthlyYear] = useState<number>(currentYear);
  const [monthlyMonth, setMonthlyMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [monthlyTruckId, setMonthlyTruckId] = useState<string>('');

  const monthlyQuery = useQuery({
    queryKey: qk.fleetProductivity.monthly(
      monthlyYear,
      monthlyMonth,
      monthlyTruckId ? Number(monthlyTruckId) : undefined
    ),
    queryFn: () =>
      fleetProductivityClient.getMonthly(
        monthlyYear,
        monthlyMonth,
        monthlyTruckId ? Number(monthlyTruckId) : undefined
      ),
  });

  const monthlyData = monthlyQuery.data;

  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` })),
    []
  );

  const yearOptions = useMemo(() => {
    return [currentYear - 1, currentYear, currentYear + 1].map((y) => ({
      value: String(y),
      label: `Năm ${y}`,
    }));
  }, [currentYear]);

  const truckOptions = useMemo(() => {
    const list = monthlyData?.trucks ?? [];
    return [
      { value: '', label: 'Tất cả xe nội bộ' },
      ...list.map((t) => ({ value: String(t.truckId), label: t.licensePlate })),
    ];
  }, [monthlyData?.trucks]);

  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportExcel() {
    // Authenticated blob download (card 346) — the house export pattern. The
    // old window.open(bare URL) navigation carried no Authorization header and
    // the API answered {"error":"Token không hợp lệ"} every time.
    setExportError(null);
    try {
      const blob = await fleetProductivityClient.getMonthlyExportBlob(monthlyYear, monthlyMonth);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bao-cao-nang-suat-xe-noi-bo-${monthlyMonth}-${monthlyYear}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Không xuất được báo cáo năng suất. Vui lòng thử lại.');
    }
  }

  return (
    <>
      <FilterBar>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', flex: 1 }}>
          <div style={{ width: 140 }}>
            <UuiSelectField
              label="Tháng"
              value={String(monthlyMonth)}
              onChange={(e) => setMonthlyMonth(Number(e.target.value))}
              options={monthOptions}
            />
          </div>

          <div style={{ width: 140 }}>
            <UuiSelectField
              label="Năm"
              value={String(monthlyYear)}
              onChange={(e) => setMonthlyYear(Number(e.target.value))}
              options={yearOptions}
            />
          </div>

          <div style={{ width: 220 }}>
            <UuiSelectField
              label="Xe nội bộ"
              value={monthlyTruckId}
              onChange={(e) => setMonthlyTruckId(e.target.value)}
              options={truckOptions}
            />
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <Btn
              variant="secondary"
              onClick={handleExportExcel}
              disabled={!monthlyData || monthlyData.trucks.length === 0}
            >
              <Download size={14} style={{ marginRight: 6 }} />
              Xuất Excel
            </Btn>
          </div>
        </div>
      </FilterBar>

      {exportError && (
        <div role="alert" style={{ margin: '8px 0', color: 'var(--danger)' }}>{exportError}</div>
      )}

      {monthlyQuery.isLoading ? (
        <SkeletonTable rows={8} />
      ) : monthlyData ? (
        <>
          <div className="fleet-productivity-kpis">
            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">Tổng chuyến trong tháng</div>
              <div className="fleet-kpi-card__value">
                {monthlyData.fleetBreakdown.totalTrips}
              </div>
              <div className="fleet-kpi-card__sub">
                Hoạt động: {monthlyData.activeInternalTrucks} / {monthlyData.totalInternalTrucks} xe
              </div>
            </div>

            <div className="fleet-kpi-card fleet-kpi-card--highlight">
              <div className="fleet-kpi-card__label">% Năng suất cao TB</div>
              <div className="fleet-kpi-card__value">
                {monthlyData.fleetBreakdown.highEfficiencyPct}%
              </div>
              <div className="fleet-kpi-card__sub">Kẹp + Kết hợp + Lấy lẻ</div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Kẹp ghép TB</div>
              <div className="fleet-kpi-card__value">{monthlyData.fleetBreakdown.pctKep}%</div>
              <div className="fleet-kpi-card__sub">
                {monthlyData.fleetBreakdown.kepTrips} chuyến
              </div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Kết hợp TB</div>
              <div className="fleet-kpi-card__value">
                {monthlyData.fleetBreakdown.pctKetHop}%
              </div>
              <div className="fleet-kpi-card__sub">
                {monthlyData.fleetBreakdown.ketHopTrips} chuyến
              </div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Lấy lẻ chuyển kho TB</div>
              <div className="fleet-kpi-card__value">{monthlyData.fleetBreakdown.pctLayLe}%</div>
              <div className="fleet-kpi-card__sub">
                {monthlyData.fleetBreakdown.layLeTrips} chuyến
              </div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Chuyến đơn TB</div>
              <div className="fleet-kpi-card__value">{monthlyData.fleetBreakdown.pctDon}%</div>
              <div className="fleet-kpi-card__sub">
                {monthlyData.fleetBreakdown.donTrips} chuyến
              </div>
            </div>
          </div>

          {monthlyData.trucks.length === 0 ? (
            <EmptyState
              context="trucks"
              title="Không có dữ liệu"
              description="Không tìm thấy chuyến xe nội bộ nào trong tháng đã chọn."
            />
          ) : (
            <div className="fleet-productivity-table-wrap">
              <table className="fleet-productivity-table">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Biển số xe</th>
                    <th>Lái xe chính</th>
                    <th>Tổng số chuyến</th>
                    <th>Kẹp ghép (2×20')</th>
                    <th>% Kẹp</th>
                    <th>Kết hợp (2 chiều)</th>
                    <th>% Kết hợp</th>
                    <th>Lấy lẻ chuyển kho</th>
                    <th>% Lấy lẻ</th>
                    <th>Chuyến đơn</th>
                    <th>% Đơn</th>
                    <th>% Năng suất cao</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.trucks.map((row, idx) => (
                    <tr key={row.truckId}>
                      <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600 }}>{row.licensePlate}</td>
                      <td>{row.driverName ?? <span style={{ color: 'var(--text-muted)' }}>Chưa gán</span>}</td>
                      <td style={{ fontWeight: 600 }}>{row.breakdown.totalTrips}</td>
                      <td>{row.breakdown.kepTrips}</td>
                      <td>
                        <span className="fleet-badge fleet-badge--kep">
                          {row.breakdown.pctKep}%
                        </span>
                      </td>
                      <td>{row.breakdown.ketHopTrips}</td>
                      <td>
                        <span className="fleet-badge fleet-badge--kethop">
                          {row.breakdown.pctKetHop}%
                        </span>
                      </td>
                      <td>{row.breakdown.layLeTrips}</td>
                      <td>
                        <span className="fleet-badge fleet-badge--layle">
                          {row.breakdown.pctLayLe}%
                        </span>
                      </td>
                      <td>{row.breakdown.donTrips}</td>
                      <td>
                        <span className="fleet-badge fleet-badge--don">
                          {row.breakdown.pctDon}%
                        </span>
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          color: row.breakdown.highEfficiencyPct > 0 ? 'var(--color-primary)' : 'var(--text-muted)',
                        }}
                      >
                        {row.breakdown.highEfficiencyPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>TỔNG CỘNG TOÀN ĐỘI</td>
                    <td>{monthlyData.fleetBreakdown.totalTrips}</td>
                    <td>{monthlyData.fleetBreakdown.kepTrips}</td>
                    <td>{monthlyData.fleetBreakdown.pctKep}%</td>
                    <td>{monthlyData.fleetBreakdown.ketHopTrips}</td>
                    <td>{monthlyData.fleetBreakdown.pctKetHop}%</td>
                    <td>{monthlyData.fleetBreakdown.layLeTrips}</td>
                    <td>{monthlyData.fleetBreakdown.pctLayLe}%</td>
                    <td>{monthlyData.fleetBreakdown.donTrips}</td>
                    <td>{monthlyData.fleetBreakdown.pctDon}%</td>
                    <td>{monthlyData.fleetBreakdown.highEfficiencyPct}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
