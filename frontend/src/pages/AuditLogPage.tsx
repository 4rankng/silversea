import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { downloadCSV } from '../lib/csv';
import {
  Search, Activity, Users, Clock, TrendingUp, Download, FileText,
  Truck, Settings, DollarSign, LogIn,
  Globe, Terminal, Copy, Check, Info, Eye, X,
} from 'lucide-react';
import { Panel, KPI } from '../components/UI';
import { AssetIcon } from '../components/AssetIcon';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { useAuditLogs, type AuditEntry, type Category } from '../hooks/useAuditLogs';
import { useAuth } from '../hooks/useAuth';
import { usePageAnimations } from '../hooks/animations';
import { ACTION_LABELS, resolveCategory, formatTimeShort } from '../lib/audit-helpers';
import './AuditLogPage.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';

// ─── Types ──────────────────────────────────────────────────────────────

type NormalizedEntry = AuditEntry & {
  userName: string;
  userEmail: string;
  category: NonNullable<AuditEntry['category']>;
};

// Raw audit entries may arrive with camelCase or snake_case actor fields
// depending on the API version, so accept a loose record here.
type RawAuditEntry = AuditEntry & {
  actorName?: string;
  actor_name?: string;
  username?: string;
  actorEmail?: string;
};

// Map raw API entry → canonical shape
function normalizeEntry(e: RawAuditEntry): NormalizedEntry {
  const name = e.userName || e.actorName || e.actor_name || e.username || e.userEmail || 'Người dùng';
  const email = e.userEmail || e.actorEmail || '';
  const action: string = e.action || '';
  return {
    ...e,
    userName: name,
    userEmail: email,
    category: e.category || resolveCategory(action, { path: e.path }),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

const CATEGORIES: { key: Category; label: string; icon: React.ElementType }[] = [
  { key: 'all',     label: 'Tất cả',    icon: FileText },
  { key: 'trip',    label: 'Chuyến đi', icon: Truck },
  { key: 'config',  label: 'Cấu hình',  icon: Settings },
  { key: 'finance', label: 'Tài chính', icon: DollarSign },
  { key: 'auth',    label: 'Xác thực',  icon: LogIn },
  { key: 'penalty', label: 'Kỷ luật',   icon: Activity },
];

function formatExactTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function avatarColor(str: string): string {
  return `avatar-ring--${str.length % 5 + 1}`;
}

function categoryDotClass(c: string): string {
  if (c === 'trip') return 'audit-dot--trip';
  if (c === 'config') return 'audit-dot--update';
  if (c === 'finance') return 'audit-dot--finance';
  if (c === 'auth') return 'audit-dot--auth';
  if (c === 'penalty') return 'audit-dot--delete';
  return 'audit-dot--create';
}

function categoryIcon(c: string) {
  if (c === 'trip') return <Truck size={13} />;
  if (c === 'config') return <Settings size={13} />;
  if (c === 'finance') return <DollarSign size={13} />;
  if (c === 'auth') return <LogIn size={13} />;
  if (c === 'penalty') return <Activity size={13} />;
  return <FileText size={13} />;
}

// ─── Component ──────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export default function AuditLogPage() {
  const [filter, setFilter] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<NormalizedEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const detailDialogRef = useRef<HTMLDialogElement>(null);

  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { 
    data, 
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage
  } = useAuditLogs(PAGE_SIZE, filter, search);

  const { rootRef } = usePageAnimations({ ready: !loading });
   
  const rawEntries: AuditEntry[] = useMemo(() => data?.pages.flatMap(p => p.items) ?? [], [data]);
  const entries = useMemo(() => rawEntries.map(normalizeEntry), [rawEntries]);
  const total = data?.pages[0]?.total ?? 0;

  useEffect(() => {
    setSelectedEntry(null);
  }, [filter, search]);

  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;

    if (selectedEntry && !dialog.open) dialog.showModal();
    if (!selectedEntry && dialog.open) dialog.close();
  }, [selectedEntry]);

  const observer = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback((node: HTMLTableRowElement | null) => {
    if (loading || isFetchingNextPage) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage) {
        fetchNextPage();
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, isFetchingNextPage, hasNextPage, fetchNextPage]);

  // Aggregated KPIs
  const todayCount = total;
  const uniqueUsers = useMemo(() => new Set(entries.map(e => e.userName)).size, [entries]);

  const topCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels: Record<string, string> = {
      trip: 'Chuyến đi',
      config: 'Cấu hình',
      finance: 'Tài chính',
      auth: 'Xác thực',
      penalty: 'Kỷ luật',
    };
    return {
      label: labels[sorted[0]?.[0] || 'trip'] || 'Chuyến đi',
      count: sorted[0]?.[1] || 0,
    };
  }, [entries]);

  // Category counts
  const handleCopyPayload = (payload: Record<string, unknown> | undefined) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderDetailContent = (entry: NormalizedEntry | null) => {
    if (!entry) return null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }} className="fade-up">
        <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div className={`avatar-ring ${avatarColor(entry.userName)}`} style={{ width: 42, height: 42, fontSize: 14 }}>
              <Users size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                {entry.userName}
              </h3>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`audit-dot ${categoryDotClass(entry.category)}`} style={{ width: 8, height: 8 }} />
                {ACTION_LABELS[entry.action] || entry.action}
              </div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>
            {entry.message}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 12, background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600, marginBottom: 4 }}>
              Thời gian
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
              {formatExactTime(entry.timestamp)}
            </div>
          </div>
          {isAdmin && (
            <div>
              <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600, marginBottom: 4 }}>
                Địa chỉ IP
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Globe size={12} style={{ color: 'var(--info)' }} />
                {entry.ipAddress || 'Mạng nội bộ'}
              </div>
            </div>
          )}
          {isAdmin && entry.method && (
            <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }}>
              <span className={`audit-method audit-method--${entry.method}`}>
                {entry.method}
              </span>
              <span style={{ fontSize: 12, lineHeight: 1.5, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>
                {entry.path}
              </span>
            </div>
          )}
        </div>

        {isAdmin && (
          entry.payload && Object.keys(entry.payload).length > 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 180 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Terminal size={12} />
                  Chi tiết tham số (JSON)
                </div>
                <button
                  className="btn btn--secondary btn--sm"
                  style={{ padding: '6px 10px', fontSize: 12, lineHeight: 1.35 }}
                  onClick={() => handleCopyPayload(entry.payload)}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Đã chép!' : 'Sao chép'}
                </button>
              </div>
              <pre
                style={{
                  flex: 1,
                  background: 'var(--surface-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 6,
                  padding: 10,
fontSize: 13,
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'auto',
                  maxHeight: 220,
                  margin: 0,
                }}
              >
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--ink-3)', fontSize: 12, padding: 20 }}>
              <Info size={24} style={{ marginBottom: 6, color: 'var(--line-2)' }} />
              Không có tham số chi tiết đi kèm sự kiện này
            </div>
          )
        )}
      </div>
    );
  };

  return (
    <div className="audit-log-page" style={{ paddingBottom: 40 }} ref={rootRef}>
      <Breadcrumbs
        className="audit-log-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Nhật ký người dùng' },
        ]}
      />
      {/* ── Page Header ── */}
      <header className="page-header">
        <div className="page-header-main">
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AssetIcon name="audit-log" size={32} />
            Nhật ký người dùng
          </h1>
          <p className="page-subtitle">
            Hệ thống giám sát và ghi nhận hoạt động vận hành thời gian thực
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn--secondary"
            disabled={entries.length === 0}
            onClick={async () => {
              const headers = isAdmin
                ? ['#', 'Thời gian', 'Người dùng', 'Hành động', 'Nội dung', 'Địa chỉ IP']
                : ['#', 'Thời gian', 'Người dùng', 'Hành động', 'Nội dung'];
              const rows = entries.map((e, i) => {
                const base = [
                  i + 1,
                  e.timestamp,
                  e.userName,
                  ACTION_LABELS[e.action] || e.action,
                  e.message,
                ];
                if (isAdmin) base.push(e.ipAddress || 'Không rõ');
                return base;
              });
              await downloadCSV(`nhat-ky-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
                title: 'NHẬT KÝ NGƯỜI DÙNG',
                subtitle: `${entries.length} sự kiện · tài liệu nội bộ`,
                columnTypes: isAdmin
                  ? ['number', 'date', 'text', 'text', 'text', 'text']
                  : ['number', 'date', 'text', 'text', 'text'],
                hideTotals: true,
              });
            }}
          >
            <Download size={14} />
            Xuất Excel
          </button>
        </div>
      </header>

      {/* ── KPI Strip ── */}
      <div className="kpi-grid">
        <KPI
          label="Tổng hoạt động lọc được"
          value={todayCount}
          unit="sự kiện"
          icon={Activity}
          assetIconName="analytics"
          meta="Tìm thấy trong cơ sở dữ liệu"
        />

        <KPI
          label="Tài khoản thực hiện"
          value={uniqueUsers || (loading ? '...' : 0)}
          unit="người dùng"
          icon={Users}
          assetIconName="users-hr"
          variant="info"
          meta="Trong trang kết quả hiện tại"
        />

        <KPI
          label="Nhóm hoạt động nhiều nhất"
          value={topCategory.count}
          unit={topCategory.label}
          icon={TrendingUp}
          assetIconName="audit-log"
          variant="accent"
          meta="Chiếm ưu thế trong trang hiện tại"
        />

        <KPI
          label="Hoạt động gần nhất"
          value={entries[0] ? formatTimeShort(entries[0].timestamp) : '—'}
          icon={Clock}
          assetIconName="schedule"
          compact
          meta={entries[0] ? `${entries[0].message.slice(0, 30)}...` : 'Chưa có hoạt động'}
        />
      </div>

      {/* ── Filter Bar ── */}
      <div data-tour-id="audit-filters" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const isActive = filter === cat.key;
          return (
            <button
              key={cat.key}
              className={`filter-pill${isActive ? ' is-active' : ''}`}
              onClick={() => {
                setFilter(cat.key);
              }}
            >
              <Icon size={14} />
              {cat.label}
              {filter === cat.key && (
                <span className="filter-pill__count">{total}</span>
              )}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <div className="toolbar__search" style={{ minWidth: 280 }}>
          <Search size={14} />
          <input
            type="text"
            name="auditSearch"
            aria-label="Tìm trong nhật ký người dùng"
            placeholder="Tìm tên, nội dung, hành động…"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
            }}
          />
        </div>
      </div>

      {/* ── Full-width activity list ── */}
      <Panel flush className="audit-list-panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="audit-list-panel__intro">
          <div>
            <h2>Danh sách hoạt động</h2>
            <p>Chọn một bản ghi để xem đầy đủ thông tin và dữ liệu kỹ thuật.</p>
          </div>
          <span className="audit-list-panel__count">{total.toLocaleString('vi-VN')} bản ghi</span>
        </div>
          <div className="table-scroll" data-tour-id="audit-table">
            <table className="table-hover">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th style={{ width: 140 }}>Thời gian</th>
                  <th style={{ width: 180 }}>Người dùng</th>
                  <th>Nội dung</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 48, color: 'var(--ink-3)' }}>
                      Đang truy vấn dữ liệu nhật ký...
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px 48px', color: 'var(--ink-3)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <img src={resolveEmptyIllustration('empty-audit')} alt="" aria-hidden="true" style={{ width: 140, height: 116, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        Không tìm thấy bản ghi nào khớp bộ lọc hiện tại.
                      </div>
                    </td>
                  </tr>
                ) : (
                  entries.map((entry, idx) => {
                    const isSelected = selectedEntry?.id === entry.id;
                    return (
                      <tr
                        key={`${entry.id}-${idx}`}
                        ref={idx === entries.length - 1 ? lastElementRef : null}
                        onClick={() => setSelectedEntry(entry)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedEntry(entry);
                          }
                        }}
                        className={isSelected ? 'is-selected' : undefined}
                        tabIndex={0}
                        aria-label={`Xem chi tiết hoạt động của ${entry.userName}: ${entry.message}`}
                      >
                        <td className="num">{idx + 1}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>
                            {formatTimeShort(entry.timestamp)}
                          </div>
                          <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                            {formatExactTime(entry.timestamp).split(' ')[0]}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className={`avatar-ring ${avatarColor(entry.userName)}`} style={{ width: 26, height: 26, fontSize: 12 }}>
                              <Users size={13} aria-hidden="true" />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                                {entry.userName}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ minWidth: 0 }}>
                          <div className="audit-row-content">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                              <div className="audit-event-tag">
                                <span className={`audit-dot ${categoryDotClass(entry.category)}`} />
                                {categoryIcon(entry.category)}
                                <span style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.35, color: 'var(--ink-2)' }}>
                                  {ACTION_LABELS[entry.action] || entry.action}
                                </span>
                              </div>
                              <div className="audit-log__msg">
                                {entry.message}
                              </div>
                            </div>
                            <div className="audit-row-content__preview" aria-hidden="true">
                              <Eye size={15} />
                              <span>Xem chi tiết</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
                {isFetchingNextPage && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--ink-3)' }}>
                      Đang tải thêm...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer showing count */}
          {total > 0 && (
            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--surface-2)',
                fontSize: 12,
                color: 'var(--ink-3)',
              }}
            >
              <span>Hiển thị {entries.length} trong tổng số {total} bản ghi</span>
            </div>
          )}
      </Panel>

      <dialog
        ref={detailDialogRef}
        className="d-modal d-modal-end audit-detail-modal"
        aria-labelledby="audit-detail-title"
        onClose={() => setSelectedEntry(null)}
      >
        <div className="d-modal-box audit-detail-modal__box">
          <header className="audit-detail-modal__header">
            <div>
              <span className="audit-detail-modal__eyebrow">Bản ghi kiểm toán</span>
              <h2 id="audit-detail-title">Chi tiết hoạt động</h2>
              <p>{selectedEntry ? formatExactTime(selectedEntry.timestamp) : ''}</p>
            </div>
            <form method="dialog">
              <button className="d-btn d-btn-ghost d-btn-circle" aria-label="Đóng chi tiết hoạt động">
                <X size={20} />
              </button>
            </form>
          </header>
          <div className="audit-detail-modal__body">
            {renderDetailContent(selectedEntry)}
          </div>
        </div>
        <form method="dialog" className="d-modal-backdrop">
          <button aria-label="Đóng chi tiết hoạt động">Đóng</button>
        </form>
      </dialog>

      {/* ── Pagination removed for Infinite Scroll ── */}
    </div>
  );
}
