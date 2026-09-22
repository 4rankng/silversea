import { useState, memo } from "react";
import { UserRoundCheck, Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { ListFilterBar } from "../../components/ListFilterBar";
import { Panel, StatusPill, Modal } from "../../components/UI";
import { StatusStrip } from "../../components/shared/StatusStrip";
import { useCRUD } from "../../hooks/useCRUD";
import type { Truck as TruckType, Driver } from "@tingting/shared";

// Extracted form modals + shared fleet constants
import { DriverFormModal, TRUCK_STATUS, DRIVER_STATUS, fleetStyles as styles } from ".";

import "../../pages/FleetPage.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DriverAvatarIcon = memo(function DriverAvatarIcon() {
  return (
    <span className="fleet-avatar" aria-hidden="true">
      <UserRoundCheck size={16} strokeWidth={1.9} />
    </span>
  );
});

const Plate = memo(function Plate({ plate, tag }: { plate: string; tag: string }) {
  return (
    <span className="fleet-plate">
      <span className="fleet-plate-tag">{tag}</span>
      {plate}
    </span>
  );
});

const StatusDot = memo(function StatusDot({ status }: { status: string }) {
  const variant = status === "ACTIVE" ? "success" : status === "MAINTENANCE" ? "warn" : "neutral";
  const label = TRUCK_STATUS[status] || DRIVER_STATUS[status] || status;
  return (
    <StatusPill variant={variant} dot>
      {label}
    </StatusPill>
  );
});

function fleetStatusColor(status: string): string {
  if (status === "ACTIVE") return "#059669";
  if (status === "MAINTENANCE") return "#D97706";
  return "#6B7280";
}

function FleetStatusLegend({ maintenance = true }: { maintenance?: boolean }) {
  return (
    <span className="fleet-status-legend" aria-label="Chú giải trạng thái">
      <span className="fleet-legend-item">
        <span className="fleet-legend-swatch" style={{ background: fleetStatusColor("ACTIVE") }} /> Hoạt động
      </span>
      {maintenance && (
        <span className="fleet-legend-item">
          <span className="fleet-legend-swatch" style={{ background: fleetStatusColor("MAINTENANCE") }} /> Bảo trì
        </span>
      )}
      <span className="fleet-legend-item">
        <span className="fleet-legend-swatch" style={{ background: fleetStatusColor("INACTIVE") }} /> Ngưng
      </span>
    </span>
  );
}

// ─── DetailModal — shared view dialog with edit/delete actions ────────────────

function DetailModal({ isOpen, title, onClose, details, onEdit, onDelete, deleting, itemId }: { isOpen: boolean; title: string; onClose: () => void; details: Array<{ label: string; value: React.ReactNode }>; onEdit: () => void; onDelete?: () => void; deleting: number | null; itemId: number }) {
  const primary = details[0];
  const status = details.find((d) => d.label === "Trạng thái");
  const secondary = details.filter((d, i) => i !== 0 && d.label !== "Trạng thái");

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      maxWidth={620}
      footer={
        <div className="fleet-detail-actions">
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            <X size={14} /> Đóng
          </button>
          <button className="btn btn--primary btn--sm" onClick={onEdit}>
            <Pencil size={13} /> Sửa
          </button>
          {onDelete && (
            <button className="btn btn--ghost btn--sm" style={{ color: "var(--danger)" }} disabled={deleting === itemId} onClick={onDelete}>
              {deleting === itemId ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              Xóa
            </button>
          )}
        </div>
      }
    >
      <div className="fleet-detail">
        {primary && (
          <div className="fleet-detail__hero">
            <div className="fleet-detail__identity">
              <div className="fleet-detail__label">{primary.label}</div>
              <div className="fleet-detail__primary">{primary.value}</div>
            </div>
            {status && (
              <div className="fleet-detail__status">
                <div className="fleet-detail__label">Trạng thái</div>
                <div>{status.value}</div>
              </div>
            )}
          </div>
        )}

        <div className="fleet-detail__grid">
          {secondary.map((d, i) => (
            <div className={`fleet-detail__item${d.label === "Lốp" ? " fleet-detail__item--wide" : ""}`} key={`${d.label}-${i}`}>
              <div className="fleet-detail__label">{d.label}</div>
              <div className="fleet-detail__value">{d.value}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── TrailerCard ────────────────────────────────────────────────────────────

export function DriverCard({ drivers, truckMap, crud }: { drivers: Driver[]; truckMap: Map<number, TruckType>; crud: ReturnType<typeof useCRUD> }) {
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [driverSearch, setDriverSearch] = useState("");
  const totalSalary = drivers.reduce((s, d) => s + (d.baseSalary ? Number(d.baseSalary) : 0), 0);
  const unassigned = drivers.filter((d) => !d.assignedTruckId).length;
  const q = driverSearch.trim().toLowerCase();
  const filteredDrivers = q ? drivers.filter((d) => d.name.toLowerCase().includes(q) || (d.phone && d.phone.includes(q))) : drivers;

  return (
    <Panel flush>
      <div className="fleet-card-head">
        <div className="fleet-card-lead">
          <div className="fleet-card-icon">
            <UserRoundCheck size={18} />
          </div>
          <div>
            <div className="fleet-card-title">
              Lái xe <span className="count-pill">{drivers.length}</span>
            </div>
            <div className="fleet-card-sub">Nhân sự lái xe, lương cơ bản và phân công xe</div>
          </div>
        </div>
        <div className="fleet-card-tools">
          <button className="btn btn--primary btn--sm" onClick={() => crud.setShowAddForm(true)}>
            <Plus size={13} /> Thêm lái xe
          </button>
        </div>
      </div>
      {/* Shared filter-bar contract: the driver view's hand-rolled mini-search
          cuts over to the one shared bar; filter behavior is unchanged
          (case-insensitive name/phone substring on the trimmed query). */}
      <ListFilterBar
        search={{
          value: driverSearch,
          onChange: setDriverSearch,
          placeholder: "Tìm tên hoặc SĐT…",
          ariaLabel: "Tìm lái xe theo tên hoặc số điện thoại",
        }}
      />
      <div className="desktop-only">
        <div className="table-scroll">
          <table className="tt-table">
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Tên lái xe</th>
                <th>SĐT</th>
                <th>Xe phân công</th>
                <th>Lương CB</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={5} style={styles.emptyRow}>
                    Chưa có dữ liệu
                  </td>
                </tr>
              )}
              {filteredDrivers.map((d, i) => (
                <tr
                  key={d.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => setViewingId(d.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setViewingId(d.id);
                    }
                  }}
                >
                  <td className="num fleet-status-cell">
                    <StatusStrip color={fleetStatusColor(d.status)} />
                    {i + 1}
                  </td>
                  <td>
                    <span className="fleet-assigned">
                      <DriverAvatarIcon />
                      <span className="name">{d.name}</span>
                    </span>
                  </td>
                  <td>
                    <span className="fleet-phone">{d.phone || "—"}</span>
                  </td>
                  <td>{d.assignedTruckId && truckMap.has(d.assignedTruckId) ? <span className="fleet-pair">{truckMap.get(d.assignedTruckId)!.licensePlate}</span> : <span className="fleet-unassigned">— Chưa phân —</span>}</td>
                  <td>
                    {d.baseSalary ? (
                      <span className="fleet-salary">
                        {Number(d.baseSalary).toLocaleString("vi-VN")}
                        <span className="unit">đ</span>
                      </span>
                    ) : (
                      <span className="fleet-salary empty">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <div className="fleet-legend">
            <FleetStatusLegend maintenance={false} />
            <span style={styles.dotSep}>·</span>
            <span>
              Tổng quỹ lương: <strong style={styles.salaryMono}>{totalSalary.toLocaleString("vi-VN")} đ</strong>
            </span>
            {unassigned > 0 && (
              <>
                <span style={styles.dotSep}>·</span>
                <span>{unassigned} lái xe chưa được phân xe</span>
              </>
            )}
          </div>
          <span>
            Hiển thị {filteredDrivers.length}/{drivers.length}
          </span>
        </div>
      </div>
      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {filteredDrivers.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)" }}>Chưa có dữ liệu</div>}
          {filteredDrivers.map((d) => {
            const truck = d.assignedTruckId && truckMap.has(d.assignedTruckId) ? truckMap.get(d.assignedTruckId)! : null;
            return (
              <div
                key={d.id}
                className="m-card fleet-driver-card"
                onClick={() => setViewingId(d.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setViewingId(d.id);
                  }
                }}
              >
                <StatusStrip color={fleetStatusColor(d.status)} />
                <div className="fleet-driver-card__identity">
                  <DriverAvatarIcon />
                  <div className="fleet-driver-card__identity-copy">
                    <div className="fleet-driver-card__name">{d.name}</div>
                    {d.phone && (
                      <div className="fleet-driver-card__phone">{d.phone}</div>
                    )}
                  </div>
                </div>
                <div className="m-card__row">
                  <span className="m-card__row-label">Xe phân công</span>
                  <span className="m-card__row-value">{truck ? truck.licensePlate : "— Chưa phân —"}</span>
                </div>
                {d.baseSalary ? (
                  <div className="m-card__row">
                    <span className="m-card__row-label">Lương CB</span>
                    <span className="m-card__row-value">{Number(d.baseSalary).toLocaleString("vi-VN")} đ</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="table-foot">
          <div className="fleet-legend">
            <FleetStatusLegend maintenance={false} />
            <span style={styles.dotSep}>·</span>
            <span>
              Tổng quỹ lương: <strong style={styles.salaryMono}>{totalSalary.toLocaleString("vi-VN")} đ</strong>
            </span>
            {unassigned > 0 && (
              <>
                <span style={styles.dotSep}>·</span>
                <span>{unassigned} lái xe chưa được phân xe</span>
              </>
            )}
          </div>
          <span>
            Hiển thị {filteredDrivers.length}/{drivers.length}
          </span>
        </div>
      </div>
      {crud.error && <div style={styles.errorBanner}>{crud.error}</div>}
      <DetailModal
        isOpen={viewingId != null}
        title="Lái xe"
        onClose={() => setViewingId(null)}
        itemId={viewingId ?? 0}
        deleting={crud.deleting}
        onEdit={() => {
          const id = viewingId;
          setViewingId(null);
          if (id != null) crud.setEditingId(id);
        }}
        details={(() => {
          const d = viewingId != null ? drivers.find((x) => x.id === viewingId) : null;
          if (!d) return [];
          const truck = d.assignedTruckId && truckMap.has(d.assignedTruckId) ? truckMap.get(d.assignedTruckId)! : null;
          return [
            {
              label: "Họ và tên",
              value: (
                <span className="fleet-assigned">
                  <DriverAvatarIcon />
                  <span className="name">{d.name}</span>
                </span>
              ),
            },
            { label: "Số điện thoại", value: d.phone || "—" },
            { label: "Xe phân công", value: truck ? <Plate plate={truck.licensePlate} tag="VN" /> : <span className="fleet-unassigned">— Chưa phân —</span> },
            {
              label: "Lương cơ bản",
              value: d.baseSalary ? (
                <span className="fleet-salary">
                  {Number(d.baseSalary).toLocaleString("vi-VN")}
                  <span className="unit">đ</span>
                </span>
              ) : (
                <span className="fleet-salary empty">—</span>
              ),
            },
            { label: "Trạng thái", value: <StatusDot status={d.status} /> },
          ];
        })()}
      />
      <DriverFormModal
        key={crud.editingId ?? (crud.showAddForm ? "add" : "closed")}
        isOpen={crud.showAddForm || crud.editingId != null}
        saving={crud.saving}
        item={crud.editingId != null ? drivers.find((d) => d.id === crud.editingId) : undefined}
        onsave={(dd) => {
          if (crud.editingId != null) crud.doUpdate(crud.editingId, dd);
          else crud.doCreate(dd);
        }}
        oncancel={crud.cancelForm}
      />
    </Panel>
  );
}
