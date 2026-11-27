import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { ShipmentCreateContainerRow, type ShipmentCreateContainerRowProps } from "./ShipmentCreateContainerRow";
import type { ShipmentContainerDraft } from "./shipment-create-model";
import type { CatalogData } from "../../../api/tripClient";
import type { OperationalSite } from "../../../api/shipmentClient";

/**
 * SIL-948 — KB Ch.10 §10.5.2 (MasterDataNhaMay §3.1) on the create-shipment
 * factory picker:
 * 1. an unmatched keyword keeps the dropdown open and says
 *    "Không tìm thấy kết quả" while the "+ Thêm nhà máy..." footer stays;
 * 2. a route auto-filled and locked by the chosen factory carries the short
 *    "Theo nhà máy" note — the disabled gray paint is not the only signal.
 * Already-correct behavior that must survive untouched: "askey" / "xuong"
 * (diacritic-insensitive) still match, and a keyword never creates a factory.
 */

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
    customerId: "1",
    sitesLoading: false,
    onAddFactory: vi.fn(),
    saving: false,
    routeOptions: [{ value: "11", label: "Cát Lái - Sóng Thần" }],
    portOptions: [{ value: "1", label: "Cảng Hải Phòng" }],
    ...overrides,
  };

  return { props };
}

const FACTORIES = [
  { id: 41, siteType: "FACTORY", code: "ASK-1", shortName: "ASKEY", name: "CÔNG TY ASKEY", address: "", routeId: 11 },
  { id: 42, siteType: "FACTORY", code: "QV-1", shortName: "Quế Võ", name: "Nhà máy Xưởng Quế Võ", address: "", routeId: null },
] as unknown as OperationalSite[];

function FactoryRow(props: Partial<ShipmentCreateContainerRowProps> = {}) {
  const [operationalSiteId, setOperationalSiteId] = useState("");
  const { props: base } = baseProps({ operationalSites: FACTORIES, customerId: "1", ...props });
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

describe("ShipmentCreateContainerRow factory picker no-results row (SIL-948)", () => {
  it('an unmatched keyword shows "Không tìm thấy kết quả" and keeps the "+ Thêm nhà máy..." footer last', async () => {
    const onAddFactory = vi.fn();
    render(<FactoryRow onAddFactory={onAddFactory} />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "ZZZQQQ" } });

    expect(await screen.findByText("Không tìm thấy kết quả")).toBeTruthy();
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent?.trim() ?? "");
    expect(labels[labels.length - 1]).toBe("+ Thêm nhà máy...");
    expect(labels.filter((t) => t === "Không tìm thấy kết quả")).toHaveLength(1);

    // The no-results row is informational — it cannot be picked, while the
    // footer below it still opens the quick-add dialog.
    const emptyRow = screen.getByRole("option", { name: "Không tìm thấy kết quả" });
    expect(emptyRow).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(emptyRow);
    expect(onAddFactory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: "+ Thêm nhà máy..." }));
    expect(onAddFactory).toHaveBeenCalledTimes(1);
  });

  it('diacritic-insensitive matches ("askey", "xuong") keep the no-results row away', async () => {
    render(<FactoryRow />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);

    fireEvent.change(input, { target: { value: "xuong" } });
    const xuongOptions = await screen.findAllByRole("option");
    expect(xuongOptions.some((o) => o.textContent?.includes("Quế Võ"))).toBe(true);
    expect(screen.queryByText("Không tìm thấy kết quả")).toBeNull();

    fireEvent.change(input, { target: { value: "askey" } });
    const askeyOptions = await screen.findAllByRole("option");
    expect(askeyOptions.some((o) => o.textContent?.includes("ASKEY"))).toBe(true);
    expect(screen.queryByText("Không tìm thấy kết quả")).toBeNull();
  });
});

describe("ShipmentCreateContainerRow factory-locked route note (SIL-948)", () => {
  it('a factory with a configured route locks the route and labels it "Theo nhà máy"', async () => {
    render(<FactoryRow />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);
    fireEvent.click(await screen.findByRole("option", { name: "ASKEY" }));

    const routeCell = document.querySelector("td[data-field-id$='-route']") as HTMLElement;
    expect(within(routeCell).getByText("Theo nhà máy", { selector: ".csc-container-cell__label-note" })).toBeTruthy();
    expect(within(routeCell).getByRole("combobox", { name: "Tuyến đường" })).toBeDisabled();
  });

  it("a factory without a configured route keeps the route editable with no note (KB §3.2 exception)", async () => {
    render(<FactoryRow />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);
    fireEvent.click(await screen.findByRole("option", { name: "Quế Võ" }));

    const routeCell = document.querySelector("td[data-field-id$='-route']") as HTMLElement;
    expect(within(routeCell).queryByText("Theo nhà máy")).toBeNull();
    expect(within(routeCell).getByRole("combobox", { name: "Tuyến đường" })).toBeEnabled();
  });

  it("with no factory chosen the route locks under the 'Theo nhà máy' note (SIL-1155 / HOT-01)", () => {
    render(<FactoryRow />);
    const routeCell = document.querySelector("td[data-field-id$='-route']") as HTMLElement;
    expect(within(routeCell).getByText("Theo nhà máy", { selector: ".csc-container-cell__label-note" })).toBeTruthy();
    expect(within(routeCell).getByRole("combobox", { name: "Tuyến đường" })).toBeDisabled();
    // SIL-1168: exactly ONE 'Theo nhà máy' in the cell — the label note. The
    // locked picker's placeholder carries no echo (it stacked the same words
    // on two consecutive lines in the empty-locked state).
    expect((routeCell.textContent?.match(/Theo nhà máy/g) ?? []).length).toBe(1);
    expect((within(routeCell).getByRole("combobox", { name: "Tuyến đường" }) as HTMLInputElement).placeholder).toBe("");
  });
});
