import { useMemo, useState } from 'react';
import type { ContainerType } from '@tingting/shared';
import { USearchableField as SearchableField } from './uui-fields';
import { ContainerTypeCreateDialog } from './ContainerTypeCreateDialog';

interface ContainerTypeCellPickerProps {
  /** The id of the currently-selected container type, or empty string. */
  value: string;
  /** Called when the user picks an existing row OR creates a new one. */
  onChange: (id: string) => void;
  /** Catalog options (id + code label). */
  options: Array<{ id: number; code: string; name?: string | null }>;
  /** Stable id used by `aria-label` / `data-field-id`. */
  fieldId: string;
  /** True if the form is currently saving — disables the picker + button. */
  saving: boolean;
  /** Field validation error, surfaced into the combobox hint. */
  error?: string;
}

/**
 * FCL "Loại container" cell — searchable combobox + "+ Thêm" sibling +
 * inline create dialog. The cell owns its own dialog state because every
 * container row gets one; the parent workspace only passes the catalog
 * options and the row-level change handler.
 *
 * Background: customer feedback 2026-09-06 — "vẫn còn nhiều chỗ chỉ cho
 * phép chọn dropdown". Before this cell existed, the Loại container column
 * was the only catalog dropdown in the create-shipment form without a way
 * to extend the catalog inline.
 */
export function ContainerTypeCellPicker({ value, onChange, options, fieldId, saving, error }: ContainerTypeCellPickerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  // Typed text carried from the combobox create option into the dialog.
  const [initialCode, setInitialCode] = useState('');
  // Rows created inline this session. The catalog query (staleTime minutes)
  // will not contain them until its next refetch, so the cell merges them
  // itself — otherwise the just-created code cannot display as selected.
  const [createdTypes, setCreatedTypes] = useState<Array<{ id: number; code: string; name?: string | null }>>([]);
  const mergedOptions = useMemo(() => {
    const known = new Set(options.map((item) => item.id));
    return [...options, ...createdTypes.filter((item) => !known.has(item.id))];
  }, [options, createdTypes]);

  return (
    <>
      <div className="csc-route-picker">
        <SearchableField
          id={fieldId}
          label="Loại container"
          hideLabel
          required
          value={value}
          onChange={onChange}
          options={mergedOptions.map((item) => ({ value: String(item.id), label: item.code }))}
          placeholder="Chọn loại"
          disabled={Boolean(saving)}
          error={error}
          popoverPlacement="top"
          createOption={{
            label: (typed) => (typed.trim() ? `＋ Thêm loại “${typed.trim()}”…` : '＋ Thêm loại container…'),
            onSelect: (typed) => {
              setInitialCode(typed.trim());
              setCreateOpen(true);
            },
          }}
        />
      </div>
      <ContainerTypeCreateDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created: ContainerType) => {
          onChange(String(created.id));
          setCreatedTypes((prev) => (prev.some((item) => item.id === created.id) ? prev : [...prev, { id: created.id, code: created.code, name: created.name }]));
          setCreateOpen(false);
        }}
        initialCode={initialCode}
      />
    </>
  );
}
