import { useState } from 'react';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  NO_INVOICE_POLICY_DEFAULTS,
} from '@tingting/shared';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { usePageAnimations } from '../../hooks/animations';

interface ForwarderExpenseType {
  id: number;
  code: string;
  name: string;
  status: string;
  requiresInvoice?: boolean;
  substituteEvidenceAllowed?: boolean;
  noInvoiceEvidenceTypes?: string[];
  noInvoicePerItemLimit?: string | null;
  noInvoicePerDayLimit?: string | null;
  noInvoiceFinanceLeadItemApprovalLimit?: string | null;
  noInvoiceDirectorDayApprovalLimit?: string | null;
  noInvoicePolicyVersion?: number;
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
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600, color: 'var(--ink-2)', fontSize: 13, opacity: disabled ? 0.6 : 1 }}>
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
  const [financeLeadLimit, setFinanceLeadLimit] = useState(
    item?.noInvoiceFinanceLeadItemApprovalLimit ?? String(NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit),
  );
  const [directorDayLimit, setDirectorDayLimit] = useState(
    item?.noInvoiceDirectorDayApprovalLimit ?? String(NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit),
  );

  const isDuplicate = code.trim().length > 0 && existingItems.some((type) =>
    type.id !== item?.id && type.code.trim().toUpperCase() === code.trim().toUpperCase(),
  );

  const noInvoiceEnabled = !requiresInvoice && substituteEvidenceAllowed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ width: '30%', minWidth: 120 }}>
          <Field label="Mã (code)">
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="LIFTING"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                ...(isDuplicate ? { borderColor: 'var(--danger)' } : {}),
                ...(item ? { background: 'var(--bg-2)', color: 'var(--fg-3)', cursor: 'not-allowed' } : {}),
              }}
              disabled={!!item}
            />
          </Field>
        </div>
        <div style={{ width: '70%', minWidth: 180 }}>
          <Field label="Tên tiếng Việt">
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nâng hạ"
              style={{ fontSize: 13 }}
            />
          </Field>
        </div>
      </div>

      <Field label="Nhãn trên giấy báo nợ">
        <input
          className="input"
          value={billingLabel}
          onChange={(event) => setBillingLabel(event.target.value)}
          placeholder="(mặc định: dùng Tên)"
          style={{ fontSize: 13 }}
        />
      </Field>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
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
                style={{ paddingRight: 32, fontSize: 13 }}
              />
              <span style={{ position: 'absolute', right: 12, color: 'var(--ink-3)', fontSize: 13, fontWeight: 500, pointerEvents: 'none' }}>%</span>
            </div>
          </Field>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
          <PolicyCheckbox
            checked={defaultMarkup}
            label="Cho phép báo khách khác số gốc"
            onChange={setDefaultMarkup}
          />
          <div style={{ fontSize: 12, color: 'var(--ink-3)', paddingLeft: 24 }}>(Báo khách ≠ số gốc)</div>
        </div>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Chính sách chi không hóa đơn</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
              Chỉ áp dụng cho các hạng mục được phép chi không hóa đơn. Phiên bản chính sách: <strong>{item?.noInvoicePolicyVersion ?? 1}</strong>
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

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', opacity: noInvoiceEnabled ? 1 : 0.55 }}>
            <Field label="Ngưỡng mỗi khoản">
              <input className="input mono" type="number" min="0" step="1000" value={perItemLimit} disabled={!noInvoiceEnabled} onChange={(event) => setPerItemLimit(event.target.value)} />
            </Field>
            <Field label="Ngưỡng/người/ngày">
              <input className="input mono" type="number" min="0" step="1000" value={perDayLimit} disabled={!noInvoiceEnabled} onChange={(event) => setPerDayLimit(event.target.value)} />
            </Field>
            <Field label="Tài chính duyệt tối đa/khoản">
              <input className="input mono" type="number" min="0" step="1000" value={financeLeadLimit} disabled={!noInvoiceEnabled} onChange={(event) => setFinanceLeadLimit(event.target.value)} />
            </Field>
            <Field label="Giám đốc duyệt khi tổng ngày vượt">
              <input className="input mono" type="number" min="0" step="1000" value={directorDayLimit} disabled={!noInvoiceEnabled} onChange={(event) => setDirectorDayLimit(event.target.value)} />
            </Field>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>Chứng cứ thay thế được chấp nhận</div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', opacity: noInvoiceEnabled ? 1 : 0.55 }}>
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
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
              Maker bắt buộc nhập số tiền, ngày chi, người nhận, chuyến/container, lý do và ít nhất một chứng cứ trong danh sách này.
            </div>
          </div>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '12px 0 4px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingTop: 4 }}>
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
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}
            >
              {deleting ? <><Loader2 size={14} className="spin" /> Đang xóa...</> : <><Trash2 size={14} /> Xóa cấu hình này</>}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
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
                vatRate: Number.isFinite(rate) ? (rate / 100).toFixed(3) : '0.080',
                requiresInvoice,
                substituteEvidenceAllowed: noInvoiceEnabled,
                noInvoiceEvidenceTypes: noInvoiceEnabled ? selectedEvidence : [],
                noInvoicePerItemLimit: noInvoiceEnabled ? Number(perItemLimit || 0) : NO_INVOICE_POLICY_DEFAULTS.perItemLimit,
                noInvoicePerDayLimit: noInvoiceEnabled ? Number(perDayLimit || 0) : NO_INVOICE_POLICY_DEFAULTS.perDayLimit,
                noInvoiceFinanceLeadItemApprovalLimit: noInvoiceEnabled ? Number(financeLeadLimit || 0) : NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit,
                noInvoiceDirectorDayApprovalLimit: noInvoiceEnabled ? Number(directorDayLimit || 0) : NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit,
              });
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}
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
        colSpan={7}
        iconName="forwarder-expense"
        showDelete={false}
        pageSlug="forwarder-expense-types"
        emptyIllustration="empty-expenses.svg"
        emptyTitle="Chưa có loại chi phí"
        emptyHint="Thêm các loại chi phí giao nhận để nhân viên ghi nhận khi phát sinh."
        columns={[
          {
            header: 'Mã',
            render: (item) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-1)' }}>{item.code}</span>,
          },
          {
            header: 'Tên',
            render: (item) => <span style={{ fontWeight: 500 }}>{item.name}</span>,
          },
          {
            header: 'Không HĐ',
            render: (item) => (
              <span style={{
                fontSize: 12,
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
              <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.45 }}>
                <div>{formatVnd(item.noInvoicePerItemLimit)} / khoản</div>
                <div>{formatVnd(item.noInvoicePerDayLimit)} / ngày</div>
              </div>
            ),
          },
          {
            header: 'Điều hướng duyệt',
            render: (item) => (
              <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.45 }}>
                <div>Tài chính: {formatVnd(item.noInvoiceFinanceLeadItemApprovalLimit)}</div>
                <div>Giám đốc: {formatVnd(item.noInvoiceDirectorDayApprovalLimit)} / ngày</div>
              </div>
            ),
          },
          {
            header: 'VAT',
            render: (item) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPercent(item.vatRate)}</span>,
          },
          {
            header: 'Cộng lãi',
            render: (item) => (
              <span style={{
                fontSize: 12,
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
