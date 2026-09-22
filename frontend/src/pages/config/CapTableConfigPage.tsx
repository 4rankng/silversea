import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { formatCurrency } from '../../lib/format';
import type { CapTableHistory } from '@tingting/shared';
import { DateInput } from '../../design-system/forms/DateInput';

function CapTableForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: CapTableHistory; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [partnerName, setPartnerName] = useState(item?.partnerName || '');
  const [contributionAmount, setContributionAmount] = useState(item?.contributionAmount || '');
  const [effectiveDate, setEffectiveDate] = useState(item ? item.effectiveDate.split('T')[0] : '');
  return (
    <InlineForm colSpan={5}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tên cổ đông"><input className="input" required pattern={'.*\\S.*'} value={partnerName} onChange={e => setPartnerName(e.target.value)} placeholder="Nhập tên cổ đông…" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 130 }}>
        <Field label="Số vốn góp (₫)"><input className="input" type="number" step="1000000" required value={contributionAmount} onChange={e => setContributionAmount(e.target.value)} placeholder="0" /></Field>
      </div>
      <div style={{ flex: 1.5, minWidth: 150 }}>
        <Field label="Ngày hiệu lực"><DateInput required className="input" value={effectiveDate} onChange={setEffectiveDate} /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => {
        if (!partnerName.trim() || !contributionAmount || !effectiveDate) return;
        onsave({ partnerName: partnerName.trim(), contributionAmount: Number(contributionAmount), effectiveDate });
      }} />
    </InlineForm>
  );
}

function computeCapTableActiveIds(items: CapTableHistory[]): Set<number> {
  if (!items.length) return new Set();
  const today = new Date().toISOString().slice(0, 10);
  const reached = items.filter(c => c.effectiveDate <= today);
  const pool = reached.length > 0 ? reached : items;
  const latestDate = pool.reduce((a, c) => (c.effectiveDate > a ? c.effectiveDate : a), pool[0].effectiveDate);
  const byName = new Map<string, CapTableHistory>();
  for (const row of pool.filter(c => c.effectiveDate === latestDate)) {
    const prev = byName.get(row.partnerName);
    if (!prev || new Date(row.createdAt) > new Date(prev.createdAt)) byName.set(row.partnerName, row);
  }
  return new Set(Array.from(byName.values(), r => r.id));
}

/** Auto-calculate percentage from contribution amounts */
function computePercentages(items: CapTableHistory[]): Map<number, number> {
  const activeIds = computeCapTableActiveIds(items);
  const activeItems = items.filter(i => activeIds.has(i.id));
  const total = activeItems.reduce((sum, i) => sum + (parseFloat(i.contributionAmount) || 0), 0);
  const map = new Map<number, number>();
  for (const i of activeItems) {
    const amt = parseFloat(i.contributionAmount) || 0;
    map.set(i.id, total > 0 ? Math.round((amt / total) * 10000) / 100 : 0);
  }
  return map;
}

export default function CapTableConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<CapTableHistory>
      title="Cổ đông & Vốn góp" description="Danh sách cổ đông và lịch sử góp vốn"
      endpoint="/cap-table" colSpan={5}
      showDelete={false}
      pageSlug="cap-table"
      iconName="equity-ownership"
      emptyContext="pie"
      emptyTitle="Chưa có cổ đông"
      emptyHint="Thêm thông tin vốn góp để hệ thống tự động tính tỷ lệ cổ phần."
      computeActiveIds={computeCapTableActiveIds}
      sortFn={(a, b) => {
        if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }}
      rowStyle={(_item, isActive) => isActive ? undefined : { opacity: 0.55 }}
      toolbarLeft={({ totalItems, activeCount }) => activeCount > 0 ? (
        <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>
          Hiện tại: <strong style={{ color: 'var(--fg-1)' }}>{activeCount}</strong> cổ đông đang chia · {totalItems - activeCount} bản ghi lịch sử
        </span>
      ) : null}
      columns={[
        {
          header: 'Tên cổ đông',
          render: (ct, _i, isActive) => (
            <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>
              {ct.partnerName}
              {isActive && (
                <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 'var(--text-caption-size)', fontWeight: 700, letterSpacing: '0.04em' }}>HIỆN TẠI</span>
              )}
            </span>
          ),
        },
        {
          header: 'Số vốn góp',
          className: 'num',
          render: (ct) => <span style={{ fontWeight: 600 }}>{formatCurrency(parseFloat(ct.contributionAmount) || 0)}</span>,
        },
        {
          header: 'Tỷ lệ (%)',
          className: 'num',
          render: (ct, _i, isActive, allItems) => {
            const pctMap = computePercentages(allItems);
            const pct = pctMap.get(ct.id);
            return <span style={{ fontWeight: 600, color: isActive ? 'var(--brand)' : 'var(--fg-2)' }}>{pct !== undefined ? `${pct.toFixed(2)}%` : '—'}</span>;
          },
        },
        {
          header: 'Ngày hiệu lực',
          render: (ct) => ct.effectiveDate ? new Date(ct.effectiveDate).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—',
        },
      ]}
      renderForm={(p) => <CapTableForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} />}
    />
    </div>
  );
}
