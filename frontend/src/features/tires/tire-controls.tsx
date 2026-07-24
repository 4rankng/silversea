import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, ChevronDown, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import type { TirePosition } from "@tingting/shared";
import type { Supplier } from "@tingting/shared";
import { ConfirmDialog } from "../../components/UI";
import { useToast } from "../../components/shared/Toast";
import { formatErrorMessage } from "../../lib/api";
import { cleanText, normalizedCatalogLabel, positionPayloadFromLabel, supplierIdFromText, textMatches } from "../../features/tires/tireUtils";
import "../../pages/TruckTiresPage.css";

export type PositionManagerOpener = (onSelect?: (value: string) => void) => void;

// ─── Add-tire inline form ───────────────────────────────────────────────────

export function AddTireForm({
  positionLabels,
  suppliers,
  saving,
  onManagePositions,
  onsave,
}: {
  positionLabels: string[];
  suppliers: Supplier[];
  saving: boolean;
  onManagePositions: PositionManagerOpener;
  onsave: (d: { serial: string; position: string | null; size: string | null; supplierId: number | null; cost: number; purchasedAt: string | null }) => Promise<unknown> | void;
}) {
  const [serial, setSerial] = useState("");
  const [positionText, setPositionText] = useState("");
  const [size, setSize] = useState("");
  const [supplierText, setSupplierText] = useState("");
  const [cost, setCost] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");

  const submit = async () => {
    if (!serial.trim()) return;
    const positionPayload = positionPayloadFromLabel(positionText);
    try {
      await onsave({
        serial: serial.trim(),
        ...positionPayload,
        size: size.trim() || null,
        supplierId: supplierIdFromText(suppliers, supplierText),
        cost: cost ? Number(cost) : 0,
        purchasedAt: purchasedAt || null,
      });
      setSerial("");
      setPositionText("");
      setSize("");
      setSupplierText("");
      setCost("");
      setPurchasedAt("");
    } catch {
      // Error handled by parent
    }
  };

  return (
    <div className="ttp-add">
      <div className="ttp-field ttp-field--serial">
        <label htmlFor="tire-serial">Serial lốp *</label>
        <input id="tire-serial" name="serial" className="input" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="VD: 12345678" />
      </div>
      <div className="ttp-field">
        <span className="ttp-field__label">Vị trí</span>
        <PositionPicker value={positionText} labels={positionLabels} onChange={setPositionText} onManage={onManagePositions} />
      </div>
      <div className="ttp-field">
        <label htmlFor="tire-size">Kích cỡ</label>
        <input id="tire-size" name="size" className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="VD: 11R22.5" />
      </div>
      <div className="ttp-field">
        <span className="ttp-field__label">Nhà cung cấp</span>
        <SupplierPicker value={supplierText} suppliers={suppliers} onChange={setSupplierText} />
      </div>
      <div className="ttp-field">
        <label htmlFor="tire-cost">Giá (VND)</label>
        <input id="tire-cost" name="cost" className="input" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
      </div>
      <div className="ttp-field">
        <label htmlFor="tire-purchased-at">Ngày mua</label>
        <input id="tire-purchased-at" name="purchasedAt" className="input" type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
      </div>
      <button className="btn btn--primary ttp-add-submit" disabled={saving || !serial.trim()} onClick={submit}>
        {saving ? "Đang lưu…" : "Thêm lốp"}
      </button>
    </div>
  );
}

// ─── Tire table ─────────────────────────────────────────────────────────────

function useFloatingPickerMenu(open: boolean, itemCount: number, onClose: () => void, options: { maxWidth?: number; maxHeight?: number } = {}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const maxWidth = options.maxWidth ?? 420;
  const maxHeightLimit = options.maxHeight ?? 280;

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(undefined);
      return;
    }

    const updateMenuPosition = () => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;

      const rect = root.getBoundingClientRect();
      const gap = 8;
      const viewportPadding = 8;
      const menuWidth = Math.min(rect.width, maxWidth, window.innerWidth - viewportPadding * 2);
      const availableBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const availableAbove = rect.top - gap - viewportPadding;
      const openUp = availableBelow < 180 && availableAbove > availableBelow;
      const maxHeight = Math.max(180, Math.min(maxHeightLimit, openUp ? availableAbove : availableBelow));

      setMenuStyle({
        top: openUp ? Math.max(viewportPadding, rect.top - gap - maxHeight) : rect.bottom + gap,
        left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)),
        width: menuWidth,
        maxHeight,
        visibility: "visible",
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [itemCount, maxHeightLimit, maxWidth, open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  return { rootRef, menuRef, menuStyle };
}

export function PositionPicker({ value, labels, onChange, onManage }: { value: string; labels: string[]; onChange: (value: string) => void; onManage: (onSelect?: (value: string) => void) => void }) {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  const { rootRef, menuRef, menuStyle } = useFloatingPickerMenu(open, labels.length, closeMenu);
  const selectedLabel = cleanText(value);

  return (
    <div ref={rootRef} className="ttp-position-picker">
      <button type="button" className={`input ttp-position-select-trigger ${open ? "is-open" : ""}`} onClick={() => setOpen((current) => !current)} aria-label="Chọn vị trí lốp" aria-haspopup="listbox" aria-expanded={open}>
        <span className={selectedLabel ? "" : "ttp-position-select-placeholder"}>{selectedLabel || "Chọn vị trí lắp"}</span>
        <ChevronDown size={16} className="ttp-position-select-chevron" />
      </button>
      {open && (
        <div ref={menuRef} className="ttp-position-picker-menu ttp-position-picker-menu--floating" role="listbox" style={menuStyle ?? { visibility: "hidden" }}>
          {labels.length > 0 ? (
            labels.map((label) => (
              <button
                key={label}
                type="button"
                className="ttp-position-picker-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(label);
                  setOpen(false);
                }}
                role="option"
                aria-selected={selectedLabel === label}
              >
                {label}
              </button>
            ))
          ) : (
            <div className="ttp-position-picker-empty">Chưa có vị trí lốp</div>
          )}
          <button
            type="button"
            className="ttp-position-picker-manage"
            onPointerDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onManage((label) => onChange(label));
            }}
          >
            <Settings2 size={15} />
            Sửa / xóa vị trí
          </button>
        </div>
      )}
    </div>
  );
}

export function SupplierPicker({ value, suppliers, onChange }: { value: string; suppliers: Supplier[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const filteredSuppliers = suppliers.filter((supplier) => !value.trim() || textMatches(supplier.name, value)).slice(0, 8);
  const closeMenu = () => setOpen(false);
  const { rootRef, menuRef, menuStyle } = useFloatingPickerMenu(open, filteredSuppliers.length, closeMenu);

  return (
    <div ref={rootRef} className="ttp-position-picker ttp-supplier-picker">
      <input
        className="input"
        name="supplierSearch"
        aria-label="Tìm nhà cung cấp lốp"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          onChange(cleanText(value));
          window.setTimeout(() => setOpen(false), 120);
        }}
        placeholder="Tìm nhà cung cấp"
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {open && (
        <div ref={menuRef} className="ttp-position-picker-menu ttp-position-picker-menu--floating ttp-supplier-picker-menu" role="listbox" style={menuStyle ?? { visibility: "hidden" }}>
          {filteredSuppliers.length > 0 ? (
            filteredSuppliers.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                className="ttp-position-picker-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(supplier.name);
                  setOpen(false);
                }}
                role="option"
                aria-selected={cleanText(value) === cleanText(supplier.name)}
              >
                {supplier.name}
              </button>
            ))
          ) : (
            <div className="ttp-position-picker-empty">Không có nhà cung cấp phù hợp</div>
          )}
        </div>
      )}
    </div>
  );
}

type TirePositionDraft = {
  name: string;
};

function tirePositionDraft(position?: TirePosition): TirePositionDraft {
  return {
    name: position?.name ?? "",
  };
}

function tirePositionPayload(draft: TirePositionDraft, sortOrder?: number) {
  return {
    name: cleanText(draft.name),
    ...(sortOrder == null ? {} : { sortOrder }),
    status: "ACTIVE" as TirePosition["status"],
  };
}

function sortTirePositions(positions: TirePosition[]) {
  return [...positions].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

/** Next sort_order value: 10 past the current max (or 10 for the first row). */
export function computeNextSortOrder(positions: TirePosition[]): number {
  return positions.length ? Math.max(...positions.map((p) => p.sortOrder)) + 10 : 10;
}

export function TirePositionsManagerDialog({
  positions,
  saving,
  onselect,
  oncreate,
  onupdate,
  ondelete,
  oncancel,
}: {
  positions: TirePosition[];
  saving: boolean;
  onselect?: (value: string) => void;
  oncreate: (data: { name: string; sortOrder?: number; status: TirePosition["status"] }) => Promise<unknown>;
  onupdate: (id: number, data: Partial<ReturnType<typeof tirePositionPayload>>) => Promise<unknown>;
  ondelete: (id: number) => Promise<unknown>;
  oncancel: () => void;
}) {
  const { toast } = useToast();
  const sortedPositions = sortTirePositions(positions);
  const nextSortOrder = computeNextSortOrder(sortedPositions);
  const [newDraft, setNewDraft] = useState<TirePositionDraft>(() => tirePositionDraft());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<TirePositionDraft>(() => tirePositionDraft());
  const [deleteTarget, setDeleteTarget] = useState<TirePosition | null>(null);
  const [error, setError] = useState("");

  const updateNewDraft = (key: keyof TirePositionDraft, value: string) => {
    setNewDraft((current) => ({ ...current, [key]: value }));
  };

  const updateEditDraft = (key: keyof TirePositionDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };

  const startEdit = (position: TirePosition) => {
    setEditingId(position.id);
    setEditDraft(tirePositionDraft(position));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(tirePositionDraft());
  };

  const createPosition = async () => {
    const payload = tirePositionPayload(newDraft, nextSortOrder);
    if (!payload.name) return;
    const exists = sortedPositions.some((position) => normalizedCatalogLabel(position.name) === normalizedCatalogLabel(payload.name));
    if (exists) {
      setError(`Vị trí "${payload.name}" đã có trong danh sách.`);
      return;
    }
    setError("");
    try {
      await oncreate(payload);
      setNewDraft(tirePositionDraft());
      toast({ kind: "success", message: `Đã thêm vị trí "${payload.name}".` });
      if (onselect) {
        onselect(payload.name);
        oncancel();
      }
    } catch (err) {
      const message = formatErrorMessage(err);
      setError(message);
      toast({ kind: "error", message });
    }
  };

  const updatePosition = async (id: number) => {
    const payload = tirePositionPayload(editDraft);
    if (!payload.name) return;
    const exists = sortedPositions.some((position) => position.id !== id && normalizedCatalogLabel(position.name) === normalizedCatalogLabel(payload.name));
    if (exists) {
      setError(`Vị trí "${payload.name}" đã có trong danh sách.`);
      return;
    }
    setError("");
    try {
      await onupdate(id, payload);
      cancelEdit();
      toast({ kind: "success", message: `Đã cập nhật vị trí "${payload.name}".` });
    } catch (err) {
      const message = formatErrorMessage(err);
      setError(message);
      toast({ kind: "error", message });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setError("");
    try {
      await ondelete(target.id);
      toast({ kind: "success", message: `Đã xóa vị trí "${target.name}".` });
    } catch (err) {
      const message = formatErrorMessage(err);
      setError(message);
      toast({ kind: "error", message });
    }
  };

  return (
    <div className="ttp-dialog-overlay" role="presentation" onClick={oncancel}>
      <div className="ttp-dialog ttp-dialog--positions" role="dialog" aria-modal="true" aria-labelledby="ttp-position-manager-title" onClick={(e) => e.stopPropagation()}>
        <div className="ttp-dialog-head ttp-position-head">
          <div className="ttp-position-title-block">
            <span className="ttp-position-kicker">Danh mục lốp</span>
            <h2 id="ttp-position-manager-title">Vị trí lắp</h2>
            <p>Quản lý các lựa chọn xuất hiện trong ô vị trí trên trang lốp xe.</p>
          </div>
          <button type="button" className="ttp-dialog-close" onClick={oncancel} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="ttp-position-manager">
          <div className="ttp-position-create" aria-label="Thêm vị trí lốp">
            <div className="ttp-position-create-copy">
              <strong>Thêm vị trí mới</strong>
              <span>Dùng tên ngắn, dễ nhìn trên bảng lốp.</span>
            </div>
            <label className="ttp-position-control ttp-position-control--name">
              <span>Tên vị trí</span>
              <input className="input" value={newDraft.name} onChange={(e) => updateNewDraft("name", e.target.value)} onBlur={(e) => updateNewDraft("name", cleanText(e.target.value))} placeholder="VD: Trục nâng trái" />
            </label>
            <button
              type="button"
              className="btn btn--primary ttp-position-add-btn"
              onClick={() => {
                void createPosition();
              }}
              disabled={saving || !newDraft.name.trim()}
            >
              <Plus size={16} />
              Thêm
            </button>
            {error && <div className="ttp-position-error">{error}</div>}
          </div>

          <div className="ttp-position-list">
            {sortedPositions.length === 0 ? (
              <div className="ttp-position-empty">
                <div className="ttp-position-empty-icon">
                  <Settings2 size={20} />
                </div>
                <strong>Chưa có vị trí lốp</strong>
                <span>Thêm vị trí đầu tiên để dropdown bắt đầu có lựa chọn.</span>
              </div>
            ) : (
              sortedPositions.map((position) => {
                const isEditing = editingId === position.id;
                return (
                  <div key={position.id} className={`ttp-position-row ${isEditing ? "ttp-position-row--editing" : "ttp-position-row--read"}`}>
                    {isEditing ? (
                      <>
                        <label className="ttp-position-control ttp-position-control--name">
                          <span>Tên vị trí</span>
                          <input className="input" value={editDraft.name} onChange={(e) => updateEditDraft("name", e.target.value)} onBlur={(e) => updateEditDraft("name", cleanText(e.target.value))} />
                        </label>
                        <div className="ttp-icon-actions">
                          <button
                            type="button"
                            className="ttp-icon-btn ttp-icon-btn--save"
                            onClick={() => {
                              void updatePosition(position.id);
                            }}
                            disabled={saving || !editDraft.name.trim()}
                            title="Lưu vị trí"
                            aria-label={`Lưu vị trí ${position.name}`}
                          >
                            <Check size={15} />
                          </button>
                          <button type="button" className="ttp-icon-btn" onClick={cancelEdit} disabled={saving} title="Hủy" aria-label="Hủy sửa vị trí">
                            <X size={15} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="ttp-position-name">
                          <button
                            type="button"
                            className="ttp-position-select"
                            onClick={() => {
                              if (!onselect) return;
                              onselect(position.name);
                              oncancel();
                            }}
                            disabled={!onselect}
                          >
                            <span>{position.name}</span>
                            <small>{onselect ? "Chọn vị trí này" : "Hiển thị trong dropdown"}</small>
                          </button>
                        </div>
                        <div className="ttp-icon-actions">
                          <button type="button" className="ttp-icon-btn" onClick={() => startEdit(position)} disabled={saving} title="Sửa vị trí" aria-label={`Sửa vị trí ${position.name}`}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="ttp-icon-btn ttp-icon-btn--danger" onClick={() => setDeleteTarget(position)} disabled={saving} title="Xóa vị trí" aria-label={`Xóa vị trí ${position.name}`}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        variant="danger"
        message={deleteTarget ? `Xóa vị trí "${deleteTarget.name}" khỏi danh sách chọn mới?` : ""}
        confirmLabel={saving ? "Đang xóa…" : "Xóa vị trí"}
        cancelLabel="Hủy"
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
