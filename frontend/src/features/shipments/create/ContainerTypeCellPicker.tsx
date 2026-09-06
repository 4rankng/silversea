import { useState } from 'react';
import type { ContainerType } from '@tingting/shared';
import { USearchableField as SearchableField } from './uui-fields';
import { ContainerTypeCreateDialog } from './ContainerTypeCreateDialog';
import { Plus } from 'lucide-react';

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
          options={options.map((item) => ({ value: String(item.id), label: item.code }))}
          placeholder="Chọn hoặc gõ để tìm loại"
          disabled={Boolean(saving)}
          error={error}
        />
        <button
          type="button"
          className="csc-utility-button csc-utility-button--dashed csc-route-picker__add"
          onClick={() => setCreateOpen(true)}
          disabled={Boolean(saving)}
          aria-label="Thêm loại container"
        >
          <Plus size={15} aria-hidden="true" />Thêm
        </button>
      </div>
      <ContainerTypeCreateDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created: ContainerType) => {
          onChange(String(created.id));
          setCreateOpen(false);
        }}
      />
    </>
  );
}
