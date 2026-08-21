import type React from 'react';
import type { DebitNoteTemplateColumn, DebitNoteTemplateInput } from '@tingting/shared';
import { cloneStarterColumns, sampleCell, type SelectedTarget } from './debit-note-template-editor-utils';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="debit-editor-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function TemplatePreview({
  form,
  disabled,
  selectedTarget,
  onSelect,
  onSet,
  onUpdateColumn,
}: {
  form: DebitNoteTemplateInput;
  disabled: boolean;
  selectedTarget: SelectedTarget;
  onSelect: (target: SelectedTarget) => void;
  onSet: <K extends keyof DebitNoteTemplateInput>(key: K, value: DebitNoteTemplateInput[K]) => void;
  onUpdateColumn: (columnId: string, patch: Partial<DebitNoteTemplateColumn>) => void;
}) {
  const columns = (form.columns ?? []).filter(column => column.width > 0);
  const visible = columns.length > 0 ? columns : cloneStarterColumns();
  const totalColumns = visible.filter(column => column.total);
  const canvasLocked = disabled;
  const previewTerms = (form.termsText || '- Số TK ...\n- Tại ngân hàng ...').split('\n');
  const accentStyle = { '--accent': form.accentColor } as React.CSSProperties;

  return (
    <aside className="debit-editor-preview" style={accentStyle} aria-label="Xem trước mẫu">
      <div className="debit-editor-canvas-frame">
        <div className="debit-editor-canvas-dragbar" aria-hidden="true">
          <span>⋮⋮</span>
          <span>Chọn nội dung để chỉnh</span>
          <span>⋮⋮</span>
        </div>
        <div className="debit-editor-preview__sheet">
          <div className="debit-editor-page-boundary">
            <div className="debit-editor-preview__export-header">
              <textarea
                className={`debit-editor-preview__title debit-editor-canvas-input ${selectedTarget.type === 'general' && selectedTarget.field === 'titleText' ? 'is-selected' : ''}`}
                value={form.titleText || ''}
                placeholder="Giấy báo nợ"
                aria-label="Tiêu đề mẫu giấy báo nợ"
                rows={1}
                onFocus={() => onSelect({ type: 'general', field: 'titleText' })}
                onChange={event => onSet('titleText', event.target.value)}
                disabled={canvasLocked}
              />
              <div>(Kèm hoá đơn GTGT số: ........ ngày 30/06/2026)</div>
            </div>

            <div className={`debit-editor-preview__intro ${selectedTarget.type === 'company' ? 'is-selected' : ''}`}>
              <p><strong>BÊN A (BÊN THUÊ DỊCH VỤ): VIETSUN</strong></p>
              <p>Địa chỉ: </p>
              <p>Mã số thuế: </p>
              <p>Đại diện bởi : </p>
              <p>Chức vụ: Giám Đốc</p>
              <p>
                <strong>BÊN B (BÊN CUNG CẤP DỊCH VỤ): </strong>
                <span className="debit-editor-preview__inline-field">
                  <input
                    className="debit-editor-canvas-input debit-editor-canvas-input--issuer"
                    aria-label="Tên công ty phát hành"
                    value={form.issuerName ?? ''}
                    placeholder="Tên công ty"
                    onFocus={() => onSelect({ type: 'company', field: 'issuerName' })}
                    onChange={event => onSet('issuerName', event.target.value || null)}
                    disabled={canvasLocked}
                  />
                </span>
              </p>
              <p>
                Địa chỉ:
                <span className="debit-editor-preview__inline-field">
                  <input
                    className="debit-editor-canvas-input"
                    aria-label="Địa chỉ công ty phát hành"
                    value={form.issuerAddress ?? ''}
                    placeholder="Địa chỉ"
                    onFocus={() => onSelect({ type: 'company', field: 'issuerAddress' })}
                    onChange={event => onSet('issuerAddress', event.target.value || null)}
                    disabled={canvasLocked}
                  />
                </span>
              </p>
              <p>
                Mã số thuế:
                <span className="debit-editor-preview__inline-field">
                  <input
                    className="debit-editor-canvas-input"
                    aria-label="Mã số thuế công ty phát hành"
                    value={form.issuerTaxCode ?? ''}
                    placeholder="Mã số thuế"
                    onFocus={() => onSelect({ type: 'company', field: 'issuerTaxCode' })}
                    onChange={event => onSet('issuerTaxCode', event.target.value || null)}
                    disabled={canvasLocked}
                  />
                </span>
              </p>
              <p className={selectedTarget.type === 'company' && selectedTarget.field === 'issuerRepresentative' ? 'is-selected' : undefined}>
                Đại diện bởi : {form.issuerRepresentative || ''}
              </p>
              <p>Chức vụ: Giám Đốc</p>
              <p>{previewTerms[0] ?? '- Số TK '}</p>
              <p>{previewTerms[1] ?? '- Tại ngân hàng '}</p>
              <p>Cùng thống nhất tiến hành đối chiếu sản lượng và doanh thu dịch vụ Bên B đã hoàn thành cung cấp/thực hiện cho Bên A như sau:</p>
            </div>

            <div className="debit-editor-preview__table-wrap">
              <table className="debit-editor-preview__table">
                <thead>
                  <tr>
                    {visible.map(column => {
                      const isSelected = selectedTarget.type === 'column' && selectedTarget.columnId === column.id;
                      return (
                        <th
                          key={column.id}
                          className={isSelected ? 'is-selected' : undefined}
                          style={{
                            width: `${Math.max(column.width || 8, 8) * 12}px`,
                            minWidth: `${Math.max(column.width || 8, 8) * 12}px`,
                          }}
                          onClick={() => {
                            if (!canvasLocked) onSelect({ type: 'column', columnId: column.id });
                          }}
                        >
                          {isSelected ? (
                            <textarea
                              className="debit-editor-canvas-th-input"
                              value={column.label}
                              rows={2}
                              onClick={event => event.stopPropagation()}
                              onFocus={() => onSelect({ type: 'column', columnId: column.id })}
                              onChange={event => onUpdateColumn(column.id, { label: event.target.value })}
                              disabled={canvasLocked}
                            />
                          ) : (
                            <button type="button" disabled={canvasLocked}>
                              <span>{column.label}</span>
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1].map(row => (
                    <tr key={row}>
                      {visible.map((column, index) => (
                        <td key={`${row}-${column.id}`}>
                          {column.variable === 'rowIndex' ? row + 1 : (sampleCell(column) || (index % 2 ? '-' : ''))}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {totalColumns.length > 0 && (
                    <tr>
                      <td colSpan={visible.length} className="debit-editor-preview__total">
                        TỔNG CỘNG {totalColumns.map(column => column.label.replace(/\n/g, ' ')).join(' · ')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="debit-editor-preview__signatures">
              <label className={selectedTarget.type === 'footer' && selectedTarget.field === 'signatureLeftLabel' ? 'is-selected' : undefined}>
                <input
                  className="debit-editor-canvas-input debit-editor-canvas-input--signature"
                  value={form.signatureLeftLabel || ''}
                  placeholder="Người lập biểu"
                  onFocus={() => onSelect({ type: 'footer', field: 'signatureLeftLabel' })}
                  onChange={event => onSet('signatureLeftLabel', event.target.value || null)}
                  disabled={canvasLocked}
                />
                <span>(Ký, họ tên)</span>
                <input
                  className={`debit-editor-canvas-input debit-editor-canvas-input--signature-name ${selectedTarget.type === 'footer' && selectedTarget.field === 'signatureLeftName' ? 'is-selected' : ''}`}
                  value={form.signatureLeftName || ''}
                  placeholder="Tên người ký"
                  onFocus={() => onSelect({ type: 'footer', field: 'signatureLeftName' })}
                  onChange={event => onSet('signatureLeftName', event.target.value || null)}
                  disabled={canvasLocked}
                />
              </label>
              <label className={selectedTarget.type === 'footer' && selectedTarget.field === 'signatureRightLabel' ? 'is-selected' : undefined}>
                <input
                  className="debit-editor-canvas-input debit-editor-canvas-input--signature"
                  value={form.signatureRightLabel || ''}
                  placeholder="Kế toán trưởng"
                  onFocus={() => onSelect({ type: 'footer', field: 'signatureRightLabel' })}
                  onChange={event => onSet('signatureRightLabel', event.target.value || null)}
                  disabled={canvasLocked}
                />
                <span>(Ký, họ tên, đóng dấu)</span>
                <input
                  className={`debit-editor-canvas-input debit-editor-canvas-input--signature-name ${selectedTarget.type === 'footer' && selectedTarget.field === 'signatureRightName' ? 'is-selected' : ''}`}
                  value={form.signatureRightName || ''}
                  placeholder="Tên người ký"
                  onFocus={() => onSelect({ type: 'footer', field: 'signatureRightName' })}
                  onChange={event => onSet('signatureRightName', event.target.value || null)}
                  disabled={canvasLocked}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
