import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMonth } from '../../../hooks/useMonth';
import { Shield, ShieldCheck, Download, Plus, FileText, Zap, Trophy, Users, DollarSign, XCircle, Loader2, UserRound } from 'lucide-react';
import { Panel, Btn, KPI, PageHeader } from '../../../components/UI';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { formatCurrency, formatDate } from '../../../lib/format';
import { downloadCSV } from '../../../lib/csv';
import type { Truck } from '@tingting/shared';
import { useSalaryPeriod } from '../../../hooks/useQueries';
import { getSeverity, getSeverityLabel, getViolationGrade, getGradeClass, formatTenure, computeStreak } from '../utils';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';
import { PenaltySeverityIcon } from './penalty-severity-icon';
import type { PenaltyTableProps } from './penalty-table-types';

export function PenaltyTable({
  penalties,
  drivers,
  reasons,
  trucks,
  listLoading,
  canCancel,
  onOpenDrawer,
  onCancelPenalty,
}: PenaltyTableProps) {
  const navigate = useNavigate();
  const [scoreFilter, setScoreFilter] = useState<'7d' | '30d' | '90d' | 'ytd'>('90d');
  const [logFilter, setLogFilter] = useState<'all' | 'pending' | 'deducted'>('all');
  const [logDriverFilter, setLogDriverFilter] = useState<number | null>(null);

  const { month: selMonth, year: selYear } = useMonth();

  const { data: salaryPeriod, isLoading: periodLoading } = useSalaryPeriod(selMonth, selYear);
  const prevMonthNum = selMonth === 1 ? 12 : selMonth - 1;
  const prevYearNum = selMonth === 1 ? selYear - 1 : selYear;
  const { data: prevSalaryPeriod } = useSalaryPeriod(prevMonthNum, prevYearNum);

  const truckMap = new Map<number, Truck>();
  trucks.forEach(t => truckMap.set(t.id, t));

  const now = new Date();
  const monthLabel = `${String(selMonth).padStart(2, '0')}/${String(selYear).slice(-2)}`;

  const monthPenalties = penalties.filter(p => {
    if (!salaryPeriod) return false;
    const d = p.date || '';
    return d >= salaryPeriod.start && d <= salaryPeriod.end;
  });
  const totalMonthAmount = monthPenalties.reduce((s, p) => s + parseFloat(p.amount), 0);
  const incidentCount = monthPenalties.length;

  const prevMonthCount = prevSalaryPeriod
    ? penalties.filter(p => {
        const d = p.date || '';
        return d >= prevSalaryPeriod.start && d <= prevSalaryPeriod.end;
      }).length
    : 0;
  const monthComparison = prevMonthCount > 0
    ? `Giảm ${Math.round((1 - incidentCount / prevMonthCount) * 100)}% so với ${String(prevMonthNum).padStart(2, '0')}/${String(prevYearNum).slice(-2)}`
    : incidentCount === 0 ? 'Tháng an toàn' : '';

  const penalizedDriverIds = new Set(monthPenalties.map(p => p.driverId));
  const safeCount = drivers.filter(d => !penalizedDriverIds.has(d.id)).length;

  const yearStart = `${now.getFullYear()}-01-01`;
  const ytdPenalties = penalties.filter(p => p.date >= yearStart);
  const ytdTotal = ytdPenalties.reduce((s, p) => s + parseFloat(p.amount), 0);

  const cutoffDate = new Date();
  if (scoreFilter === '7d') cutoffDate.setDate(cutoffDate.getDate() - 7);
  else if (scoreFilter === '30d') cutoffDate.setDate(cutoffDate.getDate() - 30);
  else if (scoreFilter === '90d') cutoffDate.setDate(cutoffDate.getDate() - 90);
  else cutoffDate.setMonth(0, 1);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const driverDetails = drivers.map(d => {
    const streakDays = computeStreak(d.id, penalties, d.createdAt);
    const driverPenalties = penalties.filter(p => p.driverId === d.id && p.date >= cutoffStr);
    const violationsInPeriod = driverPenalties.length;
    const driverYTD = ytdPenalties.filter(p => p.driverId === d.id);
    const fineYTD = driverYTD.reduce((s, p) => s + parseFloat(p.amount), 0);
    const grade = getViolationGrade(violationsInPeriod);
    const truckPlate = d.assignedTruckId && truckMap.has(d.assignedTruckId)
      ? truckMap.get(d.assignedTruckId)!.licensePlate: null;
    return { ...d, streakDays, violationsInPeriod, fineYTD, grade, truckPlate };
  }).sort((a, b) => b.streakDays - a.streakDays || a.violationsInPeriod - b.violationsInPeriod);

  const longestStreak = driverDetails.reduce((max, d) => Math.max(max, d.streakDays), 0);
  const streakLeader = driverDetails.length > 0
    ? [...driverDetails]
        .sort((a, b) => b.streakDays - a.streakDays || a.violationsInPeriod - b.violationsInPeriod)[0]?.name || '—'
    : '—';
  const avgStreak = driverDetails.length > 0
    ? Math.round(driverDetails.reduce((s, d) => s + d.streakDays, 0) / driverDetails.length)
    : 0;
  const driversOver90 = driverDetails.filter(d => d.streakDays >= 90).length;
  const driversOver6m = driverDetails.filter(d => d.streakDays >= 180).length;

  const driverFiltered = logDriverFilter
    ? penalties.filter(p => p.driverId === logDriverFilter)
    : penalties;

  const filteredPenalties = logFilter === 'pending'
    ? driverFiltered.filter(p => p.status === 'ACTIVE')
    : logFilter === 'deducted'
      ? driverFiltered.filter(p => p.status === 'CANCELED')
      : driverFiltered;

  const pendingCount = driverFiltered.filter(p => p.status === 'ACTIVE').length;
  const deductedCount = driverFiltered.filter(p => p.status === 'CANCELED').length;

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            Kỷ luật
            <span className="penalty-month-pill">
              <span className="dot" />
              {monthLabel} · {incidentCount === 0 ? 'An toàn' : `${incidentCount} vụ`}
            </span>
          </span>
        }
        iconName="alert"
        description="Theo dõi vi phạm nghiệp vụ, mức phạt khấu trừ trực tiếp vào bảng lương lái xe"
        action={
          <>
          <Btn variant="secondary" icon={<Download size={14} />} onClick={async () => {
            const headers = ['Lái xe', 'Mã lệnh', 'Lý do', 'Số tiền', 'Ngày'];
            const rows = filteredPenalties.map(p => [
              p.driverName || '—',
              p.tripId ? String(p.tripId) : '—',
              p.reasonText || p.customReason || '—',
              p.amount,
              p.date,
            ]);
            await downloadCSV(`ky-luat-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
              title: 'SỔ KỶ LUẬT LÁI XE',
              subtitle: `${filteredPenalties.length} biên bản · khấu trừ trực tiếp vào lương lái xe`,
              columnTypes: ['text', 'text', 'text', 'currency', 'date'],
              totalsColumns: [3],
              totalsLabel: 'TỔNG PHẠT',
            });
          }}>
            Xuất báo cáo
          </Btn>
          <Btn variant="primary" icon={<Plus size={14} />} onClick={() => onOpenDrawer()}>
            Lập biên bản
          </Btn>
          </>
        }
      />

      {/* ── KPI strip (4 cards) ──────────────────────────────────────────── */}
      {periodLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0', color: 'var(--fg-3)', fontSize: 13 }}>
          <Loader2 size={16} className="spin" />
          Đang tải dữ liệu kỳ lương...
        </div>
      ) : (
      <div className="kpi-grid">
        <KPI
          label={`Vi phạm ${monthLabel}`}
          value={incidentCount}
          unit="vụ"
          icon={Shield}
          assetIconName="alert"
          variant="success"
          meta={
            <span className="penalty-kpi-meta">
              <span className="dot" />
              <span className="pos">{monthComparison || 'Không có so sánh'}</span>
            </span>
          }
        />
        <KPI
          label={`Tổng phạt ${monthLabel}`}
          value={formatCurrency(totalMonthAmount)}
          icon={DollarSign}
          assetIconName="unpaid"
          meta={
            <span className="penalty-kpi-meta">
              <span>Khấu trừ vào bảng lương</span>
              <span className="sep">·</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>YTD {formatCurrency(ytdTotal)}</span>
            </span>
          }
        />
        <KPI
          label="Lái xe đạt chuẩn"
          value={safeCount}
          unit={`/${drivers.length} lái xe`}
          icon={Users}
          assetIconName="driver"
          variant="info"
          meta={
            <span className="penalty-kpi-meta">
              <span className="dot" />
              <span className="pos">{drivers.length > 0 ? Math.round(safeCount / drivers.length * 100) : 0}% toàn đội</span>
              <span className="sep">·</span>
              <span>{drivers.length - safeCount} cần nhắc nhở</span>
            </span>
          }
        />
        <KPI
          label="Chuỗi an toàn"
          value={longestStreak}
          unit="ngày"
          icon={Zap}
          assetIconName="checklist"
          variant="warn"
          meta={
            <span className="penalty-kpi-meta">
              {longestStreak > 0
                ? <span>{streakLeader} dẫn đầu</span>
                : <span style={{ opacity: 0.7 }}>Chưa có dữ liệu chuỗi an toàn</span>}
            </span>
          }
        />
      </div>
      )}

      {/* ── Driver scoreboard ────────────────────────────────────────────── */}
      <Panel flush className="penalty-transparent-panel">
        <div className="penalty-card-head">
          <div className="penalty-card-lead">
            <div className="penalty-card-icon">
              <Trophy size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="penalty-card-title">
                Bảng xếp hạng lái xe
                <span className="count-pill">{drivers.length}</span>
              </div>
              <div className="penalty-card-sub">Sắp xếp theo chuỗi ngày an toàn và mức vi phạm nghiệp vụ</div>
            </div>
          </div>
          <div className="penalty-head-tools">
            <div className="penalty-seg">
              {(['7d', '30d', '90d', 'ytd'] as const).map(f => (
                <button
                  key={f}
                  className={scoreFilter === f ? 'active' : ''}
                  onClick={() => setScoreFilter(f)}
                >
                  {f === '7d' ? '7 ngày' : f === '30d' ? '30 ngày' : f === '90d' ? '90 ngày' : 'YTD'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mobile-only">
          <div className="penalty-m-cards">
            {driverDetails.map((d) => {
              const gc = getGradeClass(d.grade);
              const vClass = d.violationsInPeriod === 0 ? 'zero' : d.violationsInPeriod <= 2 ? 'warn' : 'danger';
              return (
                <div key={d.id} className="penalty-m-card" onClick={() => onOpenDrawer(d.id)}>
                  <div className="penalty-m-card__top">
                    <div className="left">
                      <div className="penalty-driver-avatar">
                        <UserRound size={18} aria-hidden="true" />
                      </div>
                      <div className="penalty-m-card__info">
                        <div className="penalty-m-card__name">{d.name}</div>
                        <div className="penalty-m-card__id">
                          {d.truckPlate || 'Chưa phân xe'}
                        </div>
                      </div>
                    </div>
                    <span className={`penalty-grade-badge ${gc}`}>
                      Hạng {d.grade}
                    </span>
                  </div>

                  <div className="penalty-m-card__meta">
                    <div className="mm">
                      <span className="lab">Chuỗi an toàn</span>
                      <span className={d.streakDays >= 90 ? 'val' : 'val empty'} style={d.streakDays >= 90 ? { color: 'var(--accent)' } : undefined}>
                        {d.streakDays} ngày
                      </span>
                    </div>
                    <div className="mm">
                      <span className="lab">Vi phạm (tháng)</span>
                      <span className={vClass === 'zero' ? 'val empty' : `val ${vClass}`}>
                        {d.violationsInPeriod} vụ
                      </span>
                    </div>
                    <div className="mm">
                      <span className="lab">Phạt YTD</span>
                      <span className={d.fineYTD > 0 ? 'val danger' : 'val empty'}>
                        {d.fineYTD > 0 ? `${formatCurrency(d.fineYTD)} ₫` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="penalty-table-foot">
            <div className="legend">
              <span>TB: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{avgStreak} ngày</strong></span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{driversOver90} đạt 90 ngày</span>
            </div>
          </div>
        </div>
        <div className="desktop-only">
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 48, textAlign: 'center' }}>#</th>
                    <th>Lái xe</th>
                    <th>Chuỗi an toàn</th>
                    <th>Vi phạm {scoreFilter === '90d' ? '90N' : scoreFilter.toUpperCase()}</th>
                    <th>Phạt YTD</th>
                    <th style={{ textAlign: 'center' }}>Mức</th>
                  </tr>
                </thead>
                <tbody>
                  {driverDetails.map((d, idx) => {
                    const rankClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : '';
                    const streakPct = Math.min(100, (d.streakDays / 180) * 100);
                    const vClass = d.violationsInPeriod === 0 ? 'zero' : d.violationsInPeriod <= 2 ? 'warn' : 'bad';
                    const moneyClass = d.fineYTD === 0 ? 'zero' : '';
                    const gc = getGradeClass(d.grade);
                    return (
                      <tr key={d.id} onClick={() => onOpenDrawer(d.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`penalty-rank ${rankClass}`}>{idx + 1}</span>
                        </td>
                        <td>
                          <span className="penalty-driver-cell">
                            <span className="penalty-driver-mini">
                              <UserRound size={14} aria-hidden="true" />
                            </span>
                            <span className="penalty-driver-info">
                              <div className="name">{d.name}</div>
                              <div className="role">
                                {d.truckPlate || 'Chưa phân xe'} · {formatTenure(d.createdAt)}
                              </div>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="penalty-streak">
                            <span className="penalty-streak-num">
                              {d.streakDays}<span className="unit">ngày</span>
                            </span>
                            <span className="penalty-streak-bar">
                              <span
                                className={`fill ${idx === 0 ? 'gold' : ''}`}
                                style={{ width: `${streakPct}%` }}
                              />
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={`penalty-violation-count ${vClass}`}>
                            <span className="dot" />
                            {d.violationsInPeriod} vụ
                          </span>
                        </td>
                        <td>
                          <span className={`penalty-money ${moneyClass}`}>
                            {d.fineYTD > 0 ? formatCurrency(d.fineYTD) : `0`}<span className="unit">đ</span>
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`penalty-grade ${gc}`}>{d.grade}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="penalty-table-foot">
            <div className="legend">
              <span>TB chuỗi an toàn: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{avgStreak} ngày</strong></span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{driversOver90} lái xe đạt mốc 90 ngày</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{driversOver6m} lái xe vượt 6 tháng</span>
            </div>
            <span>Hiển thị {drivers.length}/{drivers.length}</span>
          </div>
        </div>
      </Panel>

      {/* ── Two-column: Violation log + Violation type reference ─────────── */}
      <div className="penalty-two-col">

        {/* Left: Violation log */}
        <Panel flush className="penalty-transparent-panel">
          <div className="penalty-card-head">
            <div className="penalty-card-lead">
              <div className="penalty-card-icon alt">
                <FileText size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="penalty-card-title">
                  Sổ biên bản vi phạm
                  <span className="count-pill">{filteredPenalties.length}</span>
                </div>
                <div className="penalty-card-sub">Lịch sử biên bản đã lập và khấu trừ lương</div>
                {logDriverFilter && (() => {
                  const drv = drivers.find(dr => dr.id === logDriverFilter);
                  return drv ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--brand)', fontWeight: 600 }}>
                        Lọc theo: {drv.name}
                      </span>
                      <button
                        style={{ minHeight: 44, fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', background: 'var(--bg-2)', border: 'none', borderRadius: 6, padding: '0 10px', cursor: 'pointer' }}
                        onClick={() => setLogDriverFilter(null)}
                      >
                        ✕ Xóa lọc
                      </button>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
            <div className="penalty-head-tools">
              {(['all', 'pending', 'deducted'] as const).map(f => (
                <button
                  key={f}
                  className={`penalty-chip${logFilter === f ? ' active' : ''}`}
                  onClick={() => setLogFilter(f)}
                >
                  {f === 'all' ? 'Tất cả' : f === 'pending' ? 'Chờ duyệt' : 'Đã hủy'}
                  <span className="count">
                    {f === 'all' ? driverFiltered.length : f === 'pending' ? pendingCount : deductedCount}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {listLoading ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <div className="spin" style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid var(--line-2)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} />
            </div>
          ) : filteredPenalties.length === 0 ? (
            <div className="penalty-empty-log">
              <div className="penalty-empty-icon-wrap">
                <ShieldCheck size={36} strokeWidth={2.5} />
              </div>
              <div className="penalty-empty-title">Toàn đội đang giữ chuẩn nghiệp vụ</div>
              <div className="penalty-empty-desc">
                Chưa có biên bản vi phạm nào trong tháng này. Hệ thống sẽ tự động khấu trừ vào bảng lương khi biên bản được duyệt.
              </div>
              <div className="penalty-empty-stats">
                <div className="penalty-empty-stat">
                  <div className="lbl">Chuỗi an toàn</div>
                  <div className="val pos">{longestStreak}<span className="u">ngày</span></div>
                </div>
                <div className="penalty-empty-divider" />
                <div className="penalty-empty-stat">
                  <div className="lbl">Vi phạm YTD</div>
                  <div className="val">{ytdPenalties.length}<span className="u">vụ</span></div>
                </div>
                <div className="penalty-empty-divider" />
                <div className="penalty-empty-stat">
                  <div className="lbl">Tiết kiệm phạt</div>
                  <div className="val pos">~{formatCurrency(ytdTotal)}<span className="u">đ</span></div>
                </div>
              </div>
              <div className="penalty-empty-actions">
                <Btn variant="secondary" icon={<ShieldCheck size={13} />} onClick={() => navigate('/config/penalty-reasons')}>Xem nội quy</Btn>
                <Btn variant="primary" icon={<Plus size={13} />} onClick={() => onOpenDrawer()}>Lập biên bản</Btn>
              </div>
            </div>
          ) : (
            <>
              <div className="plog-list">
                {filteredPenalties.map(p => {
                  const canceled = p.status === 'CANCELED';
                  return (
                    <div key={p.id} className={`plog-item${canceled ? ' plog-item--canceled' : ''}`}>
                      <StatusStrip color={canceled ? '#94A3B8' : '#059669'} />
                      <div className="plog-avatar">
                        <UserRound size={15} aria-hidden="true" />
                      </div>
                      <div className="plog-body">
                        <div className="plog-name">{p.driverName || 'Lái xe'}</div>
                        <div className="plog-meta">
                          <span className="plog-reason">{p.reasonText || p.customReason || '—'}</span>
                          <span className="plog-sep">·</span>
                          <span className="plog-date">{formatDate(p.date)}</span>
                          {p.tripId && p.tripCode && (
                            <>
                              <span className="plog-sep">·</span>
                              <a
                                href={`/trips/${p.tripId}`}
                                onClick={(e) => { e.preventDefault(); navigate(`/trips/${p.tripId}`); }}
                                className="plog-trip"
                              >{p.tripCode}</a>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="plog-right">
                        <span className="plog-amount">-{formatCurrency(Number(p.amount))}</span>
                        {canCancel && !canceled && (
                          <button
                            className="penalty-row-act"
                            style={{ color: 'var(--danger)', marginTop: 2 }}
                            aria-label="Hủy kỷ luật"
                            onClick={() => onCancelPenalty(p)}
                          >
                            <XCircle size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="penalty-table-foot">
                <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-mono)' }}>{filteredPenalties.length}</strong> biên bản</span>
              </div>
            </>
          )}
        </Panel>

        {/* Right: Violation type reference */}
        <Panel flush className="penalty-transparent-panel">
          <div className="penalty-card-head">
            <div className="penalty-card-lead">
              <div className="penalty-card-icon">
                <FileText size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="penalty-card-title">
                  Phân loại vi phạm
                  <span className="count-pill">{reasons.length}</span>
                </div>
                <div className="penalty-card-sub">Bảng mức phạt nội quy 2026</div>
              </div>
            </div>
          </div>
          {reasons.length === 0 ? (
            <div className="penalty-empty-reasons">
              <img
                src={resolveEmptyIllustration('empty-penalty-reasons')}
                alt=""
                aria-hidden="true"
                className="penalty-empty-reasons__img"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="penalty-empty-reasons__title">Chưa có phân loại vi phạm</div>
              <div className="penalty-empty-reasons__desc">
                Thêm các mức phạt nội quy để hệ thống tự động áp dụng khi lập biên bản kỷ luật.
              </div>
              <Btn variant="secondary" icon={<Plus size={13} />} onClick={() => navigate('/config/penalty-reasons')}>
                Thêm nội quy đầu tiên
              </Btn>
            </div>
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {reasons.map((r, idx) => {
              const amount = Number(r.defaultAmount);
              const sev = getSeverity(amount);
              const code = `KL-${String(idx + 1).padStart(2, '0')}`;
              return (
                <div className="penalty-vio-type-row" key={r.id}>
                  <div className={`penalty-vio-type-icon ${sev}`}>
                    <PenaltySeverityIcon severity={sev} />
                  </div>
                  <div className="penalty-vio-type-info">
                    <div className="penalty-vio-type-name">{r.reasonText}</div>
                    <div className="penalty-vio-type-meta">
                      <span className={`penalty-sev-pill ${sev}`}>{getSeverityLabel(sev)}</span>
                      <span className="code">{code}</span>
                    </div>
                  </div>
                  <div className="penalty-vio-type-fine">
                    <div className="amt">{formatCurrency(amount)}</div>
                    <div className="lbl">/ lần</div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
          <div className="penalty-table-foot">
            <div className="legend">
              <span>Cập nhật lần cuối: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{formatDate(new Date().toISOString().slice(0, 10))}</strong></span>
            </div>
            <a
              href="/config/penalty-reasons"
              className="penalty-config-link"
              onClick={(e) => { e.preventDefault(); navigate('/config/penalty-reasons'); }}
            >
              Sửa bảng phạt →
            </a>
          </div>
        </Panel>
      </div>
    </>
  );
}
