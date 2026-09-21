import { useState } from 'react';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  EXPENSE_FEE_GROUP_LABELS,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  NO_INVOICE_POLICY_DEFAULTS,
  expenseFeeGroupOf,
} from '@tingting/shared';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { usePageAnimations } from '../../hooks/animations';

interface ForwarderExpenseType {
  id: number;
  category?: string | null;
  code: string;
  name: string;
  status: string;
  requiresInvoice?: boolean;
  substituteEvidenceAllowed?: boolean;
  noInvoiceEvidenceTypes?: string[];
  noInvoicePerItemLimit?: string | null;
  noInvoicePerDayLimit?: string | null;
  defaultMarkup?: boolean;
  billingLabel?: string | null;
  vatRate?: string | null;
}

function formatVnd(value?: string | null): string {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? `${num.toLocaleString('vi-VN')} đ` : '—';
}

function PolicyCheckbox({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600, color: 'var(--ink-2)', fontSize: 'var(--text-label-size)', opacity: disabled ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 16, height: 16, cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <span>{label}</span>
    </label>
  );
}

/** Display labels for the settlement category of an expense type (BE _3). */
const CATEGORY_LABELS: Record<string, string> = {
  HQGS: 'HQGS (hải quan giám sát)',
  PHAT_SINH: 'Phát sinh',
  KHAC: 'Khác',
  LIFT: 'Phí nâng',
  DROP: 'Phí hạ',
  CSHT: 'CSHT (sửa chữa hạ tầng)',
  CARRIER_DETENTION: 'Cược hãng tàu',
  REPAIR_ADVANCE: 'Tạm thu sửa chữa',
  CARRIER_FREIGHT: 'Cước hãng tàu',
  ZONE_SURCHARGE: 'Phụ phí vùng',
};

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
  onsave: (data: Record<string, unknown>) => void;
  oncancel: () => void;
  existingItems: ForwarderExpenseType[];
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [code, setCode] = useState(item?.code || '');
  const [name, setName] = useState(item?.name || '');
  const [defaultMarkup, setDefaultMarkup] = useState<boolean>(item?.defaultMarkup ?? false);
  const [category, setCategory] = useState<string>(item?.category ?? '');
  const [billingLabel, setBillingLabel] = useState(item?.billingLabel || '');
  const [vatRate, setVatRate] = useState(item?.vatRate ? String(parseFloat(item.vatRate) * 100) : '8');
  const [requiresInvoice, setRequiresInvoice] = useState(item?.requiresInvoice ?? false);
  const [substituteEvidenceAllowed, setSubstituteEvidenceAllowed] = useState(
    item?.substituteEvidenceAllowed ?? false,
  );
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>(
    item?.noInvoiceEvidenceTypes?.length ? item.noInvoiceEvidenceTypes : [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES],
  );
  const [perItemLimit, setPerItemLimit] = useState(item?.noInvoicePerItemLimit ?? String(NO_INVOICE_POLICY_DEFAULTS.perItemLimit));
  const [perDayLimit, setPerDayLimit] = useState(item?.noInvoicePerDayLimit ?? String(NO_INVOICE_POLICY_DEFAULTS.perDayLimit));

  const isDuplicate = code.trim().length > 0 && existingItems.some((type) =>
    type.id !== item?.id && type.code.trim().toUpperCase() === code.trim().toUpperCase(),
  );

  const noInvoiceEnabled = !requiresInvoice && substituteEvidenceAllowed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      <div className="cfg-form-columns cfg-form-columns--code-name">
        <div>
          <Field label="Mã (code)">
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="Ví dụ: LIFTING"
              style={{
                fontFamily: 'var(--font-data)',

                ...(isDuplicate ? { borderColor: 'var(--danger)' } : {}),
                ...(item ? { background: 'var(--bg-2)', color: 'var(--fg-3)', cursor: 'not-allowed' } : {}),
              }}
              disabled={!!item}
            />
          </Field>
        </div>
        <div>
          <Field label="Tên tiếng Việt">
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nâng hạ"
            />
          </Field>
        </div>
      </div>

      <Field label="Nhóm chi phí (quyết toán)">
        <select
          className="input"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">— Chưa phân nhóm —</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>

      <Field label="Nhãn trên giấy báo nợ">
        <input
          className="input"
          value={billingLabel}
          onChange={(event) => setBillingLabel(event.target.value)}
          placeholder="(mặc định: dùng Tên)"
        />
      </Field>

      <div className="cfg-form-columns">
        <div>
          <Field label="VAT (%)">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                className="input"
                type="number"
                value={vatRate}
                onChange={(event) => setVatRate(event.target.value)}
                min="0"
                max="100"
                step="0.1"
                style={{ paddingRight: 32,  }}
              />
              <span style={{ position: 'absolute', right: 12, color: 'var(--ink-3)', fontSize: 'var(--text-data-size)', fontWeight: 500, pointerEvents: 'none' }}>%</span>
            </div>
          </Field>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
          <PolicyCheckbox
            checked={defaultMarkup}
            label="Cho phép báo khách khác số gốc"
            onChange={setDefaultMarkup}
          />
          <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)', paddingLeft: 24 }}>(Báo khách ≠ số gốc)</div>
        </div>
      </div>

      <section className="cfg-form-policy-section">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 'var(--text-body-size)', fontWeight: 700, color: 'var(--ink)' }}>Chính sách chi không hóa đơn</div>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)', marginTop: 4 }}>
              Chỉ áp dụng cho các hạng mục được phép chi không hóa đơn.
            </div>
          </div>

          <PolicyCheckbox
            checked={requiresInvoice}
            label="Bắt buộc phải có hóa đơn"
            onChange={(checked) => {
              setRequiresInvoice(checked);
              if (checked) setSubstituteEvidenceAllowed(false);
            }}
          />

          <PolicyCheckbox
            checked={substituteEvidenceAllowed}
            label="Cho phép chi không hóa đơn với chứng cứ thay thế"
            disabled={requiresInvoice}
            onChange={setSubstituteEvidenceAllowed}
          />

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', opacity: noInvoiceEnabled ? 1 : 0.55 }}>
            <Field label="Ngưỡng mỗi khoản">
              <input className="input mono" type="number" min="0" step="1000" value={perItemLimit} disabled={!noInvoiceEnabled} onChange={(event) => setPerItemLimit(event.target.value)} />
            </Field>
            <Field label="Ngưỡng/người/ngày">
              <input className="input mono" type="number" min="0" step="1000" value={perDayLimit} disabled={!noInvoiceEnabled} onChange={(event) => setPerDayLimit(event.target.value)} />
            </Field>
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-data-size)', fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>Chứng cứ thay thế được chấp nhận</div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', opacity: noInvoiceEnabled ? 1 : 0.55 }}>
              {Object.entries(NO_INVOICE_EVIDENCE_TYPE_LABELS).map(([value, label]) => (
                <PolicyCheckbox
                  key={value}
                  checked={selectedEvidence.includes(value)}
                  label={label}
                  disabled={!noInvoiceEnabled}
                  onChange={(checked) => {
                    setSelectedEvidence((current) => checked
                      ? [...current, value]
                      : current.filter((itemValue) => itemValue !== value));
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)', marginTop: 8 }}>
              Maker bắt buộc nhập số tiền, ngày chi, người nhận, chuyến/container, lý do và ít nhất một chứng cứ trong danh sách này.
            </div>
          </div>
        </div>
      </section>

      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '12px 0 4px' }} />

      <div className="cfg-form-footer">
        <div>
          {item && onDelete && (
            <button
              type="button"
              className="btn btn--danger"
              disabled={deleting || saving}
              onClick={async (event) => {
                event.stopPropagation();
                await onDelete();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6,  fontWeight: 500 }}
            >
              {deleting ? <><Loader2 size={14} className="spin" /> Đang xóa...</> : <><Trash2 size={14} /> Xóa cấu hình này</>}
            </button>
          )}
        </div>

        <div className="cfg-form-footer__primary">
          <button type="button" className="btn btn--secondary" disabled={saving} onClick={oncancel}>Hủy</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || isDuplicate || !code.trim() || !name.trim() || (noInvoiceEnabled && selectedEvidence.length === 0)}
            onClick={() => {
              const rate = parseFloat(vatRate);
              onsave({
                code: code.trim().toUpperCase(),
                name: name.trim(),
                defaultMarkup,
                billingLabel: billingLabel.trim() || null,
                category: category || null,
                vatRate: Number.isFinite(rate) ? (rate / 100).toFixed(3) : '0.080',
                requiresInvoice,
                substituteEvidenceAllowed: noInvoiceEnabled,
                noInvoiceEvidenceTypes: noInvoiceEnabled ? selectedEvidence : [],
                noInvoicePerItemLimit: noInvoiceEnabled ? Number(perItemLimit || 0) : NO_INVOICE_POLICY_DEFAULTS.perItemLimit,
                noInvoicePerDayLimit: noInvoiceEnabled ? Number(perDayLimit || 0) : NO_INVOICE_POLICY_DEFAULTS.perDayLimit,
              });
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6,  fontWeight: 600 }}
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatPercent(rate?: string | null): string {
  if (rate == null) return '—';
  const value = parseFloat(rate);
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export default function ForwarderExpenseTypesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });

  return (
    <div ref={pageRef}>
      <CrudTable<ForwarderExpenseType>
        title="Loại chi phí giao nhận"
        description="Các khoản phí phát sinh do giao nhận nhập — nâng hạ, hải quan, cân xe, kiểm tra…"
        endpoint="/forwarder-expense-types"
        colSpan={6}
        iconName="forwarder-expense"
        showDelete={false}
        pageSlug="forwarder-expense-types"
        emptyIllustration="empty-expenses.svg"
        emptyTitle="Chưa có loại chi phí"
        emptyHint="Thêm các loại chi phí giao nhận để nhân viên ghi nhận khi phát sinh."
        columns={[
          {
            header: 'Nhóm',
            render: (item) => <span style={{ fontWeight: 600, color: expenseFeeGroupOf(item.category) === 'OTHER' ? 'var(--fg-2)' : 'var(--brand)' }}>{EXPENSE_FEE_GROUP_LABELS[expenseFeeGroupOf(item.category)]}</span>,
          },
          {
            header: 'Mã',
            render: (item) => <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600, color: 'var(--fg-1)' }}>{item.code}</span>,
          },
          {
            header: 'Tên',
            render: (item) => <span style={{ fontWeight: 500 }}>{item.name}</span>,
          },
          {
            header: 'Không HĐ',
            render: (item) => (
              <span style={{
                fontSize: 'var(--text-caption-size)',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                background: item.substituteEvidenceAllowed ? 'rgba(0,177,79,0.1)' : 'rgba(120,120,120,0.1)',
                color: item.substituteEvidenceAllowed ? 'var(--brand)' : 'var(--fg-3)',
              }}>
                {item.requiresInvoice ? 'Bắt buộc HĐ' : item.substituteEvidenceAllowed ? 'Cho phép' : 'Không cho phép'}
              </span>
            ),
          },
          {
            header: 'Ngưỡng',
            render: (item) => (
              <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-2)', lineHeight: 1.45 }}>
                <div>{formatVnd(item.noInvoicePerItemLimit)} / khoản</div>
                <div>{formatVnd(item.noInvoicePerDayLimit)} / ngày</div>
              </div>
            ),
          },
          {
            header: 'VAT',
            render: (item) => <span>{formatPercent(item.vatRate)}</span>,
          },
          {
            header: 'Cộng lãi',
            render: (item) => (
              <span style={{
                fontSize: 'var(--text-caption-size)',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: item.defaultMarkup ? 'rgba(0,177,79,0.1)' : 'rgba(120,120,120,0.1)',
                color: item.defaultMarkup ? 'var(--brand)' : 'var(--fg-3)',
              }}>
                {item.defaultMarkup ? 'Có' : 'Giữ giá gốc'}
              </span>
            ),
          },
        ]}
        renderForm={(props) => (
          <ExpenseTypeForm
            saving={props.saving}
            item={props.item}
            onsave={props.onSave}
            oncancel={props.onCancel}
            existingItems={props.items as ForwarderExpenseType[]}
            onDelete={props.onDelete}
            deleting={props.deleting}
          />
        )}
      />
    </div>
  );
}
