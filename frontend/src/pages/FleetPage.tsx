import { useCallback, useMemo } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Truck, Container, UserCheck, Download, CheckCircle } from "lucide-react";
import { downloadCSV } from "../lib/csv";
import { PageHeader, Btn, KPI } from "../components/UI";
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { useCRUD } from "../hooks/useCRUD";
import { useTrucksAndDrivers } from "../hooks/useCatalogQueries";
import { usePageAnimations } from "../hooks/animations";
import { configClient } from "../api/configClient";
import { qk } from "../api/keys";
import { TrailerType } from "@tingting/shared";
import type { Truck as TruckType, Driver } from "@tingting/shared";

// Extracted form modals + shared fleet constants
import { TRUCK_STATUS } from "../features/fleet";

import "./FleetPage.css";

import { TrailerCard } from '../features/fleet/trailer-card';
import { TruckCard } from '../features/fleet/truck-card';
import { DriverCard } from '../features/fleet/driver-card';

export default function FleetPage() {
  const queryClient = useQueryClient();
  const { rootRef } = usePageAnimations({ ready: true });
  const { data: fleetData } = useTrucksAndDrivers();
  const { data: trailers = [] } = useQuery({
    queryKey: qk.catalogs.trailers,
    queryFn: () => configClient.getTrailers(),
    staleTime: 60_000,
  });
  const trucks = useMemo(() => fleetData?.trucks ?? [], [fleetData?.trucks]);
  const drivers = useMemo(() => fleetData?.drivers ?? [], [fleetData?.drivers]);

  const invalidateFleet = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.catalogs.trucksDrivers });
  }, [queryClient]);

  const truckCrud = useCRUD("/trucks", invalidateFleet);
  const driverCrud = useCRUD("/drivers", invalidateFleet);
  // Trailers are a separate catalog so a rơ-moóc can be coupled to different
  // đầu kéo over time. Invalidate both the trailers list AND fleet (since
  // the truck rows display the coupled trailer's plate).
  const trailerCrud = useCRUD("/trailers", async () => {
    await queryClient.invalidateQueries({ queryKey: qk.catalogs.trailers });
    await invalidateFleet();
  });

  const { truckMap, driverByTruck, activeTrucks, maintTrucks, assignedDrivers, activeDrivers, readyToRun } = useMemo(() => {
    const truckMap = new Map<number, TruckType>();
    trucks.forEach((t) => truckMap.set(t.id, t));

    const driverByTruck = new Map<number, Driver>();
    drivers.forEach((d) => {
      if (d.assignedTruckId) driverByTruck.set(d.assignedTruckId, d);
    });

    const activeTrucks = trucks.filter((t) => t.status === "ACTIVE").length;
    const maintTrucks = trucks.filter((t) => t.status === "MAINTENANCE").length;
    const assignedDrivers = drivers.filter((d) => d.assignedTruckId).length;
    const activeDrivers = drivers.filter((d) => d.status === "ACTIVE").length;
    const readyToRun = trucks.filter((t) => t.status === "ACTIVE" && driverByTruck.has(t.id)).length;

    return { truckMap, driverByTruck, activeTrucks, maintTrucks, assignedDrivers, activeDrivers, readyToRun };
  }, [trucks, drivers]);

  const ft40 = trailers.filter((t) => t.type === TrailerType.FT40).length;
  const ft20 = trailers.filter((t) => t.type === TrailerType.FT20).length;

  return (
    <div className="fleet-page" ref={rootRef}>
      <Breadcrumbs
        className="fleet-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Đội xe' },
        ]}
      />
      <PageHeader
        title="Đội xe"
        iconName="tractor-head"
        description="Quản lý xe đầu kéo, rơ-moóc và lái xe trong một trang"
        action={
          <div className="fleet-action-row">
            <Btn
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              onClick={async () => {
                const headers = ["Loại", "Biển số", "Trạng thái", "Lái xe gán"];
                const rows = [...trucks.map((t) => ["Xe đầu kéo", t.licensePlate, TRUCK_STATUS[t.status] || t.status, driverByTruck.has(t.id) ? driverByTruck.get(t.id)!.name : "—"])];
                await downloadCSV(`doi-xe-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
                  title: "DANH SÁCH ĐỘI XE",
                  subtitle: `${trucks.length} xe đầu kéo đang quản lý`,
                  columnTypes: ["text", "text", "text", "text"],
                  hideTotals: true,
                });
              }}
            >
                Xuất Excel
              </Btn>
            </div>
        }
      />

      {/* KPI Strip */}
      <div className="kpi-grid">
        <KPI
          label="Xe đầu kéo"
          value={trucks.length}
          unit="xe"
          icon={Truck}
          assetIconName="tractor-head"
          variant="success"
          meta={
            <span className="fleet-kpi-meta">
              <span className="fleet-kpi-dot fleet-kpi-dot--success" />
              <span className="fleet-kpi-meta__good">
                {activeTrucks} hoạt động
              </span>
              <span className="fleet-kpi-meta__sep">
                ·
              </span>
              <span className="fleet-kpi-dot fleet-kpi-dot--warn" />
              <span className="fleet-kpi-meta__warn">
                {maintTrucks} bảo trì
              </span>
            </span>
          }
        />
        <KPI
          label="Rơ-moóc"
          value={ft40 + ft20}
          unit="moóc"
          icon={Container}
          assetIconName="semi-trailer"
          variant="info"
          meta={
            <span className="fleet-kpi-meta">
              <span className="fleet-kpi-meta__mono">
                {ft40}×40FT
              </span>
              <span className="fleet-kpi-meta__sep">
                ·
              </span>
              <span className="fleet-kpi-meta__mono">
                {ft20}×20FT
              </span>
            </span>
          }
        />
        <KPI
          label="Lái xe"
          value={activeDrivers}
          unit="người"
          icon={UserCheck}
          assetIconName="driver"
          variant="warn"
          meta={
            <span className="fleet-kpi-meta">
              <span className="fleet-kpi-dot fleet-kpi-dot--success" />
              <span className="fleet-kpi-meta__good">
                {activeDrivers} đang làm
              </span>
              <span className="fleet-kpi-meta__sep">
                ·
              </span>
              <span>
                {assignedDrivers}/{activeDrivers} phân xe
              </span>
            </span>
          }
        />
        <KPI
          label="Sẵn sàng chạy"
          value={readyToRun}
          unit={`/ ${activeTrucks + maintTrucks || trucks.length} đầu kéo`}
          icon={CheckCircle}
          assetIconName="checklist"
          variant="default"
          meta={
            <span className="fleet-kpi-meta">
              {readyToRun >= activeTrucks ? (
                <span className="fleet-kpi-meta__good">
                  Đủ xe + lái xe
                </span>
              ) : (
                <>
                  <span>{readyToRun} sẵn sàng</span>
                  <span className="fleet-kpi-meta__sep">
                    ·
                  </span>
                  <span className="fleet-kpi-meta__warn">
                    {activeTrucks - readyToRun} cần phân xe
                  </span>
                </>
              )}
            </span>
          }
        />
      </div>

      {/* Trucks (đầu kéo) */}
      <TruckCard trucks={trucks} driverByTruck={driverByTruck} trailers={trailers} crud={truckCrud} />

      {/* Trailers (rơ-moóc) — separate catalog so a rơ-moóc can be coupled
          to different đầu kéo over time, and so repair / đăng kiểm / thay
          lốp expenses can be split between truck and trailer. */}
      <TrailerCard trailers={trailers} trucks={trucks} crud={trailerCrud} />

      {/* Drivers */}
      <DriverCard drivers={drivers} truckMap={truckMap} crud={driverCrud} />
    </div>
  );
}
