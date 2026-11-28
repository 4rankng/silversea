import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { fleetProductivityClient } from '../../api/fleetProductivityClient';
import { qk } from '../../api/keys';
import { Btn } from '../../components/UI';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { EmptyState, FilterBar } from '../../design-system';
import { SkeletonTable } from '../../components/shared/Skeleton';
import { useToast } from '../../components/shared/Toast';
import { NumUnit, PctUnit } from './NumericUnit';

// Card 071026141600: every header carries its full label as `title` (see
// NumericUnit.tsx for the numeric-unit law this screen shares with monthly).
const DAILY_HEADERS = [
  'STT',
  'Biển số xe',
  'Lái xe chính',
  'Tổng chuyến',
  "Kẹp ghép (2×20')",
  'Kết hợp (2 chiều)',
  'Lấy lẻ chuyển kho',
  'Chuyến đơn',
  '% Năng suất cao',
  'Số Bill/Booking',
] as const;

export function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DailyProductivityView() {
  const [dailyDate, setDailyDate] = useState<string>(getTodayString);

  const dailyQuery = useQuery({
    queryKey: qk.fleetProductivity.daily(dailyDate),
    queryFn: () => fleetProductivityClient.getDaily(dailyDate),
    enabled: !!dailyDate,
  });

  const dailyData = dailyQuery.data;

  const [exportError, setExportError] = useState<string | null>(null);
  // Card 20261006_391 — export feedback contract (FinancePage pattern): the
  // happy path must not stay silent after the failure surface already exists.
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  async function handleExportExcel() {
    // Authenticated blob download (card 346) — the house export pattern. The
    // bare window.open navigation carried no Authorization header and the API
    // answered {"error":"Token không hợp lệ"} every time.
    if (exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      const blob = await fleetProductivityClient.getDailyExportBlob(dailyDate);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bao-cao-nang-suat-xe-noi-bo-ngay-${dailyDate}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ kind: 'success', message: 'Đã xuất báo cáo năng suất xe ra tệp Excel.' });
    } catch (exportError) {
      // Business refusals (4xx) carry the precise reason from the backend —
      // show it verbatim instead of the generic retry hint that hides it.
      const status = exportError && typeof exportError === 'object' && 'status' in exportError && typeof exportError.status === 'number' ? exportError.status : null;
      const raw = exportError && typeof exportError === 'object' && 'message' in exportError && typeof exportError.message === 'string' ? exportError.message.trim() : '';
      const detail = status != null && status >= 400 && status < 500 ? raw : '';
      setExportError(detail || 'Không xuất được báo cáo năng suất. Vui lòng thử lại.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <FilterBar>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', flex: 1 }}>
          <div style={{ width: 220 }}>
            <BufferedUuiDateInput
              label="Ngày báo cáo"
              value={dailyDate}
              onChange={setDailyDate}
            />
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <Btn
              variant="secondary"
              onClick={handleExportExcel}
              disabled={!dailyData || dailyData.trucks.length === 0 || exporting}
            >
              <Download size={14} style={{ marginRight: 6 }} />
              {exporting ? 'Đang xuất…' : 'Xuất Excel (theo ngày)'}
            </Btn>
          </div>
        </div>
      </FilterBar>

      {exportError && (
        <div role="alert" style={{ margin: '8px 0', color: 'var(--danger)' }}>{exportError}</div>
      )}

      {dailyQuery.isLoading ? (
        <SkeletonTable rows={5} />
      ) : dailyData ? (
        <>
          <div className="fleet-productivity-kpis">
            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">Tổng chuyến trong ngày</div>
              <div className="fleet-kpi-card__value"><NumUnit value={dailyData.fleetBreakdown.totalTrips} /></div>
              <div className="fleet-kpi-card__sub">
                Hoạt động: <NumUnit value={dailyData.activeInternalTrucks} /> / <NumUnit value={dailyData.totalInternalTrucks} /> xe
              </div>
            </div>

            <div className="fleet-kpi-card fleet-kpi-card--highlight">
              <div className="fleet-kpi-card__label">% Năng suất cao</div>
              <div className="fleet-kpi-card__value">
                <PctUnit value={dailyData.fleetBreakdown.highEfficiencyPct} />
              </div>
              <div className="fleet-kpi-card__sub">Kẹp + Kết hợp + Lấy lẻ</div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Kẹp ghép (2×20')</div>
              <div className="fleet-kpi-card__value"><PctUnit value={dailyData.fleetBreakdown.pctKep} /></div>
              <div className="fleet-kpi-card__sub">
                <NumUnit value={dailyData.fleetBreakdown.kepTrips} /> chuyến
              </div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Kết hợp (2 chiều)</div>
              <div className="fleet-kpi-card__value"><PctUnit value={dailyData.fleetBreakdown.pctKetHop} /></div>
              <div className="fleet-kpi-card__sub">
                <NumUnit value={dailyData.fleetBreakdown.ketHopTrips} /> chuyến
              </div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Lấy lẻ chuyển kho</div>
              <div className="fleet-kpi-card__value"><PctUnit value={dailyData.fleetBreakdown.pctLayLe} /></div>
              <div className="fleet-kpi-card__sub">
                <NumUnit value={dailyData.fleetBreakdown.layLeTrips} /> chuyến
              </div>
            </div>

            <div className="fleet-kpi-card">
              <div className="fleet-kpi-card__label">% Chuyến đơn</div>
              <div className="fleet-kpi-card__value"><PctUnit value={dailyData.fleetBreakdown.pctDon} /></div>
              <div className="fleet-kpi-card__sub">
                <NumUnit value={dailyData.fleetBreakdown.donTrips} /> chuyến
              </div>
            </div>
          </div>

          {dailyData.trucks.length === 0 ? (
            <EmptyState
              context="trucks"
              title="Không có dữ liệu"
              description="Không tìm thấy chuyến xe nội bộ nào trong ngày đã chọn."
            />
          ) : (
            <div className="fleet-productivity-table-wrap">
              <table className="fleet-productivity-table">
                <thead>
                  <tr>
                    {DAILY_HEADERS.map((label) => (
                      <th key={label} title={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dailyData.trucks.map((row, idx) => (
                    <tr key={row.truckId}>
                      <td style={{ color: 'var(--text-muted)' }}><NumUnit value={idx + 1} /></td>
                      <td style={{ fontWeight: 600 }}>{row.licensePlate}</td>
                      <td>{row.driverName ?? <span style={{ color: 'var(--text-muted)' }}>Chưa gán</span>}</td>
                      <td style={{ fontWeight: 600 }}><NumUnit value={row.breakdown.totalTrips} /></td>
                      <td>
                        {row.breakdown.kepTrips > 0 ? (
                          <span className="fleet-badge fleet-badge--kep">
                            <NumUnit value={row.breakdown.kepTrips} /> (<PctUnit value={row.breakdown.pctKep} />)
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {row.breakdown.ketHopTrips > 0 ? (
                          <span className="fleet-badge fleet-badge--kethop">
                            <NumUnit value={row.breakdown.ketHopTrips} /> (<PctUnit value={row.breakdown.pctKetHop} />)
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {row.breakdown.layLeTrips > 0 ? (
                          <span className="fleet-badge fleet-badge--layle">
                            <NumUnit value={row.breakdown.layLeTrips} /> (<PctUnit value={row.breakdown.pctLayLe} />)
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {row.breakdown.donTrips > 0 ? (
                          <span className="fleet-badge fleet-badge--don">
                            <NumUnit value={row.breakdown.donTrips} /> (<PctUnit value={row.breakdown.pctDon} />)
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="fleet-pct" style={{ fontWeight: 600, color: row.breakdown.highEfficiencyPct > 0 ? 'var(--color-primary)' : 'var(--text-muted)' }}>
                        <PctUnit value={row.breakdown.highEfficiencyPct} />
                      </td>
                      <td>
                        {/* KB §1.4.3 (V25): chips carry the Bill/Booking — the
                            internal TRP-* code never renders on this screen. */}
                        <div className="fleet-trip-chips">
                          {row.tripReferences.length > 0 ? (
                            row.tripReferences.map((reference) => (
                              <span key={reference} className="fleet-trip-chip">
                                {reference}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Không chạy</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>TỔNG CỘNG TOÀN ĐỘI</td>
                    <td><NumUnit value={dailyData.fleetBreakdown.totalTrips} /></td>
                    <td>
                      <NumUnit value={dailyData.fleetBreakdown.kepTrips} /> (<PctUnit value={dailyData.fleetBreakdown.pctKep} />)
                    </td>
                    <td>
                      <NumUnit value={dailyData.fleetBreakdown.ketHopTrips} /> (<PctUnit value={dailyData.fleetBreakdown.pctKetHop} />)
                    </td>
                    <td>
                      <NumUnit value={dailyData.fleetBreakdown.layLeTrips} /> (<PctUnit value={dailyData.fleetBreakdown.pctLayLe} />)
                    </td>
                    <td>
                      <NumUnit value={dailyData.fleetBreakdown.donTrips} /> (<PctUnit value={dailyData.fleetBreakdown.pctDon} />)
                    </td>
                    <td className="fleet-pct"><PctUnit value={dailyData.fleetBreakdown.highEfficiencyPct} /></td>
                    <td>
                      <NumUnit value={dailyData.activeInternalTrucks} /> xe lăn bánh / <NumUnit value={dailyData.totalInternalTrucks} /> xe
                    </td>
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
