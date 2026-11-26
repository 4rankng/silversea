import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { ShipmentCreateContainerRow, type ShipmentCreateContainerRowProps } from "./ShipmentCreateContainerRow";
import type { ShipmentContainerDraft } from "./shipment-create-model";
import type { CatalogData } from "../../../api/tripClient";
import type { OperationalSite } from "../../../api/shipmentClient";

/**
 * SIL-1077 — KB Ch.3 §3.1.6 on the create-shipment factory picker:
 * a customer with NO factories must see WHY the list is empty
 * ("Khách hàng này chưa có nhà máy — thêm nhà máy cho khách hàng trước"),
 * not the failed-search line "Không tìm thấy kết quả". The explanation must
 * never leak another customer's factories (the picker's options are already
 * scoped to the chosen customer) and the "+ Thêm nhà máy..." quick-add must
 * stay reachable. An unmatched keyword over a NON-empty catalog keeps the
 * no-results wording (SIL-948 law, pinned in sil948-factory-hints.test).
 */

const EMPTY_CATALOG_EXPLANATION = "Khách hàng này chưa có nhà máy — thêm nhà máy cho khách hàng trước";

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
      routes: [{ id: 11, name: "Cát Lái - Sóng Thần" }],
      ports: [{ id: 1, name: "Cảng Hải Phòng" }],
    } as unknown as CatalogData,
    operationalSites: [],
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
    customerId: "61",
    sitesLoading: false,
    onAddFactory: vi.fn(),
    saving: false,
    routeOptions: [{ value: "11", label: "Cát Lái - Sóng Thần" }],
    portOptions: [{ value: "1", label: "Cảng Hải Phòng" }],
    ...overrides,
  };

  return { props };
}

const ONE_FACTORY = [
  { id: 41, siteType: "FACTORY", code: "ASK-1", shortName: "ASKEY", name: "CÔNG TY ASKEY", address: "", routeId: 11 },
] as unknown as OperationalSite[];

function FactoryRow(props: Partial<ShipmentCreateContainerRowProps> = {}) {
  const [operationalSiteId, setOperationalSiteId] = useState("");
  const { props: base } = baseProps(props);
  return (
    <table>
      <tbody>
        <ShipmentCreateContainerRow
          {...base}
          row={{ ...base.row, operationalSiteId }}
          selectContainerFactory={(_, value) => setOperationalSiteId(value)}
        />
      </tbody>
    </table>
  );
}

async function openFactoryMenu() {
  const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
  input.focus();
  fireEvent.click(input);
  return input;
}

describe("ShipmentCreateContainerRow factory picker empty catalog (SIL-1077)", () => {
  it("a customer with 0 factories sees the business explanation, not a failed-search line", async () => {
    render(<FactoryRow operationalSites={[]} sitesLoading={false} />);
    await openFactoryMenu();

    expect(await screen.findByText(EMPTY_CATALOG_EXPLANATION)).toBeTruthy();
    expect(screen.queryByText("Không tìm thấy kết quả")).toBeNull();

    // The explanation row is inert (never picked) and the quick-add footer
    // stays the actionable path below it.
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent?.trim() ?? "");
    expect(labels[labels.length - 1]).toBe("+ Thêm nhà máy...");
    const explanationRow = screen.getByRole("option", { name: EMPTY_CATALOG_EXPLANATION });
    expect(explanationRow).toHaveAttribute("aria-disabled", "true");
  });

  it("the quick-add footer still opens the factory dialog on an empty catalog", async () => {
    const onAddFactory = vi.fn();
    render(<FactoryRow operationalSites={[]} sitesLoading={false} onAddFactory={onAddFactory} />);
    await openFactoryMenu();

    fireEvent.click(await screen.findByRole("option", { name: "+ Thêm nhà máy..." }));
    expect(onAddFactory).toHaveBeenCalledTimes(1);
  });

  it("a non-empty catalog never shows the empty-catalog explanation", async () => {
    render(<FactoryRow operationalSites={ONE_FACTORY} />);
    const input = await openFactoryMenu();
    fireEvent.change(input, { target: { value: "ZZZQQQ" } });

    expect(await screen.findByText("Không tìm thấy kết quả")).toBeTruthy();
    expect(screen.queryByText(EMPTY_CATALOG_EXPLANATION)).toBeNull();
    // The other customer's factories must not leak into the list either.
    expect(screen.queryByRole("option", { name: "ASKEY" })).toBeNull();
  });
});
