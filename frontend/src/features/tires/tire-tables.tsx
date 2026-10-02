import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpToLine, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { Tire } from "@tingting/shared";
import type { Supplier } from "@tingting/shared";
import { StatusStrip } from "../../components/shared/StatusStrip";
import { SortHeader } from "../../components/shared/SortHeader";
import { nextTableSort, sortClientSide, type TableSortState } from "../../lib/table-sort";
import { daysBetween, displayTirePosition, supplierName, tireAgeDays } from "../../features/tires/tireUtils";
import "../../styles/record-table.css";
import "../../styles/operational-table-typography.css";
import "../../pages/TruckTiresPage.css";

const TIRE_STATUS_COLORS: Record<Tire['status'], string> = { IN_USE: 'var(--success-text)', IN_STOCK: 'var(--info)', DISPOSED: 'var(--ink-4)' };
function daysInService(installedAt: string | null, removedAt: string | null): number | null { return daysBetween(installedAt, removedAt); }
export function TireTable({
  tires,
  suppliers,
  loading,
  emptyHint,
  busy,
  onedit,
  ondelete,
  onunmount,
  oninstall,
  ontransfer,
}: {
  tires: Tire[];
  suppliers: Supplier[];
  loading: boolean;
  emptyHint: string;
  busy: boolean;
  onedit: (tire: Tire) => void;
  ondelete: (tire: Tire) => void;
  onunmount?: (tire: Tire) => void;
  oninstall?: (tire: Tire) => void;
  ontransfer?: (tire: Tire) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  // Client-side column sort — per-vehicle lists the page already holds in
  // memory; null keeps the page's handed-in order.
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const sorted = useMemo(() => sortClientSide(tires, sort, {
    serial: t => t.serial,
    position: t => displayTirePosition(t),
    size: t => t.size,
    installedAt: t => t.installedAt,
    daysInService: t => daysInService(t.installedAt, t.removedAt),
    purchasedAt: t => t.purchasedAt,
    age: t => tireAgeDays(t.purchasedAt),
    supplier: t => supplierName(suppliers, t.supplierId),
  }, (a, b) => b.id - a.id), [tires, sort, suppliers]);

  // Only one row menu open at a time; close on outside click / Escape.
  useEffect(() => {
    if (openMenuId == null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest(".ttp-kebab-root")) setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  if (loading) return <div className="ttp-empty">Đang tải…</div>;
  if (tires.length === 0) return <div className="ttp-empty">{emptyHint}</div>;

  return (
    <div className="record-table-wrap ttp-table-wrap">
      <table className="ttp-table record-table ops-table">
        <colgroup>
          <col className="ttp-col-serial" />
          <col className="ttp-col-position" />
          <col className="ttp-col-size" />
          <col className="ttp-col-installed" />
          <col className="ttp-col-days" />
          <col className="ttp-col-purchased" />
          <col className="ttp-col-age" />
          <col className="ttp-col-supplier" />
          <col className="ttp-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="Serial" sortKey="serial" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Vị trí" sortKey="position" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Kích cỡ" sortKey="size" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Ngày lắp" sortKey="installedAt" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Số ngày chạy" sortKey="daysInService" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Ngày mua" sortKey="purchasedAt" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Tuổi lốp" sortKey="age" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Nhà cung cấp" sortKey="supplier" sort={sort} onSortChange={handleSort} />
            <th className="ttp-actions-heading" aria-label="Tác vụ"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, index) => {
            const days = daysInService(t.installedAt, t.removedAt);
            const age = tireAgeDays(t.purchasedAt);
            return (
              <tr key={t.id}>
                <td className="ttp-serial" data-label="Serial">
                  <StatusStrip color={TIRE_STATUS_COLORS[t.status]} />
                  {t.serial}
                </td>
                <td data-label="Vị trí">{displayTirePosition(t)}</td>
                <td data-label="Kích cỡ">{t.size || "—"}</td>
                <td data-label="Ngày lắp">{t.installedAt || "—"}</td>
                <td data-label="Số ngày chạy">{days == null ? "—" : `${days} ngày`}</td>
                <td data-label="Ngày mua">{t.purchasedAt || "—"}</td>
                <td data-label="Tuổi lốp">{age == null ? "—" : `${age} ngày`}</td>
                <td className="ttp-supplier" data-label="Nhà cung cấp">
                  {supplierName(suppliers, t.supplierId)}
                </td>
                <td className="ttp-row-actions record-table__action" data-label="">
                  <TireRowActions tire={t} index={index} total={sorted.length} open={openMenuId === t.id} onOpenChange={(o) => setOpenMenuId(o ? t.id : null)} busy={busy} oninstall={oninstall} ontransfer={ontransfer} onunmount={onunmount} onedit={onedit} ondelete={ondelete} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Per-row 3-dot (kebab) action menu. The trigger is icon-only (the universal
 * "more" affordance); every item inside carries a Vietnamese label + icon so the
 * action is unambiguous (q2). Items render only when their callback is present,
 * so the same component serves mounted rows (transfer/unmount/edit/delete) and
 * spare rows (install/edit/delete).
 */
function TireRowActions({
  tire,
  index,
  total,
  open,
  onOpenChange,
  busy,
  oninstall,
  ontransfer,
  onunmount,
  onedit,
  ondelete,
}: {
  tire: Tire;
  index: number;
  total: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  oninstall?: (tire: Tire) => void;
  ontransfer?: (tire: Tire) => void;
  onunmount?: (tire: Tire) => void;
  onedit: (tire: Tire) => void;
  ondelete: (tire: Tire) => void;
}) {
  const flipUp = total > 2 && index >= total - 2;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(undefined);
      return;
    }

    const updateMenuPosition = () => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;

      const triggerRect = root.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 4;
      const viewportPadding = 8;
      const preferredTop = flipUp ? triggerRect.top - menuRect.height - gap : triggerRect.bottom + gap;
      const fallbackTop = flipUp ? triggerRect.bottom + gap : triggerRect.top - menuRect.height - gap;
      const preferredFits = preferredTop >= viewportPadding && preferredTop + menuRect.height <= window.innerHeight - viewportPadding;
      const rawTop = preferredFits ? preferredTop : fallbackTop;
      const maxLeft = window.innerWidth - menuRect.width - viewportPadding;

      setMenuStyle({
        top: Math.max(viewportPadding, Math.min(rawTop, window.innerHeight - menuRect.height - viewportPadding)),
        left: Math.max(viewportPadding, Math.min(triggerRect.right - menuRect.width, maxLeft)),
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
  }, [flipUp, open]);

  const run = (fn: (tire: Tire) => void) => {
    onOpenChange(false);
    fn(tire);
  };

  return (
    <div ref={rootRef} className={`ttp-kebab-root ${open ? "is-open" : ""}`}>
      <button type="button" className={`ttp-kebab ${open ? "is-active" : ""}`} onClick={() => onOpenChange(!open)} disabled={busy} title="Thao tác" aria-label={open ? "Đóng menu thao tác" : `Thao tác với lốp ${tire.serial}`} aria-haspopup="menu" aria-expanded={open}>
        <MoreVertical size={15} />
      </button>
      {open && (
        <div ref={menuRef} className="ttp-kebab__menu" role="menu" style={menuStyle ?? { visibility: "hidden" }}>
          {oninstall && (
            <button type="button" className="ttp-kebab__item" role="menuitem" disabled={busy} onClick={() => run(oninstall)}>
              <ArrowUpToLine size={14} />
              Lắp lốp lên xe
            </button>
          )}
          {ontransfer && (
            <button type="button" className="ttp-kebab__item" role="menuitem" disabled={busy} onClick={() => run(ontransfer)}>
              <ArrowLeftRight size={14} />
              Chuyển sang xe khác
            </button>
          )}
          {onunmount && (
            <button type="button" className="ttp-kebab__item" role="menuitem" disabled={busy} onClick={() => run(onunmount)}>
              <ArrowDownToLine size={14} />
              Tháo lốp
            </button>
          )}
          <button type="button" className="ttp-kebab__item" role="menuitem" disabled={busy} onClick={() => run(onedit)}>
            <Pencil size={14} />
            Sửa
          </button>
          <button type="button" className="ttp-kebab__item ttp-kebab__item--danger" role="menuitem" disabled={busy} onClick={() => run(ondelete)}>
            <Trash2 size={14} />
            Xoá
          </button>
        </div>
      )}
    </div>
  );
}

/** Mount a spare (IN_STOCK) tire onto this vehicle. Position optional but blocked
 *  if another IN_USE tire already fills it. */
export function DisposedTireTable({ tires, suppliers }: { tires: Tire[]; suppliers: Supplier[] }) {
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const sorted = useMemo(() => sortClientSide(tires, sort, {
    serial: t => t.serial,
    size: t => t.size,
    purchasedAt: t => t.purchasedAt,
    age: t => daysBetween(t.purchasedAt, t.disposalDate),
    supplier: t => supplierName(suppliers, t.supplierId),
    disposalReason: t => t.disposalReason,
    disposalDate: t => t.disposalDate,
  }, (a, b) => b.id - a.id), [tires, sort, suppliers]);
  return (
    <div className="record-table-wrap ttp-table-wrap">
      <table className="ttp-table ttp-table--disposed record-table ops-table">
        <colgroup>
          <col className="ttp-col-serial" />
          <col className="ttp-col-size" />
          <col className="ttp-col-purchased" />
          <col className="ttp-col-age" />
          <col className="ttp-col-supplier" />
          <col className="ttp-col-disposal" />
          <col className="ttp-col-disposal-date" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="Serial" sortKey="serial" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Kích cỡ" sortKey="size" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Ngày mua" sortKey="purchasedAt" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Tuổi lốp" sortKey="age" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Nhà cung cấp" sortKey="supplier" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Lý do thanh lý" sortKey="disposalReason" sort={sort} onSortChange={handleSort} />
            <SortHeader label="Ngày thanh lý" sortKey="disposalDate" sort={sort} onSortChange={handleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            // Age frozen at disposal — a scrapped tire's age shouldn't keep climbing daily.
            const age = daysBetween(t.purchasedAt, t.disposalDate);
            return (
              <tr key={t.id} className="ttp-row-disposed">
                <td className="ttp-serial" data-label="Serial">
                  <StatusStrip color={TIRE_STATUS_COLORS.DISPOSED} />
                  {t.serial}
                </td>
                <td data-label="Kích cỡ">{t.size || "—"}</td>
                <td data-label="Ngày mua">{t.purchasedAt || "—"}</td>
                <td data-label="Tuổi lốp">{age == null ? "—" : `${age} ngày`}</td>
                <td className="ttp-supplier" data-label="Nhà cung cấp">
                  {supplierName(suppliers, t.supplierId)}
                </td>
                <td data-label="Lý do thanh lý">{t.disposalReason || "—"}</td>
                <td data-label="Ngày thanh lý">{t.disposalDate || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
