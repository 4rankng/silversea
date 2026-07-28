import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";
import type { Tire } from "@tingting/shared";
import { ConfirmDialog } from "../components/UI";
import { AssetIcon } from "../components/AssetIcon";
import { StatusSwatch } from "../components/shared/StatusStrip";
import { useToast } from "../components/shared/Toast";
import { formatErrorMessage } from "../lib/api";
import { routes } from "../lib/routes";
import { useBackShortcut } from "../hooks/useBackShortcut";
import { buildPositionLabels, buildUsedPositionLabels, normalizedCatalogLabel, todayISO } from "../features/tires/tireUtils";
import { useTires, useCreateTire, useUpdateTire, useDeleteTire, useInstallTire, useRemoveTire, useDisposeTire, useTransferTire } from "../hooks/useTireQueries";
import { useAllSuppliers, useCreateTirePosition, useDeleteTirePosition, useTirePositions, useTrailers, useTrucksAndDrivers, useUpdateTirePosition } from "../hooks/useCatalogQueries";
import "./TruckTiresPage.css";

type VehicleKind = "truck" | "trailer";

const TIRE_STATUS_COLORS: Record<Tire["status"], string> = {
  IN_USE: "#16A34A",
  IN_STOCK: "#2563EB",
  DISPOSED: "#9CA3AF",
};

const TIRE_STATUS_LEGEND: { status: Tire["status"]; label: string }[] = [
  { status: "IN_USE", label: "Đang lắp trên xe" },
  { status: "IN_STOCK", label: "Lốp dự phòng" },
  { status: "DISPOSED", label: "Đã thanh lý" },
];

function TireLegend() {
  return (
    <div className="ttp-legend" aria-label="Chú giải trạng thái lốp">
      {TIRE_STATUS_LEGEND.map((item) => (
        <span key={item.status} className="ttp-legend-item">
          <StatusSwatch color={TIRE_STATUS_COLORS[item.status]} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * N1 — per-vehicle tire management page.
 *
 * Mounted on /fleet/:id/tires (truck) and /fleet/trailers/:id/tires (rơ-moóc).
 * Lists the vehicle's mounted tires (serial, position, size, installed, days in
 * service, purchase date, tire age, supplier) with an inline add form, a spare
 * pool, and a disposal (thanh lý) flow: tháo lốp → chọn giữ dự phòng hoặc thanh
 * lý kèm lý do.
 */
export default function TruckTiresPage({ vehicle = "truck" }: { vehicle?: VehicleKind } = {}) {
  const params = useParams<{ id: string }>();
  const vehicleId = Number(params.id);
  const isTruck = vehicle === "truck";
  const vehicleNoun = isTruck ? "xe" : "rơ-moóc";
  const navigate = useNavigate();
  const handleBack = () => navigate(routes.fleet);
  useBackShortcut(handleBack);

  // Trucks are fetched on trailer pages too so the transfer dialog can list
  // every other vehicle as a move target (a mounted trailer tire can go to a truck).
  const { data: trucksDrivers } = useTrucksAndDrivers({ enabled: Number.isFinite(vehicleId) });
  const { data: trailers = [] } = useTrailers();
  const truck = trucksDrivers?.trucks.find((t) => t.id === vehicleId);
  const trailer = trailers.find((t) => t.id === vehicleId);
  const vehicleLabel = isTruck ? (truck?.licensePlate ?? "Lốp xe") : (trailer?.licensePlate ?? "Lốp rơ-moóc");

  // Fetch all tires; filter to this vehicle + stock spares + disposed for read-only tracking.
  const { data: allTires, isLoading } = useTires();
  const { data: suppliers = [] } = useAllSuppliers();
  const { data: tirePositions = [] } = useTirePositions();
  // Derived tire lists + position suggestions. Memoized so opening a dialog or
  // typing in an input doesn't re-scan the whole tire array on every render.
  const { tiresOnVehicle, spares, disposed, positionLabels, usedPositionLabels } = useMemo(() => {
    const all = allTires ?? [];
    return {
      // Mounted = assigned to THIS vehicle. (A tire created via "Thêm lốp" is
      // saved IN_USE, so it lands here and not in the spare pool below.)
      tiresOnVehicle: all.filter((t) => (isTruck ? t.truckId === vehicleId : t.trailerId === vehicleId)),
      // A true warehouse spare is IN_STOCK with no vehicle assignment. The
      // lifecycle keeps IN_STOCK ⟺ no vehicle, so this also keeps a freshly
      // removed tire (IN_STOCK, vehicle nulled) from double-listing.
      spares: all.filter((t) => t.status === "IN_STOCK" && !t.truckId && !t.trailerId),
      disposed: all.filter((t) => t.status === "DISPOSED"),
      positionLabels: buildPositionLabels(all, tirePositions),
      usedPositionLabels: buildUsedPositionLabels(all),
    };
  }, [allTires, tirePositions, vehicleId, isTruck]);

  // Every other truck + trailer, by plate, as a transfer target (excluding the
  // current vehicle so a tire can't be "moved" onto the vehicle it's already on).
  const transferVehicles = useMemo(() => {
    const truckOpts = (trucksDrivers?.trucks ?? []).filter((t) => !(isTruck && t.id === vehicleId)).map((t) => ({ id: t.id, kind: "truck" as const, label: t.licensePlate }));
    const trailerOpts = trailers.filter((t) => !(!isTruck && t.id === vehicleId)).map((t) => ({ id: t.id, kind: "trailer" as const, label: t.licensePlate }));
    return [...truckOpts, ...trailerOpts];
  }, [trucksDrivers, trailers, isTruck, vehicleId]);

  const createMut = useCreateTire();
  const updateMut = useUpdateTire();
  const deleteMut = useDeleteTire();
  const removeMut = useRemoveTire();
  const disposeMut = useDisposeTire();
  const installMut = useInstallTire();
  const transferMut = useTransferTire();
  const createPositionMut = useCreateTirePosition();
  const updatePositionMut = useUpdateTirePosition();
  const deletePositionMut = useDeleteTirePosition();
  const [editingTire, setEditingTire] = useState<Tire | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tire | null>(null);
  const [unmountTarget, setUnmountTarget] = useState<Tire | null>(null);
  const [installTarget, setInstallTarget] = useState<Tire | null>(null);
  const [transferTarget, setTransferTarget] = useState<Tire | null>(null);
  const [positionManagerOpen, setPositionManagerOpen] = useState(false);
  const [positionManagerSelect, setPositionManagerSelect] = useState<((value: string) => void) | null>(null);
  const { toast } = useToast();

  const busy = updateMut.isPending || deleteMut.isPending || removeMut.isPending || disposeMut.isPending || installMut.isPending || transferMut.isPending;
  const positionBusy = createPositionMut.isPending || updatePositionMut.isPending || deletePositionMut.isPending;

  const syncUsedPositionsToCatalog = async () => {
    const catalogNames = new Set(tirePositions.map((position) => normalizedCatalogLabel(position.name)));
    const missingLabels = usedPositionLabels.filter((label) => !catalogNames.has(normalizedCatalogLabel(label)));
    let nextSortOrder = computeNextSortOrder(tirePositions);

    for (const label of missingLabels) {
      try {
        await createPositionMut.mutateAsync({
          name: label,
          sortOrder: nextSortOrder,
          status: "ACTIVE",
        });
      } catch (error) {
        console.error("Không thể đồng bộ vị trí lốp đã dùng vào danh mục", error);
      }
      nextSortOrder += 10;
    }
  };

  const openPositionManager = (onSelect?: (value: string) => void) => {
    setPositionManagerSelect(() => onSelect ?? null);
    setPositionManagerOpen(true);
    void syncUsedPositionsToCatalog();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteMut.mutateAsync(target.id);
      toast({ kind: "success", message: "Đã xóa lốp." });
    } catch (err) {
      toast({ kind: "error", message: formatErrorMessage(err) });
    }
  };

  return (
    <div className="ttp">
      <div className="ttp-header">
        <div>
          <Link to={routes.fleet} className="ttp-back">
            <ArrowLeft size={14} />
            Quay lại đội xe
          </Link>
          <h1 style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <AssetIcon name="tire" size={32} />
            {vehicleLabel}
          </h1>
          <div className="ttp-sub">Theo dõi serial lốp, vị trí lắp, ngày mua, tuổi lốp, nhà cung cấp và thanh lý lốp cũ.</div>
        </div>
      </div>

      <div className="ttp-workbench">
        <section className="ttp-panel ttp-panel--form" aria-labelledby="ttp-add-title">
          <div className="ttp-section-head">
            <div>
              <h2 id="ttp-add-title">Thêm lốp</h2>
              <p>Nhập serial và thông tin chính cho {vehicleNoun} này.</p>
            </div>
            <button type="button" className="ttp-tool-btn" onClick={() => openPositionManager()}>
              <Settings2 size={15} />
              Vị trí lốp
            </button>
          </div>
          <AddTireForm
            positionLabels={positionLabels}
            suppliers={suppliers}
            saving={createMut.isPending}
            onManagePositions={openPositionManager}
            onsave={async (d) => {
              try {
                await createMut.mutateAsync({
                  ...d,
                  status: "IN_USE",
                  installedAt: todayISO(),
                  ...(isTruck ? { truckId: vehicleId } : { trailerId: vehicleId }),
                });
                toast({ kind: "success", message: "Đã thêm lốp thành công" });
              } catch (err) {
                toast({ kind: "error", message: formatErrorMessage(err) });
                throw err;
              }
            }}
          />
        </section>

        <section className="ttp-panel ttp-panel--table" aria-labelledby="ttp-mounted-title">
          <div className="ttp-section-head">
            <div>
              <h2 id="ttp-mounted-title">Lốp đang lắp trên {vehicleNoun}</h2>
              <p>{tiresOnVehicle.length} lốp đang theo dõi</p>
            </div>
            <TireLegend />
          </div>
          <TireTable tires={tiresOnVehicle} suppliers={suppliers} loading={isLoading} emptyHint={`Chưa có lốp nào được lắp trên ${vehicleNoun} này.`} busy={busy} onedit={setEditingTire} ondelete={setDeleteTarget} onunmount={setUnmountTarget} ontransfer={setTransferTarget} />
        </section>
      </div>

      {spares.length > 0 && (
        <section className="ttp-panel ttp-spares" aria-labelledby="ttp-spares-title">
          <div className="ttp-section-head">
            <div>
              <h2 id="ttp-spares-title">Lốp dự phòng trong kho</h2>
              <p>{spares.length} lốp có thể lắp lên phương tiện</p>
            </div>
            <TireLegend />
          </div>
          <TireTable tires={spares} suppliers={suppliers} loading={isLoading} emptyHint="Không có lốp kho." busy={busy} onedit={setEditingTire} ondelete={setDeleteTarget} oninstall={setInstallTarget} />
        </section>
      )}

      {disposed.length > 0 && (
        <section className="ttp-panel ttp-disposed" aria-labelledby="ttp-disposed-title">
          <div className="ttp-section-head">
            <div>
              <h2 id="ttp-disposed-title">Đã thanh lý</h2>
              <p>{disposed.length} lốp đã đưa ra khỏi sử dụng</p>
            </div>
          </div>
          <DisposedTireTable tires={disposed} suppliers={suppliers} />
        </section>
      )}

      {editingTire && (
        <TireEditDialog
          key={editingTire.id}
          tire={editingTire}
          suppliers={suppliers}
          positionLabels={positionLabels}
          saving={updateMut.isPending}
          onManagePositions={openPositionManager}
          oncancel={() => setEditingTire(null)}
          onsave={async (patch) => {
            try {
              await updateMut.mutateAsync({ id: editingTire.id, data: patch });
              toast({ kind: "success", message: "Cập nhật lốp thành công" });
              setEditingTire(null);
            } catch (err) {
              toast({ kind: "error", message: formatErrorMessage(err) });
              throw err;
            }
          }}
        />
      )}

      {unmountTarget && (
        <UnmountTireDialog
          key={unmountTarget.id}
          tire={unmountTarget}
          saving={busy}
          oncancel={() => setUnmountTarget(null)}
          onremove={async (id) => {
            try {
              await removeMut.mutateAsync({ id, updatedAt: unmountTarget.updatedAt });
              toast({ kind: "success", message: "Đã tháo lốp về kho" });
              setUnmountTarget(null);
            } catch (err) {
              toast({ kind: "error", message: formatErrorMessage(err) });
            }
          }}
          ondispose={async (id, reason) => {
            try {
              await disposeMut.mutateAsync({ id, reason, updatedAt: unmountTarget.updatedAt });
              toast({ kind: "success", message: "Đã thanh lý lốp" });
              setUnmountTarget(null);
            } catch (err) {
              toast({ kind: "error", message: formatErrorMessage(err) });
            }
          }}
        />
      )}

      {installTarget && (
        <InstallTireDialog
          key={installTarget.id}
          tire={installTarget}
          tires={allTires ?? []}
          isTruck={isTruck}
          vehicleId={vehicleId}
          vehicleLabel={vehicleLabel}
          positionLabels={positionLabels}
          saving={installMut.isPending}
          onManagePositions={openPositionManager}
          oncancel={() => setInstallTarget(null)}
          oninstall={async (payload) => {
            try {
              await installMut.mutateAsync({
                id: installTarget.id,
                updatedAt: installTarget.updatedAt,
                ...payload,
              });
              toast({ kind: "success", message: "Lắp lốp thành công" });
              setInstallTarget(null);
            } catch (err) {
              toast({ kind: "error", message: formatErrorMessage(err) });
            }
          }}
        />
      )}

      {transferTarget && (
        <TransferTireDialog
          key={transferTarget.id}
          tire={transferTarget}
          tires={allTires ?? []}
          vehicles={transferVehicles}
          currentVehicleLabel={vehicleLabel}
          positionLabels={positionLabels}
          saving={transferMut.isPending}
          onManagePositions={openPositionManager}
          oncancel={() => setTransferTarget(null)}
          ontransfer={async (payload) => {
            try {
              await transferMut.mutateAsync({
                id: transferTarget.id,
                updatedAt: transferTarget.updatedAt,
                ...payload,
              });
              toast({ kind: "success", message: "Điều chuyển lốp thành công" });
              setTransferTarget(null);
            } catch (err) {
              toast({ kind: "error", message: formatErrorMessage(err) });
            }
          }}
        />
      )}

      {positionManagerOpen && (
        <TirePositionsManagerDialog
          positions={tirePositions}
          saving={positionBusy}
          onselect={positionManagerSelect ?? undefined}
          oncancel={() => {
            setPositionManagerOpen(false);
            setPositionManagerSelect(null);
          }}
          oncreate={(data) => createPositionMut.mutateAsync(data)}
          onupdate={(id, data) => updatePositionMut.mutateAsync({ id, data })}
          ondelete={(id) => deletePositionMut.mutateAsync(id)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        variant="danger"
        message={deleteTarget ? `Xóa lốp ${deleteTarget.serial}? Hành động này sẽ xóa hẳn lốp khỏi hệ thống.` : ""}
        confirmLabel={deleteMut.isPending ? "Đang xóa…" : "Xóa lốp"}
        cancelLabel="Hủy"
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}


import { AddTireForm, TirePositionsManagerDialog, computeNextSortOrder } from '../features/tires/tire-controls';
import { TireEditDialog, UnmountTireDialog, InstallTireDialog, TransferTireDialog } from '../features/tires/tire-dialogs';
import { TireTable, DisposedTireTable } from '../features/tires/tire-tables';
