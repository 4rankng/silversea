import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ShipmentCreateContainerRow, type ShipmentCreateContainerRowProps } from "./ShipmentCreateContainerRow";
import type { ShipmentContainerDraft } from "./shipment-create-model";
import type { CatalogData } from "../../../api/tripClient";

function setup(overrides: Partial<ShipmentCreateContainerRowProps> = {}) {
  const setPortDialog = vi.fn();
  const setRouteDialogOpen = vi.fn();
  const setRouteDialogInitialName = vi.fn();
  const setRouteDialogTargetKey = vi.fn();

  const row: ShipmentContainerDraft = {
    key: "row-1",
    containerNumber: "TGHU1234567",
    containerTypeId: "1",
    routeId: "",
    rawRouteName: "",
    pickupPortId: "",
    dropoffPortId: "",
    rawPickupPortName: "",
    rawDropoffPortName: "",
    cargoWeightKg: "15000",
    cargoVolumeCbm: "",
    customerAppointmentAt: "2026-10-10T08:00:00",
    operationalSiteId: "1",
    rawFactoryName: "",
  };

  const props: ShipmentCreateContainerRowProps = {
    row,
    index: 0,
    containersLength: 1,
    catalogs: {
      routes: [{ id: 1, name: "HP - HN" }],
      ports: [{ id: 1, name: "Cảng Hải Phòng" }],
    } as unknown as CatalogData,
    operationalSites: [],
    emptyAppointmentCount: 0,
    copyAppointmentToEmpty: vi.fn(),
    updateContainer: vi.fn(),
    removeContainer: vi.fn(),
    selectContainerFactory: vi.fn(),
    containerFactoryCustomText: vi.fn(),
    containerRouteCustomText: vi.fn(),
    portCustomText: vi.fn(),
    setRouteDialogTargetKey,
    setRouteDialogInitialName,
    setRouteDialogOpen,
    setPortDialog,
    issueByField: new Map(),
    isAdHoc: false,
    customerId: "1",
    sitesLoading: false,
    saving: false,
    routeOptions: [{ value: "1", label: "HP - HN" }],
    portOptions: [{ value: "1", label: "Cảng Hải Phòng" }],
    ...overrides,
  };

  const utils = render(
    <table>
      <tbody>
        <ShipmentCreateContainerRow {...props} />
      </tbody>
    </table>
  );

  return { ...utils, setPortDialog, setRouteDialogOpen, setRouteDialogInitialName, setRouteDialogTargetKey };
}

describe("ShipmentCreateContainerRow create options (Card 20261009_11)", () => {
  it("opens PortCreateDialog with empty name when clicking ＋ Thêm cảng mới… without typing in pickup port", async () => {
    const { setPortDialog } = setup();
    const pickupInput = screen.getByRole("combobox", { name: "Cảng nâng" });
    fireEvent.click(pickupInput);

    const createOption = await screen.findByRole("option", { name: "＋ Thêm cảng mới…" });
    fireEvent.click(createOption);

    expect(setPortDialog).toHaveBeenCalledWith({
      open: true,
      target: { key: "row-1", field: "pickupPortId", name: "" },
    });
  });

  it("opens PortCreateDialog with empty name when clicking ＋ Thêm cảng mới… without typing in dropoff port", async () => {
    const { setPortDialog } = setup();
    const dropoffInput = screen.getByRole("combobox", { name: "Cảng hạ" });
    fireEvent.click(dropoffInput);

    const createOption = await screen.findByRole("option", { name: "＋ Thêm cảng mới…" });
    fireEvent.click(createOption);

    expect(setPortDialog).toHaveBeenCalledWith({
      open: true,
      target: { key: "row-1", field: "dropoffPortId", name: "" },
    });
  });

  it("opens RouteCreateDialog with empty name when clicking ＋ Thêm tuyến mới… without typing in route", async () => {
    const { setRouteDialogOpen, setRouteDialogInitialName, setRouteDialogTargetKey } = setup();
    const routeInput = screen.getByRole("combobox", { name: "Tuyến đường" });
    fireEvent.click(routeInput);

    const createOption = await screen.findByRole("option", { name: "＋ Thêm tuyến mới…" });
    fireEvent.click(createOption);

    expect(setRouteDialogTargetKey).toHaveBeenCalledWith("row-1");
    expect(setRouteDialogInitialName).toHaveBeenCalledWith("");
    expect(setRouteDialogOpen).toHaveBeenCalledWith(true);
  });
});
