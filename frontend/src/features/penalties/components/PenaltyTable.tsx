import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ShieldCheck, Download, Plus, FileText, Zap, Trophy, Users, DollarSign, XCircle, Loader2, UserRound, Search, X, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Panel, Btn, KPI, PageHeader } from '../../../components/UI';
import { Pagination, UuiSelectField } from '../../../design-system';
import { Money } from '../../../components/shared/Money';
import { formatCurrency, formatDate } from '../../../lib/format';
import { downloadCSV } from '../../../lib/csv';
import { PenaltyStatus } from '@tingting/shared';
import { getSeverity, getSeverityLabel, getViolationGrade, getGradeClass, formatTenure } from '../utils';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';
import { PenaltySeverityIcon } from './penalty-severity-icon';
import type { PenaltyInsightsScoreboardRow } from '../../../hooks/usePenalties';
import type { PenaltyStatusFilter, PenaltyScoreWindow, PenaltyTableProps } from './penalty-table-types';
import type { TableSortState } from '../../../lib/table-sort';
import '../../../styles/table-sort.css';

const STATUS_CHIPS: Array<{ key: PenaltyStatusFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: PenaltyStatus.ACTIVE, label: 'Chờ duyệt' },
  { key: PenaltyStatus.CANCELED, label: 'Đã hủy' },
];

const SCORE_WINDOWS: Array<{ key: PenaltyScoreWindow; label: string }> = [
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: '90d', label: '90 ngày' },
  { key: 'ytd', label: 'YTD' },
];

/** Violations shown for a scoreboard row under the active window. */
function violationsInWindow(row: PenaltyInsightsScoreboardRow, window: PenaltyScoreWindow): number {
  if (window === '7d') return row.violations7d;
  if (window === '30d') return row.violations30d;
  if (window === '90d') return row.violations90d;
  return row.violationsYtd;
}

/** Sortable header for the violation log — shared table-sort button so the
 * record-table typography contract stays authoritative. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSortChange,
  numeric = false,
}: {
  label: string;
  sortKey: string;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  numeric?: boolean;
}) {
  const active = sort?.by === sortKey;
  return (
    <th className={numeric ? 'num' : undefined} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="table-sort-button" onClick={() => onSortChange(sortKey)}>
        {label}
        {active
          ? (sort!.dir === 'asc'
            ? <ArrowUp size={13} aria-hidden="true" />
            : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
      </button>
    </th>
  );
}

export function PenaltyTable({
  rows,  total,
  page,
  pageSize,
  totalPages,
  listLoading,
  onPageChange,
  sort,
  onSortChange,
  statusCounts,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  driverFilter,
  onDriverFilterChange,
  hasActiveFilters,
  onResetFilters,
  drivers,
  reasons,
  insights,
  insightsLoading,
  monthLabel,
  canCancel,
  onOpenDrawer,
  onCancelPenalty,
}: PenaltyTableProps) {
  const navigate = useNavigate();
  // Window toggle is client-side — every window rides the insights payload.
  const [scoreFilter, setScoreFilter] = useState<PenaltyScoreWindow>('90d');

  // ── KPI strip (server-computed, selected salary period) ────────────────
  const incidentCount = insights?.month.incidentCount ?? 0;
  const totalMonthAmount = insights?.month.totalAmount ?? 0;
  const ytdTotal = insights?.ytd.total ?? 0;
  const teamSize = insights?.driverTotal ?? 0;
  const safeCount = insights?.safeDriverCount ?? 0;
  const comparisonLabel = insights?.month.comparisonLabel || '';

  // ── Status chips (full-set counts from the list envelope) ──────────────
  const chipCounts: Record<PenaltyStatusFilter, number> = {
    all: statusCounts?.all ?? total,
    [PenaltyStatus.ACTIVE]: statusCounts?.ACTIVE ?? 0,
    [PenaltyStatus.CANCELED]: statusCounts?.CANCELED ?? 0,
  };

  // ── Safe-streak KPI (whole-history streaks, window-independent) ────────
  const longestStreak = insights?.longestStreak ?? 0;
  const streakLeader = insights?.streakLeader || '—';

  // ── Scoreboard (insights rows + catalog tenure) ────────────────────────
  const tenureByDriver = new Map(drivers.map(d => [d.id, d.createdAt] as const));
  const scoreboardRows = (insights?.scoreboard ?? []).map(row => {
    const tenureCreatedAt = tenureByDriver.get(row.driverId);
    return {
      ...row,
      tenure: tenureCreatedAt ? formatTenure(tenureCreatedAt) : null,
      grade: scoreFilter === '90d' ? row.grade : getViolationGrade(violationsInWindow(row, scoreFilter)),
      violations: violationsInWindow(row, scoreFilter),
    };
  });
  const avgStreak = insights?.avgStreak ?? 0;
  const driversOver90 = insights?.driversOver90 ?? 0;
  const driversOver6m = insights?.driversOver6m ?? 0;

  const handleExport = async () => {
    const headers = ['Lái xe', 'Mã chuyến', 'Lý do', 'Số tiền', 'Ngày'];
    await downloadCSV(`ky-luat-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows.map(p => [
      p.driverName || '—',
      p.tripCode || '—',
      p.reasonText || p.customReason || '—',
      p.amount,
      p.date,
    ]), {
      title: 'SỔ KỶ LUẬT LÁI XE',
      subtitle: `${rows.length} biên bản trang hiện tại · tổng ${total} biên bản`,
      columnTypes: ['text', 'text', 'text', 'currency', 'date'],
      totalsColumns: [3],
      totalsLabel: 'TỔNG PHẠT',
    });
  };

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
          <Btn variant="secondary" icon={<Download size={14} />} onClick={handleExport}>
            Xuất báo cáo (trang hiện tại)
          </Btn>
          <Btn variant="primary" icon={<Plus size={14} />} onClick={() => onOpenDrawer()}>
            Lập biên bản
          </Btn>
          </>
        }
      />

      {/* ── KPI strip (4 cards, server-computed) ────────────────────────── */}
      {insightsLoading ? (
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
              <span className="pos">{comparisonLabel || 'Không có so sánh'}</span>
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
              <span style={{ fontFamily: 'var(--font-data)', color: 'var(--ink-2)' }}>YTD {formatCurrency(ytdTotal)}</span>
            </span>
          }
        />
        <KPI
          label="Lái xe đạt chuẩn"
          value={safeCount}
          unit={`/${teamSize} lái xe`}
          icon={Users}
          assetIconName="driver"
          variant="info"
          meta={
            <span className="penalty-kpi-meta">
              <span className="dot" />
              <span className="pos">{teamSize > 0 ? Math.round(safeCount / teamSize * 100) : 0}% toàn đội</span>
              <span className="sep">·</span>
              <span>{teamSize - safeCount} cần nhắc nhở</span>
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
                <span className="count-pill">{scoreboardRows.length}</span>
              </div>
              <div className="penalty-card-sub">Sắp xếp theo chuỗi ngày an toàn và mức vi phạm nghiệp vụ</div>
            </div>
          </div>
          <div className="penalty-head-tools">
            <div className="penalty-seg">
              {SCORE_WINDOWS.map(f => (
                <button
                  key={f.key}
                  className={scoreFilter === f.key ? 'active' : ''}
                  onClick={() => setScoreFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mobile-only">
          <div className="penalty-m-cards">
            {scoreboardRows.map((d) => {
              const gc = getGradeClass(d.grade);
              const vClass = d.violations === 0 ? 'zero' : d.violations <= 2 ? 'warn' : 'danger';
              return (
                <div key={d.driverId} className="penalty-m-card" onClick={() => onOpenDrawer(d.driverId)}>
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
                      <span className="lab">Vi phạm (kỳ lọc)</span>
                      <span className={vClass === 'zero' ? 'val empty' : `val ${vClass}`}>
                        {d.violations} vụ
                      </span>
                    </div>
                    <div className="mm">
                      <span className="lab">Phạt YTD</span>
                      <span className={d.fineYtd > 0 ? 'val danger' : 'val empty'}>
                        {d.fineYtd > 0 ? `${formatCurrency(d.fineYtd)} ₫` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="penalty-table-foot">
            <div className="legend">
              <span>TB: <strong style={{ fontFamily: 'var(--font-data)', color: 'var(--ink)' }}>{avgStreak} ngày</strong></span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{driversOver90} đạt 90 ngày</span>
            </div>
          </div>
        </div>
        <div className="desktop-only">
          <div className="record-table-wrap penalty-scoreboard-wrap">
            <table className="record-table ops-table penalty-scoreboard-table">
              <thead>
                <tr>
                  <th style={{ width: 54, textAlign: 'center' }}>STT</th>
                  <th>Lái xe</th>
                  <th>Chuỗi an toàn</th>
                  <th>Vi phạm {scoreFilter === '90d' ? '90N' : scoreFilter.toUpperCase()}</th>
                  <th>Phạt YTD</th>
                  <th style={{ textAlign: 'center' }}>Mức</th>
                </tr>
              </thead>
              <tbody>
                {scoreboardRows.map((d, idx) => {
                  const rankClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : '';
                  const streakPct = Math.min(100, (d.streakDays / 180) * 100);
                  const vClass = d.violations === 0 ? 'zero' : d.violations <= 2 ? 'warn' : 'bad';
                  const moneyClass = d.fineYtd === 0 ? 'zero' : '';
                  const gc = getGradeClass(d.grade);
                  return (
                    <tr key={d.driverId} onClick={() => onOpenDrawer(d.driverId)} style={{ cursor: 'pointer' }}>
                      <td data-label="" style={{ textAlign: 'center' }}>
                        <span className={`penalty-rank ${rankClass}`}>{idx + 1}</span>
                      </td>
                      <td data-label="Lái xe">
                        <span className="penalty-driver-cell">
                          <span className="penalty-driver-mini">
                            <UserRound size={14} aria-hidden="true" />
                          </span>
                          <span className="penalty-driver-info">
                            <div className="name">{d.name}</div>
                            <div className="role">
                              {[d.truckPlate || 'Chưa phân xe', d.tenure].filter(Boolean).join(' · ')}
                            </div>
                          </span>
                        </span>
                      </td>
                      <td data-label="Chuỗi an toàn">
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
                      <td data-label="Vi phạm">
                        <span className={`penalty-violation-count ${vClass}`}>
                          <span className="dot" />
                          {d.violations} vụ
                        </span>
                      </td>
                      <td data-label="Phạt YTD" className="num">
                        <span className={`penalty-money ${moneyClass}`}>
                          {d.fineYtd > 0 ? formatCurrency(d.fineYtd) : `0`}<span className="unit">đ</span>
                        </span>
                      </td>
                      <td data-label="Mức" style={{ textAlign: 'center' }}>
                        <span className={`penalty-grade ${gc}`}>{d.grade}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="penalty-table-foot">
            <div className="legend">
              <span>TB chuỗi an toàn: <strong style={{ fontFamily: 'var(--font-data)', color: 'var(--ink)' }}>{avgStreak} ngày</strong></span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{driversOver90} lái xe đạt mốc 90 ngày</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{driversOver6m} lái xe vượt 6 tháng</span>
            </div>
            <span>Hiển thị {scoreboardRows.length}/{scoreboardRows.length}</span>
          </div>
        </div>
      </Panel>

      {/* ── Violation log (full width so the record table keeps table mode) ── */}
      <Panel flush className="penalty-transparent-panel penalty-log-panel">
          <div className="penalty-card-head">
            <div className="penalty-card-lead">
              <div className="penalty-card-icon alt">
                <FileText size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="penalty-card-title">
                  Sổ biên bản vi phạm
                  <span className="count-pill">{total}</span>
                </div>
                <div className="penalty-card-sub">Lịch sử biên bản đã lập và khấu trừ lương</div>
              </div>
            </div>
            <div className="penalty-head-tools">
              {STATUS_CHIPS.map(f => (
                <button
                  key={f.key}
                  className={`penalty-chip${statusFilter === f.key ? ' active' : ''}`}
                  onClick={() => onStatusFilterChange(f.key)}
                >
                  {f.label}
                  <span className="count">
                    {chipCounts[f.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Filter toolbar — search + driver, scoped to the salary period */}
          <div className="penalty-filter-bar">
            <div className="penalty-filter-bar__search">
              <Search size={14} />
              <input
                type="text"
                aria-label="Tìm biên bản"
                placeholder="Tìm lái xe, mã chuyến, lý do..."
                value={search}
                onChange={e => onSearchChange(e.target.value)}
              />
              {search && (
                <button
                  className="penalty-filter-bar__clear"
                  onClick={() => onSearchChange('')}
                  title="Xóa tìm kiếm"
                  aria-label="Xóa nội dung tìm kiếm"
                  type="button"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <UuiSelectField
              id="penalty-driver-filter"
              label="Lái xe"
              inline
              value={driverFilter == null ? '' : String(driverFilter)}
              onChange={e => onDriverFilterChange(e.target.value ? Number(e.target.value) : undefined)}
              controlClassName="penalty-filter-bar__select"
              options={[
                { value: '', label: 'Tất cả lái xe' },
                ...drivers.map(d => ({ value: String(d.id), label: d.name })),
              ]}
            />
            {hasActiveFilters && (
              <button className="penalty-filter-bar__reset" onClick={onResetFilters} type="button">
                <X size={12} /> Xóa bộ lọc
              </button>
            )}
          </div>

          {listLoading ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <div className="spin" style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid var(--line-2)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} />
            </div>
          ) : rows.length === 0 ? (
            <div className="penalty-empty-log">
              <div className="penalty-empty-icon-wrap">
                <ShieldCheck size={36} strokeWidth={2.5} />
              </div>
              <div className="penalty-empty-title">Toàn đội đang giữ chuẩn nghiệp vụ</div>
              <div className="penalty-empty-desc">
                Chưa có biên bản vi phạm nào khớp bộ lọc trong kỳ này. Hệ thống sẽ tự động khấu trừ vào bảng lương khi biên bản được duyệt.
              </div>
              <div className="penalty-empty-stats">
                <div className="penalty-empty-stat">
                  <div className="lbl">Chuỗi an toàn</div>
                  <div className="val pos">{longestStreak}<span className="u">ngày</span></div>
                </div>
                <div className="penalty-empty-divider" />
                <div className="penalty-empty-stat">
                  <div className="lbl">Vi phạm YTD</div>
                  <div className="val">{insights?.ytd.count ?? 0}<span className="u">vụ</span></div>
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
              {/* Record table — shared base provides sticky thead, neutral
                  gated hover and mobile record cards via container queries. */}
              <div className="record-table-wrap penalty-log-wrap">
                <table className="record-table ops-table penalty-log-table">
                  <thead>
                    <tr>
                      <SortHeader label="Lái xe" sortKey="driverName" sort={sort} onSortChange={onSortChange} />
                      <SortHeader label="Lý do" sortKey="reason" sort={sort} onSortChange={onSortChange} />
                      <SortHeader label="Ngày" sortKey="date" sort={sort} onSortChange={onSortChange} />
                      <SortHeader label="Chuyến" sortKey="tripCode" sort={sort} onSortChange={onSortChange} />
                      <SortHeader label="Số tiền" sortKey="amount" sort={sort} onSortChange={onSortChange} numeric />
                      {canCancel && <th style={{ width: 44 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(p => {
                      const canceled = p.status === 'CANCELED';
                      return (
                        <tr key={p.id} className={canceled ? 'penalty-log-row--canceled' : undefined}>
                          <td data-label="Lái xe">
                            <span className="penalty-log-driver">
                              <span className="penalty-log-avatar">
                                <UserRound size={14} aria-hidden="true" />
                              </span>
                              <span className="penalty-log-driver-name">{p.driverName || 'Lái xe'}</span>
                            </span>
                          </td>
                          <td data-label="Lý do">{p.reasonText || p.customReason || '—'}</td>
                          <td data-label="Ngày">{formatDate(p.date)}</td>
                          <td data-label="Chuyến">
                            {p.tripId && p.tripCode ? (
                              <a
                                href={`/trips/${p.tripId}`}
                                onClick={(e) => { e.preventDefault(); navigate(`/trips/${p.tripId}`); }}
                                className="penalty-log-trip"
                              >{p.tripCode}</a>
                            ) : '—'}
                          </td>
                          <td data-label="Số tiền" className="num">
                            <Money value={Number(p.amount)} sign="-" className="penalty-log-money" />
                          </td>
                          {canCancel && (
                            <td data-label="" className="record-table__action">
                              {!canceled && (
                                <button
                                  className="penalty-row-act"
                                  style={{ color: 'var(--danger)' }}
                                  aria-label="Hủy kỷ luật"
                                  title="Hủy kỷ luật"
                                  onClick={() => onCancelPenalty(p)}
                                  type="button"
                                >
                                  <XCircle size={14} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={pageSize}
                onChange={onPageChange}
                disabled={listLoading}
              />
            </>
          )}
        </Panel>

      {/* ── Violation type reference ─────────────────────────────────────── */}
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
              <span>Cập nhật lần cuối: <strong style={{ fontFamily: 'var(--font-data)', color: 'var(--ink)' }}>{formatDate(new Date().toISOString().slice(0, 10))}</strong></span>
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
    </>
  );
}
