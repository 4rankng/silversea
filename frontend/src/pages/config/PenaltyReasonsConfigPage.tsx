import { useState, useMemo, useEffect } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import { useCRUD } from '../../hooks/useCRUD';
import { Modal, useConfirm, Btn, FormGroup, PageHeader } from '../../components/UI';
import type { PenaltyReason } from '@tingting/shared';
import { resolveEmptyIllustration } from '../../lib/emptyIllustrations';

/* ─── Page-scoped styles ─── */
const pageStyles = `
  /* ── Override KPI wireframe: solid white + smaller type ── */
  .penalty-reasons-page .kpi-grid .kpi {
    background: #fff;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    padding: 16px 18px;
  }
  .penalty-reasons-page .kpi-grid .kpi__icon {
    width: 32px; height: 32px;
    border-radius: 8px;
  }
  .penalty-reasons-page .kpi-grid .kpi__icon svg { width: 15px; height: 15px; }
  .penalty-reasons-page .kpi-grid .kpi__value {
    font-size: 22px;
    margin-bottom: 4px;
  }
  .penalty-reasons-page .kpi-grid .kpi__value-unit {
    font-size: 13px;
  }
  .penalty-reasons-page .kpi-grid .kpi__meta {
    font-size: var(--fs-xs);
    line-height: 1.35;
  }

  /* ── Violation card grid ── */
  .pr-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 14px;
  }

  /* ── Card ── */
  .pr-card {
    background: #ffffff !important;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    padding: 16px 18px;
    box-shadow: var(--sh);
    transition: transform 0.25s var(--ease-spring), box-shadow 0.25s ease, border-color 0.25s ease;
    position: relative;
    display: flex;
    flex-direction: column;
    animation: pr-stagger 0.45s cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }
  .pr-card:hover {
    box-shadow: var(--sh-lg);
    border-color: var(--accent-soft);
    transform: translateY(-2px);
  }
  .pr-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .pr-card-title {
    font-family: var(--font-display);
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: 0;
    white-space: normal;
  overflow: visible;
  overflow-wrap: anywhere;
    line-height: 1.3;
    color: var(--ink);
  }



  /* ── Hover actions ── */
  .pr-card-actions {
    position: absolute; top: 100%; right: 0; margin-top: 8px; z-index: 2;
    display: flex; gap: 4px;
    opacity: 0; transform: translateY(-4px);
    transition: 0.16s ease;
  }
  .pr-card:hover .pr-card-actions { opacity: 1; transform: none; }
  .pr-act {
    width: 30px; height: 30px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: #fff;
    display: grid; place-items: center;
    cursor: pointer; color: var(--ink-3);
    transition: 0.14s ease;
  }
  .pr-act svg { width: 14px; height: 14px; }
  .pr-act:hover { background: var(--surface-3); color: var(--ink); }
  .pr-act.del:hover { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-soft); }

  /* ── Card footer ── */
  .pr-card-foot {
    display: flex; align-items: flex-end;
    justify-content: space-between; gap: 12px;
    margin-top: 14px; padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .pr-fine .k { font-size: var(--fs-xs); color: var(--ink-3); font-weight: 600; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
  .pr-fine .v {
    font-family: var(--font-mono);
    font-size: 16px; font-weight: 700;
    letter-spacing: 0;
    color: var(--ink);
  }
  .pr-fine .v .cur { font-size: 12px; color: var(--ink-3); margin-left: 2px; }
  .pr-usage { text-align: right; }
  .pr-usage .k { font-size: var(--fs-xs); color: var(--ink-3); font-weight: 600; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
  .pr-usage .v { font-size: 12px; font-weight: 600; color: var(--ink-2); }
  .pr-usage .v b { font-family: var(--font-mono); color: var(--accent); font-size: 14px; }
  .pr-usage.zero .v b { color: var(--ink-3); }

  /* ── Animations ── */
  @keyframes pr-stagger {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ── Form input ── */
  .pr-form-input {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 10px 12px;
    font-size: 13.5px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    outline: none;
    background: #fff;
  }
  .pr-form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

  /* ── Loading ── */
  .pr-loading {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 80px 20px;
    color: var(--ink-3); gap: 14px;
    font-size: 13px;
  }
  .pr-spinner {
    width: 28px; height: 28px;
    border: 3px solid var(--line); border-top-color: var(--accent);
    border-radius: 50%; animation: pr-spin 0.8s linear infinite;
  }
  @keyframes pr-spin { to { transform: rotate(360deg); } }

  @media (max-width: 560px) {
    .pr-grid { grid-template-columns: 1fr; }
  }
`;

/* ─── Severity helpers ─── */
type Severity = 'low' | 'mid' | 'high';
const SEV_OPTIONS: { value: Severity; label: string; color: string }[] = [
  { value: 'low', label: 'Nhẹ', color: 'var(--ink-3)' },
  { value: 'mid', label: 'Trung bình', color: 'var(--warning)' },
  { value: 'high', label: 'Nghiêm trọng', color: 'var(--danger)' },
];
const sevLabel: Record<string, string> = { high: 'Nghiêm trọng', mid: 'Trung bình', low: 'Nhẹ' };
const sevPill: Record<string, string> = { high: 'danger', mid: 'warn', low: 'neutral' };

function PenaltyReasonForm({
  saving, item, onSave, onCancel, existingReasons,
}: {
  saving: boolean;
  item?: PenaltyReason;
  onSave: (d: Record<string, unknown>) => void;
  onCancel: () => void;
  existingReasons: PenaltyReason[];
}) {
  const [reason, setReason] = useState(item?.reasonText || '');
  const [amount, setAmount] = useState(item?.defaultAmount?.toString() || '');
  const [severity, setSeverity] = useState<Severity>(item?.severity || 'mid');

  const isDuplicate =
    reason.trim().length > 0 &&
    existingReasons.some(
      (r) => r.id !== item?.id && r.reasonText.trim().toLowerCase() === reason.trim().toLowerCase()
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: '10px 4px' }}>
      <FormGroup label="Tên lỗi vi phạm" error={isDuplicate ? 'Lý do này đã tồn tại trong danh mục.' : undefined}>
        <input
          className="pr-form-input"
          style={{ borderColor: isDuplicate ? 'var(--danger)' : undefined }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: Vượt đèn đỏ, Chạy quá tốc độ..."
          autoFocus
        />
      </FormGroup>
      <FormGroup label="Mức phạt mặc định (VNĐ)">
        <input
          className="pr-form-input"
          style={{ fontFamily: 'var(--font-mono)' }}
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </FormGroup>
      <FormGroup label="Mức độ nghiêm trọng">
        <div style={{ display: 'flex', gap: '8px' }}>
          {SEV_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSeverity(opt.value)}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 'var(--r)',
                border: severity === opt.value ? `2px solid ${opt.color}` : '1px solid var(--line)',
                background: severity === opt.value ? `${opt.color}12` : 'var(--surface)',
                color: severity === opt.value ? opt.color : 'var(--ink-2)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                transition: '0.15s ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>Hủy</Btn>
        <Btn
          variant="primary"
          onClick={() => {
            if (!reason.trim() || isDuplicate) return;
            onSave({ reasonText: reason.trim(), defaultAmount: Number(amount) || 0, severity });
          }}
          disabled={saving || !reason.trim() || isDuplicate}
        >
          {saving ? 'Đang lưu...' : item ? 'Lưu thay đổi' : 'Thêm mới'}
        </Btn>
      </div>
    </div>
  );
}

export default function PenaltyReasonsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const { confirm, dialog } = useConfirm();

  const [searchTerm, setSearchTerm] = useState('');
  const [activeSev, setActiveSev] = useState('all');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    const id = 'pr-custom-styles';
    let s = document.getElementById(id) as HTMLStyleElement | null;
    if (!s) {
      s = document.createElement('style');
      s.id = id;
      document.head.appendChild(s);
    }
    s.innerHTML = pageStyles;
  }, []);

  const { data, refetch, isLoading } = useQuery({
    queryKey: qk.penalties.list,
    queryFn: () => configClient.getPenaltyReasons(),
  });

  const { data: statsData, refetch: refetchStats } = useQuery({
    queryKey: qk.penalties.stats,
    queryFn: async () =>
      await api.get<{
        totalCount: number;
        totalAmount: number;
        countsByReason: Record<number, number>;
        period: { month: number; year: number };
      }>('/penalty-reasons/stats'),
  });

  const crud = useCRUD('/penalty-reasons', async () => {
    await refetch();
    await refetchStats();
  });

  const items = useMemo(() => data || [], [data]);

  const filteredItems = useMemo(() => {
    const list = items.filter((d) => {
      const okSev = activeSev === 'all' || d.severity === activeSev;
      const okQ = d.reasonText.toLowerCase().includes(searchTerm.trim().toLowerCase());
      return okSev && okQ;
    });
    list.sort((a, b) => {
      const diff = Number(b.defaultAmount) - Number(a.defaultAmount);
      return sortDesc ? diff : -diff;
    });
    return list;
  }, [items, searchTerm, activeSev, sortDesc]);

  const editingItem = useMemo(
    () => items.find((x) => x.id === crud.editingId),
    [items, crud.editingId]
  );

  const handleDelete = async (id: number) => {
    const ok = await confirm('Bạn có chắc chắn muốn xóa lỗi vi phạm này?', {
      variant: 'danger',
      confirmLabel: 'Xóa',
    });
    if (ok) {
      await crud.doDelete(id);
      crud.cancelForm();
    }
  };

  const fmt = (n: number) => n.toLocaleString('vi-VN');

  /* ─── Derived stats ─── */
  const totalTypes = items.length;
  const totalCount = statsData?.totalCount || 0;
  const totalAmount = statsData?.totalAmount || 0;
  const topEntry = statsData?.countsByReason
    ? Object.entries(statsData.countsByReason).sort((a, b) => b[1] - a[1])[0]
    : null;
  const topReasonText = topEntry
    ? items.find((x) => x.id === Number(topEntry[0]))?.reasonText || '---'
    : '---';
  const topReasonCount = topEntry ? topEntry[1] : 0;

  return (
    <div ref={pageRef} className="penalty-reasons-page" style={{ minHeight: '100%' }}>
      {/* ── Page Header ─────────────────────────────────────────── */}
      <PageHeader 
        title="Danh mục lỗi vi phạm" 
        description="Quản lý các loại lỗi vi phạm của lái xe và quy định mức phạt mặc định để áp dụng nhanh chóng." 
        onBack={handleBack} 
        iconName="alert"
        action={
          <button className="btn btn--primary" onClick={() => crud.setShowAddForm(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Thêm lỗi mới
          </button>
        }
      />

      {/* ── KPI Stats ───────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ marginTop: '8px' }}>
        <div className="kpi">
          <div className="kpi__top">
            <span className="kpi__label">Tổng loại lỗi</span>
            <div className="kpi__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
          </div>
          <div className="kpi__value">{totalTypes}</div>
          <div className="kpi__meta">Đang áp dụng trong hệ thống</div>
        </div>

        <div className="kpi">
          <div className="kpi__top">
            <span className="kpi__label">Lượt phạt tháng này</span>
            <div className="kpi__icon kpi--warn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg></div>
          </div>
          <div className="kpi__value">
            {totalCount}<span className="kpi__value-unit">lượt</span>
          </div>
          <div className="kpi__meta">{totalCount > 0 ? 'Tháng hiện tại' : 'Chưa có dữ liệu'}</div>
        </div>

        <div className="kpi kpi--success">
          <div className="kpi__top">
            <span className="kpi__label">Tổng tiền phạt</span>
            <div className="kpi__icon kpi--success"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></div>
          </div>
          <div className="kpi__value" style={{ fontFamily: 'var(--font-mono)' }}>
            {fmt(totalAmount)}<span className="kpi__value-unit">đ</span>
          </div>
          <div className="kpi__meta">Đã ghi nhận trong tháng</div>
        </div>

        <div className="kpi">
          <div className="kpi__top">
            <span className="kpi__label">Phổ biến nhất</span>
            <div className="kpi__icon kpi--danger"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg></div>
          </div>
          <div className="kpi__value" style={{ fontSize: topReasonText.length > 15 ? '18px' : '24px', letterSpacing: '-0.02em' }} title={topReasonText}>
            {topReasonText}
          </div>
          <div className="kpi__meta" style={{ fontFamily: 'var(--font-mono)' }}>
            {topReasonCount > 0 ? `${topReasonCount} lượt vi phạm` : 'Chưa có thống kê'}
          </div>
        </div>
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────── */}
      <div className="filter-bar">
        <div className="filter-bar__search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            name="penaltyReasonSearch"
            aria-label="Tìm kiếm lỗi vi phạm"
            placeholder="Tìm kiếm lỗi vi phạm…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className={`filter-tab ${activeSev === 'all' ? 'is-active' : ''}`} onClick={() => setActiveSev('all')}>
          Tất cả
        </button>
        <button className={`filter-tab ${activeSev === 'high' ? 'is-active' : ''}`} onClick={() => setActiveSev('high')}>
          <span className="dot" style={{ background: 'var(--danger)' }} />Nghiêm trọng
        </button>
        <button className={`filter-tab ${activeSev === 'mid' ? 'is-active' : ''}`} onClick={() => setActiveSev('mid')}>
          <span className="dot" style={{ background: 'var(--warning)' }} />Trung bình
        </button>
        <button className={`filter-tab ${activeSev === 'low' ? 'is-active' : ''}`} onClick={() => setActiveSev('low')}>
          <span className="dot" style={{ background: 'var(--ink-3)' }} />Nhẹ
        </button>
        <div className="filter-bar__spacer" />
        <button className="btn btn--secondary btn--sm" onClick={() => setSortDesc(!sortDesc)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4" />
          </svg>
          {sortDesc ? 'Cao → thấp' : 'Thấp → cao'}
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="pr-loading">
          <div className="pr-spinner" />
          <div>Đang tải dữ liệu...</div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <img
            src={resolveEmptyIllustration('empty-penalties')}
            alt=""
            aria-hidden="true"
            style={{ width: 160, height: 132, objectFit: 'contain' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <p className="empty-state-title">Không tìm thấy lỗi vi phạm</p>
          <p className="empty-state-desc">Thử từ khóa khác hoặc thay đổi bộ lọc.</p>
        </div>
      ) : (
        <div className="pr-grid">
          {filteredItems.map((d, i) => {
            const sev = d.severity || 'mid';
            const count = statsData?.countsByReason?.[d.id] || 0;
            return (
              <div className="pr-card" key={d.id} style={{ animationDelay: `${i * 0.04}s` }}>
                <div className="pr-card-top">
                  <div className="pr-card-title" title={d.reasonText}>{d.reasonText}</div>
                  <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span className={`pill pill--${sevPill[sev]}`} style={{ flexShrink: 0 }}>
                      <span className="dot" />{sevLabel[sev]}
                    </span>
                    <div className="pr-card-actions">
                      <div className="pr-act" title="Chỉnh sửa" onClick={() => crud.setEditingId(d.id)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </div>
                      <div className="pr-act del" title="Xóa" onClick={() => handleDelete(d.id)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pr-card-foot">
                  <div className="pr-fine">
                    <div className="k">Mức phạt mặc định</div>
                    <div className="v">{fmt(Number(d.defaultAmount))}<span className="cur">đ</span></div>
                  </div>
                  <div className={`pr-usage ${count === 0 ? 'zero' : ''}`}>
                    <div className="k">Áp dụng tháng này</div>
                    <div className="v"><b>{count}</b> lượt</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Modal ── */}
      <Modal isOpen={crud.showAddForm && !crud.editingId} title="Thêm lỗi vi phạm mới" onClose={crud.cancelForm} maxWidth={460}>
        <PenaltyReasonForm saving={crud.saving} onSave={crud.doCreate} onCancel={crud.cancelForm} existingReasons={items} />
      </Modal>

      {/* ── Edit Modal ── */}
      {editingItem && (
        <Modal isOpen={true} title="Chỉnh sửa lỗi vi phạm" onClose={crud.cancelForm} maxWidth={460}>
          <PenaltyReasonForm item={editingItem} saving={crud.saving} onSave={(d) => crud.doUpdate(editingItem.id, d)} onCancel={crud.cancelForm} existingReasons={items} />
        </Modal>
      )}

      {dialog}
    </div>
  );
}
