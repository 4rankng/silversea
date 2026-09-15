import React, { useMemo } from 'react';
import { Settings, Truck, DollarSign, LogIn, FileText, Activity } from 'lucide-react';
import type { DashboardAuditEntry } from '../hooks/useDashboardData';
import { ACTION_LABELS, resolveCategory, formatTimeShort } from '../../../lib/audit-helpers';
import { ClickableCard } from '../../../components/shared/ClickableCard';

function categoryDotClass(c: string): string {
  if (c === 'trip') return 'audit-dot--trip';
  if (c === 'config') return 'audit-dot--update';
  if (c === 'finance') return 'audit-dot--finance';
  if (c === 'auth') return 'audit-dot--auth';
  if (c === 'penalty') return 'audit-dot--delete';
  return 'audit-dot--create';
}

function categoryIcon(c: string) {
  if (c === 'trip') return <Truck size={12} />;
  if (c === 'config') return <Settings size={12} />;
  if (c === 'finance') return <DollarSign size={12} />;
  if (c === 'auth') return <LogIn size={12} />;
  if (c === 'penalty') return <Activity size={12} />;
  return <FileText size={12} />;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface AuditLogWidgetProps {
  entries: DashboardAuditEntry[];
  navigate: (path: string) => void;
}

export function AuditLogWidget({ entries, navigate }: AuditLogWidgetProps) {
  // Normalize: fill in category if backend didn't provide it
  const normalized = useMemo(
    () =>
      entries.map((e) => ({
        ...e,
        category: e.category || resolveCategory(e.action || '', { path: e.path }),
      })),
    [entries],
  );

  return (
    <div className="d-card d-card-border bg-base-100 wf-card wf-audit">
      <div className="wf-card-h">
        <div>
          <h2 className="ttl">Hoạt động gần đây</h2>
          <div className="sub">Nhật ký vận hành thời gian thực</div>
        </div>
        <button className="d-btn d-btn-link d-btn-sm wf-link" onClick={() => navigate('/audit-log')}>
          Xem tất cả
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="body">
        {normalized.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: 'var(--text-caption-size)', color: 'var(--wf-ink-3)', textAlign: 'center' }}>
            Chưa có hoạt động nào được ghi nhận.
          </div>
        ) : (
          normalized.map((entry, idx) => {
            const label = ACTION_LABELS[entry.action] || entry.action || 'Hoạt động';
            return (
              <React.Fragment key={entry.id ?? idx}>
                {idx > 0 && <div className="wf-divider" />}
                <ClickableCard
                  to="/audit-log"
                  className="wf-aurow"
                  ariaLabel="Xem nhật ký hoạt động"
                >
                  <span className={`audit-dot ${categoryDotClass(entry.category)}`} style={{ width: 8, height: 8 }} />
                  <div className="tx">
                    <div className="lab">
                      <span className="audit-event-tag">
                        {categoryIcon(entry.category)}
                        <span className="lbl-txt">{label}</span>
                      </span>
                      <span className="t">{formatTimeShort(entry.timestamp)}</span>
                    </div>
                    <div className="msg" title={entry.message}>
                      {entry.message}
                    </div>
                  </div>
                </ClickableCard>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
