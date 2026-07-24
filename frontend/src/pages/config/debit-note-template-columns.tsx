import { useEffect, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw } from 'lucide-react';
import type { DebitNoteColumnVariable, DebitNoteTemplateColumn } from '@tingting/shared';
import { cloneStarterColumns, variableLabel, variableMap, VARIABLES, makeColumn } from './debit-note-template-editor-utils';
import { Field } from './debit-note-template-preview';

export function ColumnTable({
  columns,
  accentColor,
  disabled,
  onChange,
}: {
  columns: DebitNoteTemplateColumn[];
  accentColor: string;
  disabled: boolean;
  onChange: (columns: DebitNoteTemplateColumn[]) => void;
}) {
  const [selectedColumnId, setSelectedColumnId] = useState(columns[0]?.id ?? '');
  const update = (index: number, patch: Partial<DebitNoteTemplateColumn>) => {
    onChange(columns.map((column, idx) => idx === index ? { ...column, ...patch } : column));
  };
  const updateSelected = (patch: Partial<DebitNoteTemplateColumn>) => {
    if (selectedIndex < 0) return;
    update(selectedIndex, patch);
  };
  const addColumn = () => {
    const nextColumn = makeColumn(columns.length + 1);
    setSelectedColumnId(nextColumn.id);
    onChange([...columns, nextColumn]);
  };
  const reset = () => onChange(cloneStarterColumns());
  const selectedIndex = columns.findIndex(column => column.id === selectedColumnId);
  const selectedColumn = selectedIndex >= 0 ? columns[selectedIndex] : columns[0];
  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    setSelectedColumnId(next[target].id);
    onChange(next);
  };

  useEffect(() => {
    if (columns.length === 0) {
      setSelectedColumnId('');
      return;
    }
    if (!columns.some(column => column.id === selectedColumnId)) {
      setSelectedColumnId(columns[0].id);
    }
  }, [columns, selectedColumnId]);

  return (
    <section className="debit-editor-table-wrap">
      <div className="debit-editor-table-toolbar">
        <div>
          <strong>Cột Excel</strong>
          <span>{columns.filter(column => column.width > 0).length}/{columns.length} đang hiện</span>
        </div>
        <div>
          <button type="button" className="btn btn--ghost" onClick={reset} disabled={disabled}>
            <RotateCcw size={15} /> Mặc định
          </button>
          <button type="button" className="btn btn--secondary" onClick={addColumn} disabled={disabled}>
            <Plus size={15} /> Thêm cột
          </button>
        </div>
      </div>
      <div className="debit-editor-column-designer">
        <div className="debit-editor-column-preview" style={{ '--accent': accentColor } as React.CSSProperties} aria-label="Chọn cột để chỉnh">
          <table className="debit-editor-column-preview__table">
            <thead>
              <tr>
                {columns.map((column, index) => {
                  const hidden = column.width === 0;
                  return (
                    <th
                      key={column.id}
                      className={`${hidden ? 'is-hidden' : ''} ${column.id === selectedColumn?.id ? 'is-selected' : ''}`}
                      style={{ width: `${Math.max(column.width || 8, 8) * 10}px` }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedColumnId(column.id)}
                        disabled={disabled}
                        aria-pressed={column.id === selectedColumn?.id}
                      >
                        <span>{column.label || `Cột ${index + 1}`}</span>
                        <small>{variableLabel(column.variable)}</small>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                {columns.map(column => {
                  const variable = variableMap.get(column.variable);
                  return (
                    <td key={column.id} className={column.width === 0 ? 'is-hidden' : undefined}>
                      {variable?.sample || '-'}
                    </td>
                  );
                })}
              </tr>
              <tr>
                {columns.map(column => (
                  <td key={column.id} className={`${column.total ? 'is-total' : ''} ${column.width === 0 ? 'is-hidden' : ''}`}>
                    {column.total ? 'Tổng' : ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="debit-editor-column-cards" aria-label="Danh sách cột">
          {columns.map((column, index) => {
            const hidden = column.width === 0;
            return (
              <div key={column.id} className={`debit-editor-column-card ${column.id === selectedColumn?.id ? 'is-selected' : ''} ${hidden ? 'is-hidden' : ''}`}>
                <button type="button" onClick={() => setSelectedColumnId(column.id)} disabled={disabled}>
                  <span>{column.label || `Cột ${index + 1}`}</span>
                  <small>Dữ liệu: {variableLabel(column.variable)}</small>
                </button>
                <div>
                  <span>{hidden ? 'Ẩn' : 'Hiện'}</span>
                  {column.total && <span>Tổng</span>}
                </div>
                <div className="debit-editor-column-card__actions">
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => moveColumn(index, -1)} disabled={disabled || index === 0} aria-label={`Đưa ${column.label} lên trước`}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => moveColumn(index, 1)} disabled={disabled || index === columns.length - 1} aria-label={`Đưa ${column.label} xuống sau`}>
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {selectedColumn && (
          <aside className="debit-editor-column-inspector">
            <div className="debit-editor-column-stack">
              <div className="debit-editor-column-inspector__header">
                <div>
                  <span>Cột {selectedIndex + 1}</span>
                  <strong>{selectedColumn.label || 'Chưa đặt tên'}</strong>
                </div>
                <div className="debit-editor-column-inspector__actions">
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => moveColumn(selectedIndex, -1)} disabled={disabled || selectedIndex <= 0} aria-label="Đưa cột lên trước">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => moveColumn(selectedIndex, 1)} disabled={disabled || selectedIndex >= columns.length - 1} aria-label="Đưa cột xuống sau">
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
              <Field label="Tiêu đề cột">
                <input
                  className="input"
                  value={selectedColumn.label}
                  disabled={disabled}
                  onChange={(event) => updateSelected({ label: event.target.value })}
                />
              </Field>
              <Field label="Biến dữ liệu">
                <select
                  className="input"
                  value={selectedColumn.variable}
                  disabled={disabled}
                  onChange={(event) => updateSelected({ variable: event.target.value as DebitNoteColumnVariable })}
                >
                  {VARIABLES.map(variable => (
                    <option key={variable.value} value={variable.value}>{variable.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="debit-editor-variable-grid">
              {VARIABLES.map(variable => (
                <button
                  key={variable.value}
                  type="button"
                  className={variable.value === selectedColumn.variable ? 'is-active' : undefined}
                  disabled={disabled}
                  onClick={() => updateSelected({ variable: variable.value })}
                >
                  <span>{variable.label}</span>
                  <small>{variable.sample || '-'}</small>
                </button>
              ))}
            </div>
            <div className="debit-editor-column-options">
              <label className="debit-editor-check">
                <input
                  type="checkbox"
                  checked={selectedColumn.total}
                  disabled={disabled}
                  onChange={(event) => updateSelected({ total: event.target.checked })}
                />
                <span>Tính tổng</span>
              </label>
              <label className="debit-editor-check">
                <input
                  type="checkbox"
                  checked={selectedColumn.width > 0}
                  disabled={disabled}
                  onChange={(event) => updateSelected({ width: event.target.checked ? 14 : 0 })}
                />
                <span>Hiện cột</span>
              </label>
              <Field label="Độ rộng">
                <input
                  className="input"
                  type="number"
                  min={6}
                  max={40}
                  value={selectedColumn.width || 14}
                  disabled={disabled || selectedColumn.width === 0}
                  onChange={(event) => updateSelected({ width: Number(event.target.value) || 14 })}
                />
              </Field>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

export function ColumnPropertyPanel({
  column,
  columns,
  disabled,
  onChange,
  onSelectColumn,
  onToggleColumnVisibility,
}: {
  column: DebitNoteTemplateColumn;
  columns: DebitNoteTemplateColumn[];
  disabled: boolean;
  onChange: (patch: Partial<DebitNoteTemplateColumn>) => void;
  onSelectColumn: (columnId: string) => void;
  onToggleColumnVisibility: (column: DebitNoteTemplateColumn) => void;
}) {
  return (
    <section className="debit-editor-selected-panel">
      <div className="debit-editor-column-picker" aria-label="Chọn cột">
        {columns.map((item, index) => {
          const visible = item.width > 0;
          const isActive = item.id === column.id;
          return (
            <div key={item.id} className={`debit-editor-column-picker__card ${isActive ? 'is-active' : ''} ${visible ? '' : 'is-hidden'}`}>
              <button
                type="button"
                className="debit-editor-column-picker__select"
                onClick={() => onSelectColumn(item.id)}
                disabled={disabled}
                aria-pressed={isActive}
              >
                <span>{item.label || `Cột ${index + 1}`}</span>
                <small>{visible ? `Hiện · ${variableLabel(item.variable)}` : `Ẩn · ${variableLabel(item.variable)}`}</small>
              </button>
              <button
                type="button"
                className="debit-editor-column-picker__visibility"
                onClick={() => onToggleColumnVisibility(item)}
                disabled={disabled}
                aria-label={visible ? `Ẩn cột ${item.label || `Cột ${index + 1}`}` : `Hiện cột ${item.label || `Cột ${index + 1}`}`}
                title={visible ? 'Ẩn cột' : 'Hiện cột'}
              >
                {visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="debit-editor-selected-group">
        <strong>Thuộc tính cột</strong>
        <Field label="Biến dữ liệu">
          <select
            className="input"
            value={column.variable}
            disabled={disabled}
            onChange={event => {
              const variable = event.target.value as DebitNoteColumnVariable;
              onChange({ variable, label: variableLabel(variable) });
            }}
          >
            {VARIABLES.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Căn lề">
          <div className="debit-editor-align-control" role="group" aria-label="Căn lề">
            {[
              { value: 'left' as const, label: 'Trái', Icon: AlignLeft },
              { value: 'center' as const, label: 'Giữa', Icon: AlignCenter },
              { value: 'right' as const, label: 'Phải', Icon: AlignRight },
            ].map(item => {
              const Icon = item.Icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  className={column.align === item.value ? 'is-active' : undefined}
                  onClick={() => onChange({ align: item.value })}
                  disabled={disabled}
                  aria-label={item.label}
                >
                  <Icon size={15} />
                </button>
              );
            })}
          </div>
        </Field>
        <div className="debit-editor-switch-list">
          <label>
            <span>Hiện cột</span>
            <input
              type="checkbox"
              checked={column.width > 0}
              disabled={disabled}
              onChange={event => onChange({ width: event.target.checked ? 14 : 0 })}
            />
          </label>
          <label>
            <span>Tính tổng</span>
            <input
              type="checkbox"
              checked={column.total}
              disabled={disabled}
              onChange={event => onChange({ total: event.target.checked })}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
