import { Check, Loader2, Plus, Upload, X } from 'lucide-react';
import { formatDate } from '../lib/format';
import type { ExpenseWithRefs } from '@tingting/shared';
import type { FormState } from './expense-entry-utils';

interface BasicFieldsProps { form: FormState; errors: Record<string, string>; isEdit: boolean; existingExpense?: ExpenseWithRefs; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void }
export function ExpenseBasicFields({ form, errors, isEdit, existingExpense, set }: BasicFieldsProps) {
  return <>
                  <div className="expense-group">
                    <label htmlFor="expenseDate" className="expense-label">Ngày phát sinh chi phí <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input
                      type="date"
                      name="expenseDate"
                      id="expenseDate"
                      className="expense-input"
                      value={form.expenseDate}
                      onChange={e => set('expenseDate', e.target.value)}
                    />
                    {errors.expenseDate && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{errors.expenseDate}</p>}
                  </div>

                  {/* A4 / A10 — system-stamped entry date, read-only. Distinct from the
                      user-editable "Ngày phát sinh chi phí" above. Auto-recorded on save,
                      so it is unknown (placeholder) until the row exists. */}
                  <div className="expense-group">
                    <span className="expense-label">Ngày nhập dữ liệu</span>
                    <div
                      className="expense-input"
                      style={{ color: 'var(--ink-3)', background: 'rgba(0,0,0,0.03)', cursor: 'default', display: 'flex', alignItems: 'center' }}
                      title="Hệ thống tự ghi ngày nhập, không chỉnh sửa được"
                    >
                      {isEdit && existingExpense?.createdAt
                        ? formatDate(existingExpense.createdAt)
                        : 'Tự động ghi khi lưu'}
                    </div>
                  </div>

                  <div className="expense-group">
                    <label htmlFor="paymentStatus" className="expense-label">Trạng thái thanh toán <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <select
                      name="paymentStatus"
                      id="paymentStatus"
                      className="expense-input"
                      value={form.paymentStatus}
                      onChange={e => set('paymentStatus', e.target.value as 'PAID' | 'UNPAID')}
                    >
                      <option value="UNPAID">Ghi nợ</option>
                      <option value="PAID">Trả ngay</option>
                    </select>
                    {errors.paymentStatus && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{errors.paymentStatus}</p>}
                  </div>
  </>;
}

interface PhotoAsideProps { photos: { id: number; url: string }[]; uploading: boolean; isEdit: boolean; submitting: boolean; handleBack: () => void; removePhoto: (index: number) => void; handlePhotoUpload: (files: FileList) => void }
export function ExpensePhotoAside({ photos, uploading, isEdit, submitting, handleBack, removePhoto, handlePhotoUpload }: PhotoAsideProps) {
  return <>
                <div className="expense-layout__aside">
                  <div className="expense-panel expense-panel--photo">
                    <div className="expense-panel__header">
                      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Ảnh hóa đơn</h3>
                      <p style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 4 }}>Đính kèm biên lai / chứng từ nếu có</p>
                    </div>
                    <div className="expense-panel__body expense-photo-body">
                      {photos.length > 0 && (
                        <div className="expense-photo-grid">
                          {photos.map((p, idx) => (
                            <div key={p.id} className="expense-photo-thumb">
                              <img src={p.url} alt={`Ảnh ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <button
                                type="button"
                                aria-label={`Xóa ảnh hóa đơn ${idx + 1}`}
                                onClick={() => removePhoto(idx)}
                                className="expense-photo-remove"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {isEdit ? (
                        <label className="expense-upload-zone" style={{ pointerEvents: uploading ? 'none' : 'auto', opacity: uploading ? 0.7 : 1 }}>
                          {uploading ? (
                            <><Loader2 size={28} className="spin" style={{ color: 'var(--accent)' }} /> <span style={{ fontSize: 14, marginTop: 8 }}>Đang tải ảnh lên…</span></>
                          ) : (
                            <>
                              <Upload size={28} style={{ color: 'var(--accent)', marginBottom: 6 }} />
                              <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>Nhấn để tải lên ảnh hóa đơn</span>
                              <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>JPG, PNG · tối đa 5MB</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={e => e.target.files && handlePhotoUpload(e.target.files)}
                            disabled={uploading}
                          />
                        </label>
                      ) : (
                        <div className="expense-upload-zone" style={{ cursor: 'default', opacity: 0.7 }}>
                          <Upload size={28} style={{ color: 'var(--ink-3)', marginBottom: 6 }} />
                          <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>Gửi duyệt trước khi đính kèm ảnh hóa đơn</span>
                          <span style={{ fontSize: 12, color: 'var(--ink-4)', fontWeight: 400 }}>Ảnh được thêm sau khi khoản chi được phê duyệt</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="expense-actions">
                    <button
                      type="button"
                      className="btn btn--secondary expense-btn-cancel"
                      onClick={handleBack}
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="btn btn--primary expense-btn-submit"
                      disabled={submitting || uploading}
                    >
                      {submitting ? (
                        <><Loader2 size={18} className="spin" /> Đang lưu…</>
                      ) : isEdit ? (
                        <><Check size={18} /> Cập nhật</>
                      ) : (
                        <><Plus size={18} /> Gửi duyệt chi phí</>
                      )}
                    </button>
                  </div>
                </div>
  </>;
}

export function ExpenseLoading() {
  return <div className="fade-up" style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>
    <Loader2 size={24} className="spin" />
    <p style={{ marginTop: 12 }}>Đang tải…</p>
  </div>;
}
