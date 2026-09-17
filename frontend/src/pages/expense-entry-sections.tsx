import { Check, Loader2, Plus, Upload, X } from 'lucide-react';
import { formatDate } from '../lib/format';
import type { ExpenseWithRefs } from '@tingting/shared';
import type { FormState } from './expense-entry-utils';
import { DateInput } from '../design-system/forms/DateInput';
import { UuiSelectField } from '../design-system';
import { Btn } from '../components/UI';
import { useState } from 'react';
import { getAuthenticatedPhotoUrl } from '../lib/api/photo';
import { PhotoViewer } from '../components/PhotoViewer';

interface BasicFieldsProps { form: FormState; errors: Record<string, string>; isEdit: boolean; existingExpense?: ExpenseWithRefs; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void }
export function ExpenseBasicFields({ form, errors, isEdit, existingExpense, set }: BasicFieldsProps) {
  return <>
                  <div className="expense-group">
                    <label htmlFor="expenseDate" className="expense-label">Ngày phát sinh chi phí <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <DateInput
                      name="expenseDate"
                      id="expenseDate"
                      className="expense-input"
                      value={form.expenseDate}
                      onChange={(value) => set('expenseDate', value)}
                    />
                    {errors.expenseDate && <p style={{ fontSize: 'var(--text-body-size)', color: 'var(--danger)', marginTop: 4 }}>{errors.expenseDate}</p>}
                  </div>

                  {/* A4 / A10 — system-stamped entry date, read-only. Distinct from the
                      user-editable "Ngày phát sinh chi phí" above. Auto-recorded on save,
                      so it is unknown (placeholder) until the row exists. */}
                  <div className="expense-group">
                    <span className="expense-label expense-label--static">Ngày nhập dữ liệu</span>
                    <div
                      className="expense-readonly"
                      title="Hệ thống tự ghi ngày nhập, không chỉnh sửa được"
                    >
                      {isEdit && existingExpense?.createdAt
                        ? formatDate(existingExpense.createdAt)
                        : 'Tự động ghi khi lưu'}
                    </div>
                  </div>

                  <div className="expense-group">
                    {/* Payment status is ledger-backed (QA-089): create only
                        offers Ghi nợ — a paid-on-create row would assert a
                        settlement that never posted; edit shows the current
                        ledger-backed state read-only, settled via the NCC
                        payments screen. */}
                    {isEdit ? (
                      <>
                        <label className="expense-label" htmlFor="paymentStatus-ro">Trạng thái thanh toán</label>
                        <div id="paymentStatus-ro" className="expense-readonly">
                          {existingExpense?.paymentStatus === 'PAID' ? 'Đã trả (theo phiếu thanh toán)' : 'Ghi nợ'}
                        </div>
                        <p className="expense-hint">
                          Trạng thái tự cập nhật khi thanh toán NCC được ghi (màn Thanh toán NCC — chọn các khoản chi liên quan khi ghi thanh toán).
                          Thanh toán một phần: chỉ các khoản chi được chọn chuyển Đã trả — phần còn dư giữ nguyên Ghi nợ.
                        </p>
                      </>
                    ) : (
                      <UuiSelectField
                        size="md"
                        id="paymentStatus"
                        label="Trạng thái thanh toán"
                        required
                        value="UNPAID"
                        onChange={() => { /* ledger-backed: stays Ghi nợ until settled */ }}
                        options={[{ value: 'UNPAID', label: 'Ghi nợ' }]}
                        error={errors.paymentStatus}
                        wrapperClassName="expense-group"
                        controlClassName="expense-select"
                      />
                    )}
                  </div>
  </>;
}

interface PhotoAsideProps { photos: { id: number; url: string }[]; uploading: boolean; isEdit: boolean; submitting: boolean; saveDisabled?: boolean; handleBack: () => void; removePhoto: (index: number) => void; handlePhotoUpload: (files: FileList) => void }
export function ExpensePhotoAside({ photos, uploading, isEdit, submitting, saveDisabled, handleBack, removePhoto, handlePhotoUpload }: PhotoAsideProps) {
  // Receipt thumbnails sit behind the JWT: the raw URL 401s in an <img>, so
  // every src goes through the token-append helper (fresh blob: previews
  // pass through unchanged). A failed load gets a retryable hint — retry
  // re-reads the current token and reloads the image, never re-uploads.
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const clearFailure = (id: number) => setFailedIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
  return <>
                <div className="expense-layout__aside">
                  <div className="expense-panel expense-panel--photo">
                    <div className="expense-panel__header">
                      <h3 className="expense-panel__title">Ảnh hóa đơn</h3>
                      <p className="expense-panel__subtitle">Đính kèm biên lai / chứng từ nếu có</p>
                    </div>
                    <div className="expense-panel__body expense-photo-body">
                      {photos.length > 0 && (
                        <div className="expense-photo-grid">
                          {photos.map((p, idx) => (
                            <div key={p.id} className="expense-photo-thumb">
                              {failedIds.has(p.id) ? (
                                <div className="expense-photo-thumb__error" role="alert">
                                  <span>Không tải được ảnh</span>
                                  <button
                                    type="button"
                                    onClick={() => { clearFailure(p.id); setReloadKey((k) => k + 1); }}
                                  >
                                    Thử lại
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="expense-photo-thumb__open"
                                  aria-label={`Xem ảnh hóa đơn ${idx + 1}`}
                                  onClick={() => setViewerIndex(idx)}
                                >
                                  <img
                                    key={`${p.id}-${reloadKey}`}
                                    src={getAuthenticatedPhotoUrl(p.url)}
                                    alt={`Ảnh ${idx + 1}`}
                                    onLoad={() => clearFailure(p.id)}
                                    onError={() => setFailedIds((prev) => new Set(prev).add(p.id))}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  />
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label={`Xóa ảnh hóa đơn ${idx + 1}`}
                                onClick={() => { removePhoto(idx); clearFailure(p.id); }}
                                className="expense-photo-remove"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                        <label className="expense-upload-zone" style={{ pointerEvents: uploading ? 'none' : 'auto', opacity: uploading ? 0.7 : 1 }}>
                          {uploading ? (
                            <><Loader2 size={28} className="spin" style={{ color: 'var(--accent)' }} /> <span style={{ fontSize: 'var(--text-body-size)', marginTop: 8 }}>Đang tải ảnh lên…</span></>
                          ) : (
                            <>
                              <Upload size={28} style={{ color: 'var(--accent)', marginBottom: 6 }} />
                              <span style={{ fontSize: 'var(--text-body-size)', color: 'var(--ink)', fontWeight: 500 }}>Nhấn để tải lên ảnh hóa đơn</span>
                              <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)', fontWeight: 400 }}>JPG, PNG, HEIC · tối đa 15 MB</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only" aria-label="Chọn ảnh hóa đơn"
                            onChange={e => e.target.files && handlePhotoUpload(e.target.files)}
                            disabled={uploading}
                          />
                        </label>
                    </div>
                  </div>

                  <div className="expense-actions">
                    <Btn
                      type="button"
                      variant="secondary"
                      size="md"
                      className="expense-btn-cancel"
                      onClick={handleBack}
                    >
                      Hủy
                    </Btn>
                    <Btn
                      type="submit"
                      variant="primary"
                      size="md"
                      className="expense-btn-submit"
                      disabled={submitting || uploading || saveDisabled}
                      icon={submitting ? <Loader2 size={18} className="spin" /> : isEdit ? <Check size={18} /> : <Plus size={18} />}
                    >
                      {submitting ? 'Đang lưu…' : isEdit ? 'Cập nhật' : 'Lưu chi phí'}
                    </Btn>
                  </div>
                </div>
      {viewerIndex != null && (
        <PhotoViewer
          urls={photos.map((p) => getAuthenticatedPhotoUrl(p.url))}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
  </>;
}

export function ExpenseLoading() {
  return <div className="fade-up" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>
    <Loader2 size={24} className="spin" />
    <p style={{ marginTop: 12 }}>Đang tải…</p>
  </div>;
}
