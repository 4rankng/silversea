import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, PenLine, Save, Star, Trash2 } from 'lucide-react';
import { AssetIcon } from '../../components/AssetIcon';
import { useConfirm } from '../../components/UI';
import { useToast } from '../../components/shared/Toast';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { isGovernancePendingResponse } from '../../lib/governance';
import { type DebitNoteTemplate, type DebitNoteTemplateColumn, type DebitNoteTemplateInput } from '@tingting/shared';
import { blankTemplate, buildAccountTerms, cloneStarterColumns, EDITOR_SECTIONS, getAccountTerms, normalizeTemplateColumns, sectionFromTarget, templateDefaultsForType, toForm, type EditorSection, type SelectedTarget } from './debit-note-template-editor-utils';
import { Field, TemplatePreview } from './debit-note-template-preview';
import { ColumnPropertyPanel, ColumnTable } from './debit-note-template-columns';
import './config-page.css';
import './debit-note-template-editor.css';
export default function DebitNoteTemplateEditorPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const id = params.id === 'new' || !params.id ? null : Number(params.id);
  const isNew = id == null;
  const viewOnly = !isNew && searchParams.get('mode') === 'view';
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<DebitNoteTemplateInput>(() => blankTemplate());
  const [activeSection, setActiveSection] = useState<EditorSection>('columns');
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>(() => ({ type: 'column', columnId: cloneStarterColumns()[0]?.id ?? '' }));

  const backToList = () => navigate('/config/debit-note-templates');
  useBackShortcut(backToList);

  const { data: template, isLoading } = useQuery<DebitNoteTemplate>({
    queryKey: qk.catalogs.debitNoteTemplate(id),
    queryFn: () => configClient.getDebitNoteTemplate(id as number),
    enabled: !isNew,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (template) setForm(toForm(template));
  }, [template]);

  const visibleColumns = useMemo(() => (form.columns ?? []).filter(column => column.width > 0), [form.columns]);
  const hasGroupedHeaders = useMemo(() => (form.columns ?? []).some(column => column.headerGroup), [form.columns]);
  const selectedColumn = useMemo(() => (
    selectedTarget.type === 'column'
      ? (form.columns ?? []).find(column => column.id === selectedTarget.columnId) ?? null
      : null
  ), [form.columns, selectedTarget]);
  const set = <K extends keyof DebitNoteTemplateInput>(key: K, value: DebitNoteTemplateInput[K]) => {
    setForm(previous => ({ ...previous, [key]: value }));
  };
  const setDocumentType = (documentType: DebitNoteTemplateInput['documentType']) => {
    const defaults = templateDefaultsForType(documentType);
    setForm(previous => ({
      ...previous,
      documentType,
      titleText: defaults.titleText,
      name: previous.name === 'Mẫu giấy báo nợ mới' || previous.name === 'Mẫu bảng kê mới'
        ? (documentType === 'PAYMENT_STATEMENT' ? 'Mẫu bảng kê mới' : 'Mẫu giấy báo nợ mới')
        : previous.name,
      orientation: defaults.orientation,
      termsText: defaults.termsText,
      signatureRightLabel: defaults.signatureRightLabel,
      signatureRightName: defaults.signatureRightName,
      columns: defaults.columns,
    }));
  };
  const selectTarget = (target: SelectedTarget) => {
    setSelectedTarget(target);
    setActiveSection(sectionFromTarget(target));
  };
  const selectSection = (section: EditorSection) => {
    setActiveSection(section);
    if (section === 'columns') {
      setSelectedTarget({ type: 'column', columnId: (form.columns ?? [])[0]?.id ?? '' });
    } else if (section === 'general') {
      setSelectedTarget({ type: 'general', field: 'titleText' });
    } else if (section === 'company') {
      setSelectedTarget({ type: 'company', field: 'issuerName' });
    } else {
      setSelectedTarget({ type: 'footer', field: 'signatureLeftLabel' });
    }
  };
  const updateColumn = (columnId: string, patch: Partial<DebitNoteTemplateColumn>) => {
    setForm(previous => ({
      ...previous,
      columns: (previous.columns ?? []).map(column => column.id === columnId ? { ...column, ...patch } : column),
    }));
  };
  const accountTerms = getAccountTerms(form.termsText);
  const setAccountNumber = (accountNumber: string) => {
    set('termsText', buildAccountTerms(accountNumber, accountTerms.bankName));
  };
  const setBankName = (bankName: string) => {
    set('termsText', buildAccountTerms(accountTerms.accountNumber, bankName));
  };
  useEffect(() => {
    if (selectedTarget.type !== 'column') return;
    const columns = form.columns ?? [];
    if (columns.length > 0 && !columns.some(column => column.id === selectedTarget.columnId)) {
      setSelectedTarget({ type: 'column', columnId: columns[0].id });
    }
  }, [form.columns, selectedTarget]);

  const validate = () => {
    if (!form.name.trim()) return 'Chưa nhập tên mẫu.';
    if (!form.titleText.trim()) return 'Chưa nhập tiêu đề.';
    if (!form.columns?.length) return 'Mẫu phải có ít nhất một cột.';
    return null;
  };

  const governancePendingSaveMessage = isNew
    ? 'Đã gửi yêu cầu tạo mẫu giấy báo nợ để kiểm tra và phê duyệt. Mẫu chưa được áp dụng.'
    : 'Đã gửi yêu cầu cập nhật mẫu giấy báo nợ để kiểm tra và phê duyệt. Mẫu hiện chưa thay đổi.';

  const save = async () => {
    const error = validate();
    if (error) {
      toast({ kind: 'error', message: error });
      return;
    }

    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), titleText: form.titleText.trim() };
      const saved = isNew
        ? await configClient.saveDebitNoteTemplate(payload)
        : await configClient.updateDebitNoteTemplate(id as number, payload);
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.debitNoteTemplates });
      if (isGovernancePendingResponse(saved)) {
        toast({ kind: 'success', message: governancePendingSaveMessage });
        backToList();
        return;
      }
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.debitNoteTemplate(saved.id) });
      toast({ kind: 'success', message: 'Đã lưu mẫu giấy báo nợ.' });
      backToList();
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message || 'Không lưu được mẫu.' });
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async () => {
    if (isNew || !id) return;
    const ok = await confirm(`Xoá mẫu "${form.name}"? Các giấy báo nợ đã lưu vẫn giữ ảnh chụp mẫu cũ.`, { variant: 'danger' });
    if (!ok) return;
    setSaving(true);
    try {
      const result = await configClient.deleteDebitNoteTemplate(id);
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.debitNoteTemplates });
      if (isGovernancePendingResponse(result)) {
        toast({ kind: 'success', message: 'Đã gửi yêu cầu xoá mẫu giấy báo nợ để kiểm tra và phê duyệt. Mẫu hiện chưa bị xoá.' });
        backToList();
        return;
      }
      toast({ kind: 'success', message: 'Đã xoá mẫu.' });
      backToList();
    } catch (err) {
      toast({ kind: 'error', message: (err as Error).message || 'Không xoá được mẫu.' });
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || isLoading;
  const controlsDisabled = busy || viewOnly;
  const activeSectionLabel = selectedTarget.type === 'column'
    ? 'Cột đang chọn'
    : EDITOR_SECTIONS.find(section => section.id === activeSection)?.label ?? 'Chung';
  const renderInspector = () => {
    if (selectedTarget.type === 'column' && selectedColumn) {
      return (
        <ColumnPropertyPanel
          column={selectedColumn}
          columns={form.columns ?? []}
          disabled={controlsDisabled}
          onChange={patch => updateColumn(selectedColumn.id, patch)}
          onSelectColumn={columnId => selectTarget({ type: 'column', columnId })}
          onToggleColumnVisibility={item => updateColumn(item.id, { width: item.width > 0 ? 0 : 14 })}
        />
      );
    }

    if (activeSection === 'general') {
      return (
        <section className="debit-editor-settings">
          <Field label="Loại tài liệu">
            <select className="input debit-editor-inline-select debit-editor-settings-select" value={form.documentType} onChange={event => setDocumentType(event.target.value as DebitNoteTemplateInput['documentType'])} disabled={controlsDisabled || !!id}>
              <option value="DEBIT_NOTE">Giấy báo nợ</option>
              <option value="PAYMENT_STATEMENT">Bảng kê</option>
            </select>
          </Field>
          <Field label="Tên mẫu *">
            <input className="input debit-editor-inline-input" value={form.name} onChange={event => set('name', event.target.value)} disabled={controlsDisabled} />
          </Field>
          <Field label="Tiêu đề">
            <input className="input debit-editor-inline-input" value={form.titleText} onChange={event => set('titleText', event.target.value)} disabled={controlsDisabled} />
          </Field>
          <Field label="Hướng giấy">
            <select className="input debit-editor-inline-select debit-editor-settings-select" value={form.orientation} onChange={event => set('orientation', event.target.value as DebitNoteTemplateInput['orientation'])} disabled={controlsDisabled}>
              <option value="landscape">Ngang</option>
              <option value="portrait">Dọc</option>
            </select>
          </Field>
          <Field label="Màu nhấn">
            <div className="debit-editor-color">
              <input type="color" value={form.accentColor} onChange={event => set('accentColor', event.target.value)} disabled={controlsDisabled} />
              <input className="input mono debit-editor-inline-input" value={form.accentColor} onChange={event => set('accentColor', event.target.value)} disabled={controlsDisabled} />
            </div>
          </Field>
          <label className="debit-editor-check">
            <input type="checkbox" checked={form.isDefault} onChange={event => set('isDefault', event.target.checked)} disabled={controlsDisabled} />
            <Star size={15} />
            <span>Mẫu mặc định</span>
          </label>
        </section>
      );
    }

    if (activeSection === 'company') {
      return (
        <section className="debit-editor-settings debit-editor-settings--issuer">
          <Field label="Tên công ty">
            <input className="input debit-editor-inline-input" value={form.issuerName ?? ''} onChange={event => set('issuerName', event.target.value || null)} disabled={controlsDisabled} />
          </Field>
          <Field label="Mã số thuế">
            <input className="input debit-editor-inline-input" value={form.issuerTaxCode ?? ''} onChange={event => set('issuerTaxCode', event.target.value || null)} disabled={controlsDisabled} />
          </Field>
          <Field label="Địa chỉ">
            <input className="input debit-editor-inline-input" value={form.issuerAddress ?? ''} onChange={event => set('issuerAddress', event.target.value || null)} disabled={controlsDisabled} />
          </Field>
          <Field label="Đại diện bởi">
            <input className="input debit-editor-inline-input" value={form.issuerRepresentative ?? ''} onChange={event => set('issuerRepresentative', event.target.value || null)} disabled={controlsDisabled} />
          </Field>
          <Field label="Chức vụ">
            <input className="input debit-editor-inline-input" value="Giám Đốc" disabled />
          </Field>
          <Field label="Số TK">
            <input className="input debit-editor-inline-input" value={accountTerms.accountNumber} onChange={event => setAccountNumber(event.target.value)} disabled={controlsDisabled} />
          </Field>
          <Field label="Tại ngân hàng">
            <input className="input debit-editor-inline-input" value={accountTerms.bankName} onChange={event => setBankName(event.target.value)} disabled={controlsDisabled} />
          </Field>
        </section>
      );
    }

    if (activeSection === 'columns') {
      return (
        <ColumnTable
          columns={form.columns ?? []}
          accentColor={form.accentColor}
          disabled={controlsDisabled}
          onChange={columns => set('columns', normalizeTemplateColumns(columns))}
        />
      );
    }

    return (
      <section className="debit-editor-settings debit-editor-settings--footer">
        <Field label="Nhóm dòng">
          <select className="input debit-editor-inline-select debit-editor-settings-select" value={form.groupingMode} onChange={event => set('groupingMode', event.target.value as DebitNoteTemplateInput['groupingMode'])} disabled={controlsDisabled}>
            <option value="ROUTE">Theo tuyến</option>
            <option value="LINE_TYPE">Theo loại dòng</option>
            <option value="NONE">Không nhóm</option>
          </select>
        </Field>
        <Field label="Chữ ký trái">
          <input className="input debit-editor-inline-input" value={form.signatureLeftLabel ?? ''} onChange={event => set('signatureLeftLabel', event.target.value || null)} disabled={controlsDisabled} />
        </Field>
        <Field label="Tên người ký trái">
          <input className="input debit-editor-inline-input" value={form.signatureLeftName ?? ''} onChange={event => set('signatureLeftName', event.target.value || null)} disabled={controlsDisabled} />
        </Field>
        <Field label="Chữ ký phải">
          <input className="input debit-editor-inline-input" value={form.signatureRightLabel ?? ''} onChange={event => set('signatureRightLabel', event.target.value || null)} disabled={controlsDisabled} />
        </Field>
        <Field label="Tên người ký phải">
          <input className="input debit-editor-inline-input" value={form.signatureRightName ?? ''} onChange={event => set('signatureRightName', event.target.value || null)} disabled={controlsDisabled} />
        </Field>
        <Field label="Điều khoản">
          <input className="input debit-editor-inline-input" value={form.termsText ?? ''} onChange={event => set('termsText', event.target.value || null)} disabled={controlsDisabled} />
        </Field>
      </section>
    );
  };

  return (
    <div className="cfg-page debit-editor-page">
      <header className="debit-editor-topbar">
        <h1 className="sr-only">
          {viewOnly ? 'Xem mẫu giấy báo nợ' : isNew ? 'Tạo mẫu giấy báo nợ' : 'Chỉnh sửa mẫu giấy báo nợ'}
        </h1>
        <div className="debit-editor-title">
          <button type="button" className="billing-builder__close" onClick={backToList} aria-label="Quay lại" disabled={busy}>
            <ArrowLeft size={21} />
          </button>
          <div className="billing-builder__icon">
            <AssetIcon name="debit-note-template" size={34} />
          </div>
          <div>
            <p className="billing-builder__eyebrow">{viewOnly ? 'Xem mẫu' : isNew ? 'Tạo mẫu mới' : 'Chỉnh sửa mẫu'}</p>
            <input
              className="debit-editor-template-name"
              value={form.name}
              placeholder="Tên mẫu"
              aria-label="Tên mẫu"
              onChange={event => set('name', event.target.value)}
              disabled={controlsDisabled}
            />
            <div className="billing-builder__meta">
              <span>{visibleColumns.length} cột đang hiện</span>
              <span>{form.orientation === 'landscape' ? 'Khổ ngang' : 'Khổ dọc'}</span>
              {form.isDefault && <span>Mẫu mặc định</span>}
            </div>
          </div>
        </div>
        <div className="debit-editor-topbar__actions">
          {viewOnly ? (
            <button type="button" className="btn btn--primary" onClick={() => navigate(`/config/debit-note-templates/${id}`)} disabled={busy}>
              <PenLine size={16} /> Sửa mẫu
            </button>
          ) : !isNew && (
            <button type="button" className="btn btn--ghost" onClick={removeTemplate} disabled={busy}>
              <Trash2 size={16} /> Xoá
            </button>
          )}
          {!viewOnly && (
            <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              Lưu mẫu
            </button>
          )}
        </div>
      </header>

      {isLoading ? (
        <main className="debit-editor-loading">
          <Loader2 size={28} className="spin" />
          <span>Đang tải mẫu</span>
        </main>
      ) : (
        <main className="debit-editor-workspace">
          <nav className="debit-editor-side-nav" aria-label="Mục chỉnh sửa">
            {EDITOR_SECTIONS.map(section => {
              const Icon = section.Icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={section.id === activeSection ? 'is-active' : undefined}
                  onClick={() => selectSection(section.id)}
                  aria-pressed={section.id === activeSection}
                >
                  <Icon size={17} />
                  <span>{section.label}</span>
                  <small>{section.meta}</small>
                </button>
              );
            })}
          </nav>

          <section className="debit-editor-preview-pane">
            {hasGroupedHeaders && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid #c8d6f5',
                  background: '#f5f8ff',
                  color: '#20407a',
                }}
              >
                Mẫu này dùng tiêu đề gộp nhiều tầng cho bố cục Long Minh. Khi xuất Excel, hệ thống sẽ giữ nguyên nhóm cột từ snapshot đã lưu.
              </div>
            )}
            <TemplatePreview
              form={form}
              disabled={controlsDisabled}
              selectedTarget={selectedTarget}
              onSelect={selectTarget}
              onSet={set}
              onUpdateColumn={updateColumn}
            />
          </section>

          <aside className="debit-editor-inspector" aria-label={`Chỉnh ${activeSectionLabel}`}>
            {renderInspector()}
          </aside>
        </main>
      )}

      {confirmDialog}
    </div>
  );
}
