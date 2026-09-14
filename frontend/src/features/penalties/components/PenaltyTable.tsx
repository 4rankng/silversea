import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Download, Plus, FileText, Trophy, XCircle, Loader2, UserRound, Search, X, ChevronDown } from 'lucide-react';
import { Panel, Btn, PageHeader } from '../../../components/UI';
import { Pagination, SummaryRail, UuiSelectField } from '../../../design-system';
import { Money } from '../../../components/shared/Money';
import { formatCurrency, formatNumber, formatDate } from '../../../lib/format';
import { downloadCSV } from '../../../lib/csv';
import { PenaltyStatus } from '@tingting/shared';
import { getSeverity, getSeverityLabel, getViolationGrade, getGradeClass, formatTenure } from '../utils';
import { resolveEmptyIllustration } from '../../../lib/emptyIllustrations';
import { PenaltySeverityIcon } from './penalty-severity-icon';
import type { PenaltyInsightsScoreboardRow } from '../../../hooks/usePenalties';
import type { PenaltyStatusFilter, PenaltyScoreWindow, PenaltyTableProps } from './penalty-table-types';
import { PenaltyScoreboardCards, type PenaltyScoreboardCardRow } from './PenaltyScoreboardCards';
import { SortHeader } from '../../../components/shared/SortHeader';
import '../../../styles/table-sort.css';

const STATUS_CHIPS: Array<{ key: PenaltyStatusFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  // ACTIVE records are final on creation — payroll deducts them in the current
  // period with no approval step (attendance.service sums every non-CANCELED
  // row). The chip must not promise a gate that doesn't exist.
  { key: PenaltyStatus.ACTIVE, label: 'Hiệu lực' },
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

export function PenaltyTable({
  rows,
  total,
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
  // Phone: the ranking collapses by default so the violation ledger and its
  // status chips stay in the first viewport.
  const [mobileScoreOpen, setMobileScoreOpen] = useState(false);

  // ── KPI strip (server-computed, selected salary period) ────────────────
  const incidentCount = insights?.month.incidentCount ?? 0;
  const totalMonthAmount = insights?.month.totalAmount ?? 0;
  const ytdTotal = insights?.ytd.total ?? 0;
  const teamSize = insights?.driverTotal ?? 0;
  const safeCount = insights?.safeDriverCount ?? 0;

  // ── Status chips (full-set counts from the list envelope) ──────────────
  const chipCounts: Record<PenaltyStatusFilter, number> = {
    all: statusCounts?.all ?? total,
    [PenaltyStatus.ACTIVE]: statusCounts?.ACTIVE ?? 0,
    [PenaltyStatus.CANCELED]: statusCounts?.CANCELED ?? 0,
  };

  // ── Safe-streak KPI (whole-history streaks, window-independent) ────────
  const longestStreak = insights?.longestStreak ?? 0;

  // ── Scoreboard (insights rows + catalog tenure) ────────────────────────
  const tenureByDriver = new Map(drivers.map(d => [d.id, d.createdAt] as const));
  const scoreboardRows = (insights?.scoreboard ?? []).map<PenaltyScoreboardCardRow>(row => {
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
          <span className="penalty-page-header-title">
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

      {/* ── Summary rail (server-computed) ─────────────────────────────── */}
      {insightsLoading ? (
        <div className="penalty-loading">
          <Loader2 size={16} className="spin" />
          Đang tải dữ liệu kỳ lương...
        </div>
      ) : (
      <SummaryRail
        ariaLabel="Tóm tắt kỷ luật tháng"
        items={[
          { label: `Vi phạm · ${monthLabel}`, value: `${incidentCount} vụ`, tone: incidentCount > 0 ? 'warning' : undefined },
          { label: `Tổng phạt · YTD ${formatCurrency(ytdTotal)}`, value: formatCurrency(totalMonthAmount) },
          { label: 'Lái xe đạt chuẩn', value: `${safeCount}/${teamSize}` },
          { label: 'Chuỗi an toàn', value: `${longestStreak} ngày` },
        ]}
      />
      )}

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
            <div className="penalty-loading penalty-loading--padded">
              <div className="penalty-spinner spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="penalty-empty-log">
              <div className="penalty-empty-icon-wrap">
                <ShieldCheck size={36} strokeWidth={2.5} />
              </div>
              <div className="penalty-empty-title">Toàn đội đang giữ chuẩn nghiệp vụ</div>
              <div className="penalty-empty-desc">
                Chưa có biên bản vi phạm nào khớp bộ lọc trong kỳ này. Hệ thống sẽ tự động khấu trừ vào bảng lương ngay khi biên bản có hiệu lực.
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
                  <div className="val pos">~{formatNumber(ytdTotal)}<span className="u">đ</span></div>
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
                      {canCancel && <th className="penalty-scoreboard-col-action"></th>}
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
                            {canceled ? (
                              <span className="penalty-log-money penalty-log-money--canceled">
                                <Money value={Math.abs(Number(p.amount))} /> <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>(đã hủy)</span>
                              </span>
                            ) : (
                              <Money value={Number(p.amount)} sign="-" className="penalty-log-money" />
                            )}
                          </td>
                          {canCancel && (
                            <td data-label="" className="record-table__action">
                              {!canceled && (
                                <button
                                  className="penalty-row-act penalty-row-act--danger"
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
        {/* Phone: the ranking collapses by default so the violation ledger
            and its status chips stay in the first viewport. */}
        <button
          type="button"
          className="penalty-m-toggle mobile-only"
          aria-expanded={mobileScoreOpen}
          onClick={() => setMobileScoreOpen((o) => !o)}
        >
          <span className="penalty-m-toggle__label">Bảng xếp hạng lái xe</span>
          <span className="penalty-m-toggle__meta">{scoreboardRows.length} lái xe</span>
          <ChevronDown size={15} className={mobileScoreOpen ? 'is-open' : undefined} aria-hidden="true" />
        </button>
        {mobileScoreOpen && (
          <PenaltyScoreboardCards
            rows={scoreboardRows}
            avgStreak={avgStreak}
            driversOver90={driversOver90}
            onOpenDrawer={onOpenDrawer}
          />
        )}
        <div className="desktop-only">
          <div className="record-table-wrap penalty-scoreboard-wrap">
            <table className="record-table ops-table penalty-scoreboard-table">
              <thead>
                <tr>
                  <th className="penalty-scoreboard-col-rank">STT</th>
                  <th>Lái xe</th>
                  <th>Chuỗi an toàn</th>
                  <th>Vi phạm {scoreFilter === '90d' ? '90N' : scoreFilter.toUpperCase()}</th>
                  <th>Phạt YTD</th>
                  <th className="penalty-scoreboard-col-center">Mức</th>
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
                    <tr key={d.driverId} onClick={() => onOpenDrawer(d.driverId)} className="penalty-scoreboard-row">
                      <td data-label="" className="penalty-scoreboard-col-center">
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
                          {d.fineYtd > 0 ? formatNumber(d.fineYtd) : `0`}<span className="unit">đ</span>
                        </span>
                      </td>
                      <td data-label="Mức" className="penalty-scoreboard-col-center">
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
              <span>TB chuỗi an toàn: <span className="penalty-foot-value">{avgStreak} ngày</span></span>
              <span className="penalty-foot-sep">·</span>
              <span>{driversOver90} lái xe đạt mốc 90 ngày</span>
              <span className="penalty-foot-sep">·</span>
              <span>{driversOver6m} lái xe vượt 6 tháng</span>
            </div>
            <span>Hiển thị {scoreboardRows.length}/{scoreboardRows.length}</span>
          </div>
        </div>
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
          <div className="penalty-vio-type-list">
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
              <span>Cập nhật lần cuối: <span className="penalty-foot-value">{formatDate(new Date().toISOString().slice(0, 10))}</span></span>
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
