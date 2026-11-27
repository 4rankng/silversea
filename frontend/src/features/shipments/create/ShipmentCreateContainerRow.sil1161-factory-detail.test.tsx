// SIL-1161 (KB 10.2.1): the [Chi tiết] affordance beside the ô Nhà máy on
// /shipments/new — it appears only AFTER a factory is picked, opens the
// house details dialog (Địa chỉ, MST… — the existing
// OperationalSiteDetailsDialog, no invented fields), and stays out of the
// way for a Lệnh chạy ngoài typed-only factory (no catalog row, no data).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ShipmentCreateContainerRow, type ShipmentCreateContainerRowProps } from "./ShipmentCreateContainerRow";
import type { ShipmentContainerDraft } from "./shipment-create-model";
import type { CatalogData } from "../../../api/tripClient";
import type { OperationalSite } from "../../../api/shipmentClient";

const FACTORIES = [
  { id: 41, siteType: "FACTORY", code: "ASK-1", shortName: "ASKEY", name: "CÔNG TY ASKEY", address: "KCN Việt Nam - Singapore", routeId: null },
] as unknown as OperationalSite[];

function baseProps(overrides: Partial<ShipmentCreateContainerRowProps> = {}) {
  const row: ShipmentContainerDraft = {
    key: "row-1",
    containerNumber: "TGHU1234567",
    containerTypeId: "1",
    declarationNumber: "",
    routeId: "",
    rawRouteName: "",
    pickupPortId: "",
    dropoffPortId: "",
    rawPickupPortName: "",
    rawDropoffPortName: "",
    cargoWeightKg: "15000",
    cargoVolumeCbm: "",
    customerAppointmentAt: "2026-10-10T08:00:00",
    operationalSiteId: "",
    rawFactoryName: "",
  };
  const props: ShipmentCreateContainerRowProps = {
    row,
    index: 0,
    containersLength: 1,
    catalogs: {
      routes: [],
      ports: [],
    } as unknown as CatalogData,
    operationalSites: FACTORIES,
    onDuplicate: vi.fn(),
    updateContainer: vi.fn(),
    removeContainer: vi.fn(),
    selectContainerFactory: vi.fn(),
    containerFactoryCustomText: vi.fn(),
    containerRouteCustomText: vi.fn(),
    portCustomText: vi.fn(),
    setRouteDialogTargetKey: vi.fn(),
    setRouteDialogInitialName: vi.fn(),
    setRouteDialogOpen: vi.fn(),
    setPortDialog: vi.fn(),
    issueByField: new Map(),
    isAdHoc: false,
    customerId: "1",
    sitesLoading: false,
    onAddFactory: vi.fn(),
    saving: false,
    routeOptions: [],
    portOptions: [],
    ...overrides,
  };
  return { props };
}

function FactoryRow({ initialSiteId = "", isAdHoc = false }: { initialSiteId?: string; isAdHoc?: boolean }) {
  const [operationalSiteId, setOperationalSiteId] = useState(initialSiteId);
  const openDetail = vi.fn();
  const { props } = baseProps({ operationalSites: FACTORIES, customerId: isAdHoc ? "" : "1", isAdHoc, onOpenFactoryDetail: openDetail });
  return (
    <table>
      <tbody>
        <ShipmentCreateContainerRow
          {...props}
          row={{ ...props.row, operationalSiteId }}
          selectContainerFactory={(_, value) => setOperationalSiteId(value)}
        />
      </tbody>
    </table>
  );
}

describe("ShipmentCreateContainerRow factory detail affordance (SIL-1161)", () => {
  it("renders no Chi tiết button before a factory is picked", () => {
    render(<FactoryRow />);
    const cell = document.querySelector("td[data-field-id$='-factory']") as HTMLElement;
    expect(within(cell).queryByRole("button", { name: /Xem chi tiết nhà máy/ })).toBeNull();
  });

  it("shows the Chi tiết button once the factory is picked, inside its cell", async () => {
    render(<FactoryRow initialSiteId="41" />);
    const cell = document.querySelector("td[data-field-id$='-factory']") as HTMLElement;
    const button = within(cell).getByRole("button", { name: /Xem chi tiết nhà máy/ });
    expect(button).toBeTruthy();
    expect(button.closest("td")).toBe(cell);
  });

  it("opens the details dialog through the workspace handler on click", async () => {
    const onOpenFactoryDetail = vi.fn();
    const { props } = baseProps({ onOpenFactoryDetail });
    render(
      <table>
        <tbody>
          <ShipmentCreateContainerRow {...props} row={{ ...props.row, operationalSiteId: "41" }} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Xem chi tiết nhà máy/ }));
    expect(onOpenFactoryDetail).toHaveBeenCalledWith(FACTORIES[0]);
    expect(onOpenFactoryDetail).toHaveBeenCalledTimes(1);
  });
});
