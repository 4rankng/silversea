import { AlertCircle, ArrowLeft, Camera, DollarSign, Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { FORWARDER_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import { FormGroup } from '../components/UI';
import { formatCurrency } from '../lib/format';
import type { useForwarderTripDetail } from '../hooks/useQueries';

export interface ForwarderContainer {
  id: number;
  containerTypeId?: number | null;
  containerTypeName?: string | null;
  containerNumber?: string;
  sealNumber?: string | null;
  notes?: string | null;
}

export const FORWARDER_LCL_SCOPE_LABEL = 'Lô hàng lẻ';
export const SYNTHETIC_LCL_CONTAINER_NOTE_PREFIX = '__fulfillment_lcl:';

export function isSyntheticLclContainer(container: Pick<ForwarderContainer, 'containerNumber' | 'notes'>): boolean {
  const containerNumber = container.containerNumber?.trim() ?? '';
  const notes = container.notes?.trim() ?? '';
  return containerNumber.length === 0 && notes.startsWith(SYNTHETIC_LCL_CONTAINER_NOTE_PREFIX);
}

export function getForwarderContainerDisplayLabel(container: Pick<ForwarderContainer, 'containerNumber' | 'notes'>): string {
  const containerNumber = container.containerNumber?.trim();
  if (containerNumber) return containerNumber;
  if (isSyntheticLclContainer(container)) return FORWARDER_LCL_SCOPE_LABEL;
  return 'Container chưa có số';
}

export function getForwarderContainerScopeLabel(container: Pick<ForwarderContainer, 'containerNumber' | 'notes'>): string {
  if (isSyntheticLclContainer(container)) return FORWARDER_LCL_SCOPE_LABEL;
  const containerNumber = container.containerNumber?.trim();
  return containerNumber ? `Container ${containerNumber}` : 'Container chưa có số';
}

export function ForwarderTripLoading() {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>
    <Loader2 size={24} className="spin" style={{ display: 'inline-block' }} /><p style={{ marginTop: 12 }}>Đang tải…</p>
  </div>;
}

export function ForwarderTripError({ queryError, onBack }: { queryError: boolean; onBack: () => void }) {
  return <div style={{ padding: 24 }}><button className="btn btn--ghost" onClick={onBack} style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
    <ArrowLeft size={16} /> Quay lại</button><div style={{ textAlign: 'center', padding: 40, color: 'var(--danger)' }}>
      <AlertCircle size={32} style={{ marginBottom: 12 }} /><p>{queryError ? 'Không thể tải thông tin chuyến đi' : 'Không tìm thấy chuyến đi'}</p>
    </div></div>;
}
type ContainerForm = { containerNumber: string; sealNumber: string; notes: string };
interface ContainerSectionProps { containers: ForwarderContainer[]; show: boolean; setShow: (show: boolean) => void; form: ContainerForm; setForm: React.Dispatch<React.SetStateAction<ContainerForm>>; onAdd: () => void; pending: boolean; selectedContainerId: string; onSelectContainer: (id: string) => void }
export function ForwarderContainersSection({ containers, show: showContainerForm, setShow: setShowContainerForm, form: containerForm, setForm: setContainerForm, onAdd: handleAddContainer, pending, selectedContainerId, onSelectContainer }: ContainerSectionProps) {
 const visibleContainers = containers.filter((container) => !isSyntheticLclContainer(container));
 const hasSyntheticLclScope = containers.some(isSyntheticLclContainer);
 if (hasSyntheticLclScope && visibleContainers.length === 0) return null;
 return <>
        <div className="panel panel--solid" style={{ marginBottom: 16 }}>
          <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Số Container / Seal ({visibleContainers.length})
            </span>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setShowContainerForm(!showContainerForm)}
              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={12} /> Thêm
            </button>
          </div>

          {showContainerForm && (
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-2)' }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <FormGroup label="Số container *" style={{ flex: 1, minWidth: 140 }}>
                  <input
                    className="input"
                    value={containerForm.containerNumber}
                    onChange={e => setContainerForm(f => ({ ...f, containerNumber: e.target.value }))}
                    placeholder="MSKU 123456 7"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </FormGroup>
                <FormGroup label="Số seal" style={{ flex: 1, minWidth: 120 }}>
                  <input
                    className="input"
                    value={containerForm.sealNumber}
                    onChange={e => setContainerForm(f => ({ ...f, sealNumber: e.target.value }))}
                    placeholder="SEAL-001"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </FormGroup>
                <FormGroup label="Ghi chú" style={{ flex: 2, minWidth: 140 }}>
                  <input
                    className="input"
                    value={containerForm.notes}
                    onChange={e => setContainerForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Ghi chú (tuỳ chọn)"
                  />
                </FormGroup>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={handleAddContainer}
                  disabled={pending || !containerForm.containerNumber.trim()}
                >
                  {pending ? 'Đang lưu…' : 'Lưu'}
                </button>
              </div>
            </div>
          )}

          {visibleContainers.length === 0 ? (
            <div style={{ padding: '16px 20px', color: 'var(--fg-3)', fontSize: 13, textAlign: 'center' }}>
              Chưa có số container/seal nào
            </div>
          ) : (
            <div style={{ padding: '4px 0' }}>
              {visibleContainers.map((c) => {
                const isActive = selectedContainerId === String(c.id);
                return (
                <button
                  type="button"
                  key={c.id}
                  className={isActive ? 'fwd-cont-row fwd-cont-row--active' : 'fwd-cont-row'}
                  aria-pressed={isActive}
                  aria-label={`Chọn ${getForwarderContainerScopeLabel(c)} cho chi phí`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 20px', borderBottom: '1px solid var(--border-1)',
                    cursor: 'pointer',
                    width: '100%', minHeight: 44, borderTop: 0, borderLeft: 0, borderRight: 0,
                    appearance: 'none', borderRadius: 0,
                    color: 'inherit', font: 'inherit', textAlign: 'left',
                    background: isActive ? 'var(--brand-subtle, rgba(0,177,79,0.08))' : 'transparent',
                    boxShadow: isActive ? 'inset 3px 0 0 var(--brand)' : undefined,
                  }}
                  onClick={() => onSelectContainer(String(c.id))}
                  title="Chọn container này cho chi phí"
                >
                  <Package size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{getForwarderContainerDisplayLabel(c)}</span>
                    {c.sealNumber && (
                      <span style={{ color: 'var(--fg-3)', fontSize: 12, marginLeft: 12 }}>
                        Seal: <span style={{ fontFamily: 'var(--font-mono)' }}>{c.sealNumber}</span>
                      </span>
                    )}
                  </div>
                  {c.notes && (
                    <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{c.notes}</span>
                  )}
                </button>
                );
              })}
            </div>
          )}
        </div>
 </>;
}

type TripData = NonNullable<ReturnType<typeof useForwarderTripDetail>['data']>;
type Expense = TripData['expenses'][number];
interface ExpenseRowProps { exp: Expense; expenseTypeOptions: Array<{ code: string; name: string }>; uploadingExpenseId: number | null; photos?: string[]; onUpload: (expenseId: number, file: File) => void; onEdit: (expense: Expense) => void; onDelete: (expenseId: number) => void; deletePending: boolean; onLoadPhotos: (expenseId: number) => void }
export function ForwarderExpenseRow({ exp, expenseTypeOptions: forwarderExpenseTypeOptions, uploadingExpenseId, photos, onUpload: handleUploadPhoto, onEdit: openExpenseEditor, onDelete: handleDeleteExpense, deletePending, onLoadPhotos: loadExpensePhotos }: ExpenseRowProps) {
 const expensePhotos: Record<number, string[]> = photos ? { [exp.id]: photos } : {};
 const deleteExpenseMut = { isPending: deletePending };
 return <>
                <div key={exp.id} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <DollarSign size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {FORWARDER_EXPENSE_TYPE_DEFAULTS[exp.expenseType]?.name || forwarderExpenseTypeOptions.find(t => t.code === exp.expenseType)?.name || exp.expenseType}
                      </span>
                      {exp.activeSettlementId && (
                        <span style={{
                          fontSize: 12, lineHeight: 1.35, fontWeight: 600,
                          color: '#92400e', background: '#fef3c7',
                          borderRadius: 4, padding: '3px 7px', marginLeft: 6,
                        }}>Đã gửi kế toán</span>
                      )}
                      {exp.note && (
                        <span style={{ color: 'var(--fg-3)', fontSize: 12, marginLeft: 8 }}>{exp.note}</span>
                      )}
                      {exp.returnForEvidenceReason && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '6px 8px', maxWidth: 420 }}>
                          Cần bổ sung: {exp.returnForEvidenceReason}
                        </div>
                      )}
                      {(exp.expenseDate || exp.payeeName) && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--fg-3)' }}>
                          {exp.expenseDate && <span>Ngày chi {exp.expenseDate}</span>}
                          {exp.payeeName && <span>Người nhận {exp.payeeName}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(exp.buyAmount)}
                      </div>
                      {exp.settlementMethod === 'COMPANY_DIRECT' && (
                        <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)' }}>Công ty trả</div>
                      )}
                    </div>
                    {/* Photo upload button */}
                    <label
                      className="icon-btn"
                      title="Thêm ảnh chứng từ"
                      style={{ color: 'var(--fg-3)', opacity: 0.7, padding: 4, cursor: 'pointer' }}
                    >
                      {uploadingExpenseId === exp.id
                        ? <Loader2 size={14} className="spin" />
                        : <Camera size={14} />
                      }
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadPhoto(exp.id, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      className="icon-btn fwd-expense-action"
                      onClick={() => openExpenseEditor(exp)}
                      disabled={Boolean(exp.activeSettlementId) || !exp.canEdit}
                      aria-label={`Điều chỉnh ${FORWARDER_EXPENSE_TYPE_DEFAULTS[exp.expenseType]?.name || exp.expenseType}`}
                      title={exp.activeSettlementId ? 'Khoản chi đã gửi kế toán' : !exp.canEdit ? 'Khoản chi do Ops khác kê' : 'Điều chỉnh chi phí'}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-btn fwd-expense-action"
                      onClick={() => handleDeleteExpense(exp.id)}
                      disabled={deleteExpenseMut.isPending || Boolean(exp.activeSettlementId) || !exp.canEdit}
                      title="Xóa chi phí"
                      style={{ color: 'var(--danger)', opacity: 0.6, padding: 4 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {/* Photo thumbnails */}
                  {expensePhotos[exp.id] && expensePhotos[exp.id].length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingLeft: 26 }}>
                      {expensePhotos[exp.id].map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={url}
                            alt={`Hóa đơn ${i + 1}`}
                            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-1)' }}
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  {/* Load photos on first render */}
                  {!expensePhotos[exp.id] && (
                    <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', paddingLeft: 26, marginTop: 4, display: 'inline-block', cursor: 'pointer' }} onClick={() => loadExpensePhotos(exp.id)}>
                      Xem ảnh chứng từ
                    </span>
                  )}
                </div>
 </>;
}
