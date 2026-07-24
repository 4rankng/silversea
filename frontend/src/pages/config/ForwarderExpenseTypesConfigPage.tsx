import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { Save, Loader2, Trash2 } from 'lucide-react';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';

interface ForwarderExpenseType {
  id: number;
  code: string;
  name: string;
  status: string;
  defaultMarkup?: boolean;
  billingLabel?: string | null;
  vatRate?: string | null;
}

function ExpenseTypeForm({
  saving,
  item,
  onsave,
  oncancel,
  existingItems,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: ForwarderExpenseType;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  existingItems: ForwarderExpenseType[];
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [code, setCode] = useState(item?.code || '');
  const [name, setName] = useState(item?.name || '');
  const [defaultMarkup, setDefaultMarkup] = useState<boolean>(item?.defaultMarkup ?? false);
  const [billingLabel, setBillingLabel] = useState(item?.billingLabel || '');
  const [vatRate, setVatRate] = useState(item?.vatRate ? String(parseFloat(item.vatRate) * 100) : '8');

  const isDuplicate = code.trim().length > 0 && existingItems.some(t =>
    t.id !== item?.id &&
    t.code.trim().toUpperCase() === code.trim().toUpperCase()
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      {/* Row 1: Mã (Code) (Left, 30% width) and Tên tiếng Việt (Right, 70% width) */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ width: '30%', minWidth: 120 }}>
          <Field label="Mã (code)">
            <input
              className="input"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="LIFTING"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                ...(isDuplicate ? { borderColor: 'var(--danger)' } : {}),
                ...(item ? { background: 'var(--bg-2)', color: 'var(--fg-3)', cursor: 'not-allowed' } : {})
              }}
              disabled={!!item}
              title={item ? 'Mã liên kết với mã hệ thống — không sửa được sau khi tạo.' : undefined}
            />
            {isDuplicate && (
              <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--danger)', marginTop: 2, display: 'block' }}>
                Mã này đã tồn tại.
              </span>
            )}
            {item && (
              <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', marginTop: 2, display: 'block' }}>
                Mã liên kết với mã hệ thống — không sửa được sau khi tạo.
              </span>
            )}
          </Field>
        </div>
        <div style={{ width: '70%', minWidth: 180 }}>
          <Field label="Tên tiếng Việt">
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nâng hạ"
              style={{ fontSize: 13 }}
            />
          </Field>
        </div>
      </div>

      {/* Row 2: Nhãn trên giấy báo nợ (Full width) */}
      <div style={{ width: '100%' }}>
        <Field label="Nhãn trên giấy báo nợ">
          <input
            className="input"
            value={billingLabel}
            onChange={e => setBillingLabel(e.target.value)}
            placeholder="(mặc định: dùng Tên)"
            style={{ fontSize: 13 }}
          />
        </Field>
      </div>

      {/* Row 3: VAT (%) (Left, 50%) and the Checkbox area (Right, 50%) */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ width: '50%', minWidth: 110 }}>
          <Field label="VAT (%)">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                className="input"
                type="number"
                value={vatRate}
                onChange={e => setVatRate(e.target.value)}
                placeholder="8"
                min="0"
                max="100"
                step="0.1"
                style={{ paddingRight: 32, fontSize: 13 }}
              />
              <span style={{
                position: 'absolute',
                right: 12,
                color: 'var(--ink-3)',
                fontSize: 13,
                fontWeight: 500,
                pointerEvents: 'none'
              }}>
                %
              </span>
            </div>
          </Field>
        </div>
        <div style={{ width: '50%', minWidth: 140, paddingBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={defaultMarkup}
                onChange={e => setDefaultMarkup(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <span>Cho phép báo khách khác số gốc</span>
            </label>
            <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ink-3)', paddingLeft: 24 }}>
              (Báo khách ≠ số gốc)
            </span>
          </div>
        </div>
      </div>

      {/* Dialog Footer Section */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '12px 0 4px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingTop: 4 }}>
        {/* Destructive Xóa cấu hình này (Delete) button on the bottom left (only in edit mode) */}
        <div>
          {item && onDelete && (
            <button
              type="button"
              className="btn btn--danger"
              style={{
                borderColor: 'var(--danger-soft)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              disabled={deleting || saving}
              onClick={async (e) => {
                e.stopPropagation();
                await onDelete();
              }}
            >
              {deleting ? (
                <>
                  <Loader2 size={14} className="spin" /> Đang xóa...
                </>
              ) : (
                <>
                  <Trash2 size={14} /> Xóa cấu hình này
                </>
              )}
            </button>
          )}
        </div>

        {/* Cancel and Save buttons next to each other on the bottom right */}
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Hủy (Cancel) button styled as standard secondary button (grey text with light grey background/subtle outline, no icon) */}
          <button
            type="button"
            className="btn btn--secondary"
            style={{
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer'
            }}
            disabled={saving}
            onClick={oncancel}
          >
            Hủy
          </button>

          {/* Cập nhật (Update) / Thêm button (flat style, no heavy shadow/glow) */}
          <button
            type="button"
            className="btn btn--primary"
            style={{
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
            disabled={saving || isDuplicate || !code.trim() || !name.trim()}
            onClick={() => {
              if (!code.trim() || !name.trim() || isDuplicate) return;
              const rate = parseFloat(vatRate);
              onsave({
                code: code.trim().toUpperCase(),
                name: name.trim(),
                defaultMarkup,
                billingLabel: billingLabel.trim() || null,
                vatRate: isFinite(rate) ? (rate / 100).toFixed(3) : '0.080',
              });
            }}
          >
            {saving ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Save size={14} />
            )}
            {item ? 'Cập nhật' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatPercent(rate?: string | null): string {
  if (rate == null) return '—';
  const n = parseFloat(rate);
  if (!isFinite(n)) return '—';
  return `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export default function ForwarderExpenseTypesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<ForwarderExpenseType>
      title="Loại chi phí giao nhận"
      description="Các khoản phí phát sinh do giao nhận nhập — nâng hạ, hải quan, cân xe, kiểm tra…"
      endpoint="/forwarder-expense-types"
      colSpan={5}
      iconName="forwarder-expense"
      showDelete={false}
      pageSlug="forwarder-expense-types"
      // Force reload
      emptyIllustration="empty-expenses.svg"
      emptyTitle="Chưa có loại chi phí"
      emptyHint="Thêm các loại chi phí giao nhận để nhân viên ghi nhận khi phát sinh."
      columns={[
        {
          header: 'Mã',
          render: (t) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-1)' }}>{t.code}</span>,
        },
        {
          header: 'Tên',
          render: (t) => <span style={{ fontWeight: 500 }}>{t.name}</span>,
        },
        {
          header: 'Nhãn trên giấy báo nợ',
          render: (t) => <span style={{ color: t.billingLabel ? 'var(--fg-1)' : 'var(--fg-3)' }}>{t.billingLabel || '— (dùng Tên)'}</span>,
        },
        {
          header: 'VAT',
          render: (t) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPercent(t.vatRate)}</span>,
        },
        {
          header: 'Cộng lãi',
          render: (t) => (
            <span style={{
              fontSize: 12, lineHeight: 1.35, fontWeight: 600,
              padding: '2px 8px', borderRadius: 4,
              background: t.defaultMarkup ? 'rgba(0,177,79,0.1)' : 'rgba(120,120,120,0.1)',
              color: t.defaultMarkup ? 'var(--brand)' : 'var(--fg-3)',
            }}>
              {t.defaultMarkup ? 'Có' : 'Giữ giá gốc'}
            </span>
          ),
        },
      ]}
      renderForm={(p) => (
        <ExpenseTypeForm
          saving={p.saving}
          item={p.item}
          onsave={p.onSave}
          oncancel={p.onCancel}
          existingItems={p.items as ForwarderExpenseType[]}
          onDelete={p.onDelete}
          deleting={p.deleting}
        />
      )}
    />
    </div>
  );
}
