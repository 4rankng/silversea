import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, Sparkles, AlertTriangle } from 'lucide-react';
import { faqClient } from '../../api/faqClient';
import { qk } from '../../api/keys';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { Modal, useConfirm, PageHeader } from '../../components/UI';
import { resolveEmptyIllustration } from '../../lib/emptyIllustrations';
import type { FaqEntry, FaqEntryCreate } from '@tingting/shared';

/* ─── Page-scoped styles ───
 * Mirrors the PenaltyReasons config page conventions: white cards on a grid,
 * hover-reveal edit/delete actions, badge pills for status, modal form. */
const pageStyles = `
  .faq-page .faq-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 14px;
  }
  .faq-page .faq-card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    padding: 16px 18px;
    box-shadow: var(--sh);
    transition: transform 0.25s var(--ease-spring), box-shadow 0.25s ease, border-color 0.25s ease;
    position: relative;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    animation: faq-stagger 0.45s cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }
  .faq-page .faq-card:hover {
    box-shadow: var(--sh-lg);
    border-color: var(--accent-soft);
    transform: translateY(-2px);
  }
  .faq-page .faq-card.is-inactive { opacity: 0.6; }
  .faq-page .faq-card-top {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  }
  .faq-page .faq-card-title {
    font-family: var(--font-display);
    font-size: 13.5px; font-weight: 700;
    line-height: 1.3; color: var(--ink);
    overflow-wrap: anywhere;
  }
  .faq-page .faq-card-answer {
    margin-top: 8px;
    font-size: 12.5px; line-height: 1.5;
    color: var(--ink-2);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .faq-page .faq-card-badges {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-top: 12px; padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .faq-page .faq-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
  }
  .faq-page .faq-badge.embedded { background: var(--success-soft, #dcfce7); color: #15803d; }
  .faq-page .faq-badge.no-embed { background: #fef3c7; color: #b45309; }
  .faq-page .faq-badge.inactive { background: var(--surface-3); color: var(--ink-3); }
  .faq-page .faq-badge.terms { background: var(--surface-3); color: var(--ink-3); }

  .faq-page .faq-card-actions {
    position: absolute; top: 100%; right: 0; margin-top: 8px; z-index: 2;
    display: flex; gap: 4px;
    opacity: 0; transform: translateY(-4px);
    transition: 0.16s ease;
  }
  .faq-page .faq-card:hover .faq-card-actions { opacity: 1; transform: none; }
  .faq-page .faq-act {
    width: 30px; height: 30px; border-radius: 8px;
    border: 1px solid var(--line); background: #fff;
    display: grid; place-items: center;
    cursor: pointer; color: var(--ink-3);
    transition: 0.14s ease;
  }
  .faq-page .faq-act svg { width: 14px; height: 14px; }
  .faq-page .faq-act:hover { background: var(--surface-3); color: var(--ink); }
  .faq-page .faq-act.del:hover { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-soft); }

  @keyframes faq-stagger {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ── Form inputs ── */
  .faq-page .faq-input,
  .faq-page .faq-textarea {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 10px 12px;
    font-size: 13.5px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    outline: none;
    background: #fff;
    font-family: inherit;
  }
  .faq-page .faq-textarea { resize: vertical; min-height: 96px; line-height: 1.5; }
  .faq-page .faq-input:focus,
  .faq-page .faq-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

  /* ── Tag array editor (variants / required / forbidden terms) ── */
  .faq-page .tag-input {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 8px; min-height: 42px;
    border: 1px solid var(--line); border-radius: var(--r);
    background: #fff;
  }
  .faq-page .tag-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .faq-page .tag-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 999px;
    font-size: 12px; font-weight: 500;
    background: var(--surface-3); color: var(--ink);
  }
  .faq-page .tag-chip button {
    border: none; background: none; cursor: pointer;
    color: var(--ink-3); padding: 0; line-height: 1;
    font-size: 14px;
  }
  .faq-page .tag-chip button:hover { color: var(--danger); }
  .faq-page .tag-input input {
    border: none; outline: none; background: transparent;
    font-size: 13px; font-family: inherit;
    flex: 1; min-width: 120px; padding: 3px 0;
  }

  .faq-page .faq-loading {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 80px 20px;
    color: var(--ink-3); gap: 14px; font-size: 13px;
  }
  .faq-page .faq-spinner {
    width: 28px; height: 28px;
    border: 3px solid var(--line); border-top-color: var(--accent);
    border-radius: 50%; animation: faq-spin 0.8s linear infinite;
  }
  @keyframes faq-spin { to { transform: rotate(360deg); } }

  .faq-page .faq-embed-warning {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; margin-bottom: 14px;
    border-radius: var(--r);
    background: #fef3c7; color: #92400e;
    font-size: 12.5px; font-weight: 500;
    border: 1px solid #fcd34d;
  }

  @media (max-width: 560px) {
    .faq-page .faq-grid { grid-template-columns: 1fr; }
  }
`;

/* ─── Tag array editor ───
 * Reusable chip-style input for string[] fields (variants, required terms,
 * forbidden terms). Enter or comma commits a tag; backspace on empty removes
 * the last one. */
function TagArrayInput({
  values, onChange, placeholder, tone,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Visual hint: tone-stripped fields show a subtle marker. */
  tone?: 'diacritic' | 'stripped';
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };

  return (
    <div className="tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {values.map((v, i) => (
        <span key={`${v}-${i}`} className="tag-chip">
          {v}
          <button type="button" aria-label={`Xóa ${v}`} onClick={() => onChange(values.filter((_, idx) => idx !== i))}>×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder ?? 'Nhập rồi nhấn Enter…'}
        style={tone === 'stripped' ? { fontFamily: 'var(--font-mono)' } : undefined}
      />
    </div>
  );
}

/* ─── FAQ entry form (create/edit) ─── */
function FaqEntryForm({
  saving, item, onSave, onCancel,
}: {
  saving: boolean;
  item?: FaqEntry;
  onSave: (data: FaqEntryCreate) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(item?.question ?? '');
  const [answer, setAnswer] = useState(item?.answer ?? '');
  const [variants, setVariants] = useState<string[]>(item?.questionVariants ?? []);
  const [requiredTerms, setRequiredTerms] = useState<string[]>(item?.requiredTerms ?? []);
  const [forbiddenTerms, setForbiddenTerms] = useState<string[]>(item?.forbiddenTerms ?? []);
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 0);

  const canSave = question.trim().length > 0 && answer.trim().length > 0 && !saving;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '6px 4px' }}>
      <div>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
          Câu hỏi <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          className="faq-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="VD: Thiếu hóa đơn dầu bị phạt bao nhiêu?"
          autoFocus
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
          Câu trả lời <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <textarea
          className="faq-textarea"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Câu trả lời chi tiết sẽ hiển thị khi trợ lý ảo khớp câu hỏi này…"
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
          Biến thể câu hỏi
        </label>
        <TagArrayInput values={variants} onChange={setVariants} placeholder="Các cách diễn đạt khác của cùng câu hỏi…" />
        <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
          Các câu hỏi tương đương giúp khớp chính xác (giữ dấu tiếng Việt).
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
            Từ khóa bắt buộc
          </label>
          <TagArrayInput values={requiredTerms} onChange={setRequiredTerms} tone="stripped" placeholder="phat, dau,…" />
          <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            Tất cả phải xuất hiện. Hệ thống tự bỏ dấu khi lưu.
          </p>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
            Từ khóa cấm
          </label>
          <TagArrayInput values={forbiddenTerms} onChange={setForbiddenTerms} tone="stripped" placeholder="duong,…" />
          <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            Có bất kỳ từ nào → loại câu này. Tự bỏ dấu khi lưu.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Đang hoạt động
        </label>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          Thứ tự
          <input
            type="number"
            className="faq-input"
            style={{ width: 80 }}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>Hủy</button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onSave({
            question: question.trim(),
            answer: answer.trim(),
            questionVariants: variants,
            requiredTerms,
            forbiddenTerms,
            isActive,
            sortOrder,
          })}
          disabled={!canSave}
        >
          {saving ? (item ? 'Đang lưu & tạo embedding…' : 'Đang tạo & tạo embedding…') : (item ? 'Lưu thay đổi' : 'Thêm mới')}
        </button>
      </div>
    </div>
  );
}

/* ─── Page ─── */
export default function FaqEntriesConfigPage() {
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [embedWarning, setEmbedWarning] = useState<string | null>(null);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.faq.all });
  }, [queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: qk.faq.list(searchTerm, showInactive),
    queryFn: () => faqClient.list({
      search: searchTerm.trim() || undefined,
      includeInactive: showInactive,
    }),
  });

  const createMut = useMutation({
    mutationFn: (input: FaqEntryCreate) => faqClient.create(input),
    onSuccess: async (resp) => {
      await invalidate();
      setShowAddForm(false);
      if (resp.embeddingStatus === 'failed') {
        setEmbedWarning('Đã lưu câu hỏi nhưng tạo embedding thất bại — kiểm tra API key OpenRouter ở mục "Cài đặt ứng dụng".');
      } else {
        setEmbedWarning(null);
      }
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: number; input: FaqEntryCreate }) => faqClient.update(id, input),
    onSuccess: async (resp) => {
      await invalidate();
      setEditingId(null);
      if (resp.embeddingStatus === 'failed') {
        setEmbedWarning('Đã lưu nhưng tạo embedding thất bại — kiểm tra API key OpenRouter ở mục "Cài đặt ứng dụng".');
      } else {
        setEmbedWarning(null);
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => faqClient.remove(id),
    onSuccess: () => invalidate(),
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const editingItem = useMemo(() => items.find((x) => x.id === editingId), [items, editingId]);

  const saving = createMut.isPending || updateMut.isPending;

  const handleDelete = async (id: number) => {
    const ok = await confirm('Bạn có chắc chắn muốn xóa câu hỏi này? Hành động không thể hoàn tác.', {
      variant: 'danger',
      confirmLabel: 'Xóa',
    });
    if (ok) await deleteMut.mutateAsync(id);
  };

  return (
    <div className="faq-page fade-up cfg-page cfg-page--faq-entries" style={{ minHeight: '100%' }}>
      <style>{pageStyles}</style>

      <PageHeader
        title="Câu hỏi thường gặp (FAQ)"
        description="Quản lý cơ sở tri thức cho trợ lý ảo. Mỗi lần lưu, hệ thống tự động tạo lại embedding để trợ lý trả lời câu hỏi ngay lập tức."
        onBack={handleBack}
        iconName="faq"
        action={
          <button className="btn btn--primary" onClick={() => setShowAddForm(true)}>
            <Plus size={16} /> Thêm câu hỏi
          </button>
        }
      />

      {embedWarning && (
        <div className="faq-embed-warning">
          <AlertTriangle size={16} />
          <span>{embedWarning}</span>
          <button onClick={() => setEmbedWarning(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="filter-bar">
        <div className="filter-bar__search">
          <Search size={15} />
          <input
            name="faqSearch"
            aria-label="Tìm câu hỏi thường gặp"
            placeholder="Tìm câu hỏi…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          Hiện đã tắt
        </label>
        <div className="filter-bar__spacer" />
        {items.length > 0 && (
          <span className="cfg-page__summary"><strong>{items.length}</strong> mục</span>
        )}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="faq-loading">
          <div className="faq-spinner" />
          <div>Đang tải dữ liệu...</div>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <img
            src={resolveEmptyIllustration('empty-config')}
            alt=""
            aria-hidden="true"
            style={{ width: 160, height: 132, objectFit: 'contain' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <p className="empty-state-title">Chưa có câu hỏi FAQ</p>
          <p className="empty-state-desc">Thêm câu hỏi đầu tiên để trợ lý ảo trả lời nhanh không cần LLM.</p>
        </div>
      ) : (
        <div className="faq-grid">
          {items.map((entry, i) => (
            <div
              key={entry.id}
              className={`faq-card${entry.isActive ? '' : ' is-inactive'}`}
              style={{ animationDelay: `${i * 0.03}s` }}
              onClick={() => setEditingId(entry.id)}
              title="Nhấp để chỉnh sửa"
            >
              <div className="faq-card-top">
                <div className="faq-card-title">{entry.question}</div>
                <div style={{ position: 'relative' }}>
                  <div className="faq-card-actions" onClick={(e) => e.stopPropagation()}>
                    <div className="faq-act" title="Chỉnh sửa" onClick={() => setEditingId(entry.id)}>
                      <Pencil size={14} />
                    </div>
                    <div className="faq-act del" title="Xóa" onClick={() => handleDelete(entry.id)}>
                      <Trash2 size={14} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="faq-card-answer">{entry.answer}</div>

              <div className="faq-card-badges">
                {entry.isActive ? (
                  <span className="faq-badge embedded"><Sparkles size={11} /> Đang hoạt động</span>
                ) : (
                  <span className="faq-badge inactive">Đã tắt</span>
                )}
                {entry.hasEmbedding ? (
                  <span className="faq-badge embedded"><Sparkles size={11} /> Đã tạo embedding</span>
                ) : (
                  <span className="faq-badge no-embed"><AlertTriangle size={11} /> Chưa tạo embedding</span>
                )}
                {entry.requiredTerms.length > 0 && (
                  <span className="faq-badge terms">{entry.requiredTerms.length} từ bắt buộc</span>
                )}
                {entry.forbiddenTerms.length > 0 && (
                  <span className="faq-badge terms">{entry.forbiddenTerms.length} từ cấm</span>
                )}
                {entry.questionVariants.length > 0 && (
                  <span className="faq-badge terms">{entry.questionVariants.length} biến thể</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add modal ── */}
      <Modal isOpen={showAddForm} title="Thêm câu hỏi FAQ" onClose={() => setShowAddForm(false)} maxWidth={620}>
        <FaqEntryForm
          saving={saving}
          onSave={(data) => createMut.mutate(data)}
          onCancel={() => setShowAddForm(false)}
        />
      </Modal>

      {/* ── Edit modal ── */}
      {editingItem && (
        <Modal isOpen={true} title="Chỉnh sửa câu hỏi FAQ" onClose={() => setEditingId(null)} maxWidth={620}>
          <FaqEntryForm
            item={editingItem}
            saving={saving}
            onSave={(data) => updateMut.mutate({ id: editingItem.id, input: data })}
            onCancel={() => setEditingId(null)}
          />
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger-soft)' }}
              disabled={deleteMut.isPending}
              onClick={async () => { await handleDelete(editingItem.id); setEditingId(null); }}
            >
              {deleteMut.isPending ? 'Đang xóa...' : 'Xóa câu hỏi này'}
            </button>
          </div>
        </Modal>
      )}

      {dialog}
    </div>
  );
}
