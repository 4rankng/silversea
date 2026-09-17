import { NO_INVOICE_EVIDENCE_TYPE_LABELS, OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import { FormGroup } from '../../components/UI';
import { DateInput } from '../../design-system/forms/DateInput';
import { UuiSelectField } from '../../design-system';
import type { ForwarderExpenseFormController } from './use-forwarder-expense-form';
import type { ForwarderExpenseTypeOption } from './forwarder-expense-model';
import {
  FORWARDER_LCL_SCOPE_LABEL,
  getForwarderContainerDisplayLabel,
  isSyntheticLclContainer,
  type ForwarderContainer,
} from './forwarder-trip-detail-sections';

export interface ForwarderExpenseFormProps {
  controller: ForwarderExpenseFormController;
  containers: ForwarderContainer[];
  supplierOptions: Array<{ id: number; name: string }>;
  portOptions: Array<{ id: number; name: string }>;
  containerTypeOptions: Array<{ id: number; code: string; name: string }>;
  forwarderExpenseTypeOptions: ForwarderExpenseTypeOption[];
}

/** Add/edit expense form — field layout only; all state lives in the controller. */
export function ForwarderExpenseForm({
  controller,
  containers,
  supplierOptions,
  portOptions,
  containerTypeOptions,
  forwarderExpenseTypeOptions,
}: ForwarderExpenseFormProps) {
  const {
    form: expenseForm,
    errors: expenseErrors,
    submitError: expenseSubmitError,
    editingExpenseId,
    saving,
    isLiftExpense,
    suggestedLiftPrice,
    liftPriceDelta,
    liftPriceStatus,
    noInvoiceAllowed,
    allowedEvidenceTypes,
    noInvoiceLimits,
    selectedExpenseContainer,
    selectedExpenseContainerIsSyntheticLcl,
    setType,
    setBuyAmount,
    setSettlementMethod,
    selectSupplier,
    selectContainer,
    patch,
    toggleEvidenceType,
    clearError,
    cancel,
    submit,
  } = controller;

  if (!controller.show) return null;

  return (
    <div className="fwd-expense-form">
      {/* Row 1: type + amounts + settlement */}
      <div className="fwd-expense-grid fwd-expense-grid--primary">
        <FormGroup label="Loại chi phí">
          <UuiSelectField
            id="fwd-expense-type"
            label="Loại chi phí"
            hideLabel
            value={expenseForm.expenseType}
            onChange={e => setType(e.target.value)}
            options={(forwarderExpenseTypeOptions.length > 0
              ? forwarderExpenseTypeOptions.map((type) => [type.code, { name: type.name }] as const)
              : Object.entries(OPS_EXPENSE_TYPE_DEFAULTS)
            ).map(([code, cfg]) => ({
              value: code,
              label: cfg.name,
            }))}
          />
        </FormGroup>

        <FormGroup
          label="Giá mua vào (VNĐ) *"
        >
          <input
            className={`input${expenseErrors.buyAmount ? ' input--error' : ''}${isLiftExpense ? ' fwd-input--readonly' : ''}`}
            type="number"
            value={expenseForm.buyAmount}
            onChange={e => setBuyAmount(e.target.value)}
            placeholder="0"
            min="1"
            readOnly={isLiftExpense}
            aria-readonly={isLiftExpense}
          />
          {expenseErrors.buyAmount && (
            <span className="fwd-field-error-inline">
              {expenseErrors.buyAmount}
            </span>
          )}
          {isLiftExpense && liftPriceStatus.isFetching && (
            <span className="fwd-price-hint" role="status">Đang tra biểu giá nâng/hạ…</span>
          )}
          {isLiftExpense && liftPriceStatus.isError && (
            <span className="fwd-price-hint fwd-price-hint--error">Không tra được biểu giá. Vui lòng kiểm tra lại cảng, loại cont hoặc ngày chi.</span>
          )}
          {isLiftExpense && !liftPriceStatus.isFetching && suggestedLiftPrice > 0 && (
            <span className="fwd-price-hint">
              Áp tự động {suggestedLiftPrice.toLocaleString('vi-VN')} VNĐ
              {liftPriceDelta !== 0 ? ` · chênh ${liftPriceDelta > 0 ? '+' : ''}${liftPriceDelta.toLocaleString('vi-VN')} VNĐ` : ''}
            </span>
          )}
          {isLiftExpense && liftPriceStatus.manualSource && (
            <span className="fwd-price-hint fwd-price-hint--error">Chưa có biểu giá phù hợp. Không được nhập tay phí nâng/hạ; cần bổ sung bảng giá trước khi lưu.</span>
          )}
        </FormGroup>

        <FormGroup
          label="Giá bán ra (VNĐ)"
        >
          <input
            className={`input${!OPS_EXPENSE_TYPE_DEFAULTS[expenseForm.expenseType]?.defaultMarkup ? ' fwd-input--readonly' : ''}`}
            type="number"
            value={expenseForm.sellAmount}
            onChange={e => patch({ sellAmount: e.target.value })}
            placeholder="0"
            min="0"
            readOnly={!OPS_EXPENSE_TYPE_DEFAULTS[expenseForm.expenseType]?.defaultMarkup}
          />
        </FormGroup>

        <FormGroup label="Hình thức chi">
          <UuiSelectField
            id="fwd-settlement-method"
            label="Hình thức chi"
            hideLabel
            value={expenseForm.settlementMethod}
            onChange={e => {
              const v = e.target.value as 'OPS_ADVANCE' | 'COMPANY_DIRECT';
              setSettlementMethod(v);
            }}
            options={[
              { value: 'OPS_ADVANCE', label: 'Chi hộ tạm ứng' },
              { value: 'COMPANY_DIRECT', label: 'Công ty trả trực tiếp' },
            ]}
          />
        </FormGroup>
      </div>

      {/* Row 2: supplier (when company-direct) + container number */}
      <div className="fwd-expense-grid fwd-expense-grid--context">
        {isLiftExpense && (
          <>
            <FormGroup label="Cảng / bãi *">
              <UuiSelectField
                id="fwd-port"
                label="Cảng / bãi"
                hideLabel
                value={expenseForm.portId}
                onChange={e => { patch({ portId: e.target.value }); }}
                options={[
                  { value: '', label: '— Chọn cảng —' },
                  ...portOptions.map(port => ({ value: String(port.id), label: port.name })),
                ]}
              />
            </FormGroup>
            <FormGroup label="Loại container *">
              <UuiSelectField
                id="fwd-container-type"
                label="Loại container"
                hideLabel
                value={expenseForm.containerTypeId}
                onChange={e => { patch({ containerTypeId: e.target.value }); }}
                options={[
                  { value: '', label: '— Chọn loại —' },
                  ...containerTypeOptions.map(type => ({ value: String(type.id), label: `${type.code} — ${type.name}` })),
                ]}
              />
            </FormGroup>
            <FormGroup label="Hàng / Rỗng">
              <UuiSelectField
                id="fwd-load-state"
                label="Hàng / Rỗng"
                hideLabel
                value={expenseForm.loadState}
                onChange={e => { patch({ loadState: e.target.value as 'LOADED' | 'EMPTY' }); }}
                options={[
                  { value: 'LOADED', label: 'Hàng' },
                  { value: 'EMPTY', label: 'Rỗng' },
                ]}
              />
            </FormGroup>
          </>
        )}
        {expenseForm.settlementMethod === 'COMPANY_DIRECT' && (
          <FormGroup label="Nhà cung cấp *">
            <UuiSelectField
              id="fwd-supplier"
              label="Nhà cung cấp"
              hideLabel
              value={expenseForm.supplierId}
              error={expenseErrors.supplierId}
              onChange={e => {
                const selectedSupplier = supplierOptions.find(item => String(item.id) === e.target.value);
                selectSupplier(e.target.value, selectedSupplier?.name || '');
              }}
              options={[
                { value: '', label: '-- Chọn NCC --' },
                ...supplierOptions.map(s => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </FormGroup>
        )}

        {containers.length === 0 && (
          <div className="fwd-expense-empty-container">
            Chưa có container; chi phí này sẽ lưu như chi phí chung của chuyến.
          </div>
        )}

        {containers.length === 1 && selectedExpenseContainer && !selectedExpenseContainerIsSyntheticLcl && (
          <FormGroup label="Container áp dụng">
            <div
              className="input fwd-container-display"
            >
              <span className="fwd-container-display__label">{getForwarderContainerDisplayLabel(selectedExpenseContainer)}</span>
              {selectedExpenseContainer.sealNumber && (
                <span className="fwd-container-display__seal">Seal {selectedExpenseContainer.sealNumber}</span>
              )}
            </div>
          </FormGroup>
        )}

        {containers.length > 1 && (
          <FormGroup label="Container áp dụng">
            <UuiSelectField
              id="fwd-container"
              label="Container áp dụng"
              hideLabel
              value={expenseForm.tripContainerId}
              onChange={e => selectContainer(e.target.value)}
              options={[
                { value: '', label: 'Chi phí chung của chuyến' },
                ...containers.map(c => ({
                  value: String(c.id),
                  label: `${getForwarderContainerDisplayLabel(c)}${!isSyntheticLclContainer(c) && c.sealNumber ? ` · Seal ${c.sealNumber}` : ''}`,
                })),
              ]}
            />
            <span className="fwd-field-hint">
              {containers.some((container) => isSyntheticLclContainer(container))
                ? `Chọn ${FORWARDER_LCL_SCOPE_LABEL.toLowerCase()} hoặc container từ danh sách đã nhập, không cần gõ lại.`
                : 'Chọn container từ danh sách đã nhập, không cần gõ lại số container.'}
            </span>
          </FormGroup>
        )}
      </div>

      {/* Row 3: invoice + declaration + note */}
      <div className="fwd-expense-grid fwd-expense-grid--invoice">
        {expenseForm.expenseType !== 'INFRASTRUCTURE' && (
          <>
            <FormGroup label="Số hóa đơn">
              <input
                className="input fwd-input--data"
                value={expenseForm.invoiceNumber}
                onChange={e => { patch({ invoiceNumber: e.target.value }); }}
                placeholder="Số hóa đơn"
              />
            </FormGroup>
            <FormGroup label="Ngày hóa đơn">
              <DateInput
                className="input"
                value={expenseForm.invoiceDate}
                onChange={(value) => patch({ invoiceDate: value })}
              />
            </FormGroup>
          </>
        )}

        {expenseForm.expenseType === 'CUSTOMS' && (
          <FormGroup label="Số tờ khai hải quan *">
            <input
              className={`input fwd-input--data${expenseErrors.declarationNumber ? ' input--error' : ''}`}
              value={expenseForm.declarationNumber}
              onChange={e => {
                patch({ declarationNumber: e.target.value });
                clearError('declarationNumber');
              }}
              placeholder="Số tờ khai"
            />
            {expenseErrors.declarationNumber && (
              <span className="fwd-field-error-inline">
                {expenseErrors.declarationNumber}
              </span>
            )}
          </FormGroup>
        )}

        <FormGroup label={expenseForm.invoiceNumber.trim() ? 'Ghi chú' : 'Lý do chi *'}>
          <input
            className={`input${expenseErrors.note ? ' input--error' : ''}`}
            value={expenseForm.note}
            onChange={e => {
              patch({ note: e.target.value });
              clearError('note');
            }}
            placeholder={expenseForm.invoiceNumber.trim() ? 'Ghi chú (tuỳ chọn)' : 'Mô tả lý do chi và chứng từ bổ sung'}
          />
          {expenseErrors.note && <span className="field-error">{expenseErrors.note}</span>}
        </FormGroup>
      </div>

      {!expenseForm.invoiceNumber.trim() && (
        <div className="fwd-expense-grid fwd-expense-grid--invoice fwd-expense-no-invoice-divider">
          <FormGroup label="Ngày chi *">
            <DateInput
              className={`input${expenseErrors.expenseDate ? ' input--error' : ''}`}
              value={expenseForm.expenseDate}
              onChange={(value) => {
                patch({ expenseDate: value });
                clearError('expenseDate');
              }}
            />
            {expenseErrors.expenseDate && <span className="field-error">{expenseErrors.expenseDate}</span>}
          </FormGroup>

          <FormGroup label="Người nhận *">
            <input
              className={`input${expenseErrors.payeeName ? ' input--error' : ''}`}
              value={expenseForm.payeeName}
              onChange={e => {
                patch({ payeeName: e.target.value });
                clearError('payeeName');
              }}
              placeholder="Tên người nhận / đơn vị nhận"
            />
            {expenseErrors.payeeName && <span className="field-error">{expenseErrors.payeeName}</span>}
          </FormGroup>

          <div className="fwd-expense-grid__full-width">
            <div className="fwd-evidence-label">Chứng cứ thay thế *</div>
            {!noInvoiceAllowed ? (
              <div className="fwd-evidence-error">
                Hạng mục này không cho phép chi không hóa đơn.
              </div>
            ) : (
              <>
                <div className="fwd-evidence-grid">
                  {allowedEvidenceTypes.map((value) => (
                    <label key={value} className="fwd-evidence-option">
                      <input
                        type="checkbox"
                        checked={expenseForm.noInvoiceEvidenceTypes.includes(value)}
                        onChange={(event) => toggleEvidenceType(value, event.target.checked)}
                      />
                      <span>{NO_INVOICE_EVIDENCE_TYPE_LABELS[value as keyof typeof NO_INVOICE_EVIDENCE_TYPE_LABELS] ?? value}</span>
                    </label>
                  ))}
                </div>
                {expenseErrors.evidence && <div className="field-error">{expenseErrors.evidence}</div>}
                <div className="fwd-evidence-hint">
                  Ngưỡng hiện tại: {noInvoiceLimits.perItem.toLocaleString('vi-VN')} đ/khoản,
                  {' '}{noInvoiceLimits.perDay.toLocaleString('vi-VN')} đ/người/ngày.
                  Nếu chọn ảnh hiện trường, hãy lưu xong rồi tải ảnh lên ngay dưới dòng chi phí.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {expenseSubmitError && (
        <div
          className="animate-shake fwd-expense-submit-error"
          role="alert"
        >
          {expenseSubmitError}
        </div>
      )}

      <div className="fwd-expense-form-actions">
        <button
          className="btn btn--ghost btn--sm"
          onClick={cancel}
          disabled={saving}
        >
          Hủy
        </button>
        <button
          className="btn btn--primary btn--sm"
          onClick={submit}
          disabled={saving}
        >
          {saving ? 'Đang lưu…' : editingExpenseId ? 'Lưu điều chỉnh' : 'Lưu chi phí'}
        </button>
      </div>
    </div>
  );
}
