import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { ShipmentCreateContainerRow, type ShipmentCreateContainerRowProps } from "./ShipmentCreateContainerRow";
import type { ShipmentContainerDraft } from "./shipment-create-model";
import type { CatalogData } from "../../../api/tripClient";
import type { OperationalSite } from "../../../api/shipmentClient";

function baseProps(overrides: Partial<ShipmentCreateContainerRowProps> = {}) {
  const setPortDialog = vi.fn();
  const setRouteDialogOpen = vi.fn();
  const setRouteDialogInitialName = vi.fn();
  const setRouteDialogTargetKey = vi.fn();

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
    operationalSiteId: "1",
    rawFactoryName: "",
    classification: "SINGLE",
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
    onDuplicate: vi.fn(),
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
    onAddFactory: vi.fn(),
    saving: false,
    routeOptions: [{ value: "1", label: "HP - HN" }],
    portOptions: [{ value: "1", label: "Cảng Hải Phòng" }],
    showClassification: true,
    ...overrides,
  };

  return { props, setPortDialog, setRouteDialogOpen, setRouteDialogInitialName, setRouteDialogTargetKey };
}

function setup(overrides: Partial<ShipmentCreateContainerRowProps> = {}) {
  const { props, ...mocks } = baseProps(overrides);
  const utils = render(
    <table>
      <tbody>
        <ShipmentCreateContainerRow {...props} />
      </tbody>
    </table>
  );

  return { ...utils, ...mocks };
}

describe("ShipmentCreateContainerRow create options (Card 20261009_11)", () => {
  it("opens PortCreateDialog with empty name when clicking + Thêm without typing in pickup port", async () => {
    const { setPortDialog } = setup();
    const pickupInput = screen.getByRole("combobox", { name: "Cảng nâng" });
    fireEvent.click(pickupInput);

    const createOption = await screen.findByRole("option", { name: "+ Thêm" });
    fireEvent.click(createOption);

    expect(setPortDialog).toHaveBeenCalledWith({
      open: true,
      target: { key: "row-1", field: "pickupPortId", name: "" },
    });
  });

  it("opens PortCreateDialog with empty name when clicking + Thêm without typing in dropoff port", async () => {
    const { setPortDialog } = setup();
    const dropoffInput = screen.getByRole("combobox", { name: "Cảng hạ" });
    fireEvent.click(dropoffInput);

    const createOption = await screen.findByRole("option", { name: "+ Thêm" });
    fireEvent.click(createOption);

    expect(setPortDialog).toHaveBeenCalledWith({
      open: true,
      target: { key: "row-1", field: "dropoffPortId", name: "" },
    });
  });

  it("opens RouteCreateDialog with empty name when clicking + Thêm without typing in route", async () => {
    const { setRouteDialogOpen, setRouteDialogInitialName, setRouteDialogTargetKey } = setup();
    const routeInput = screen.getByRole("combobox", { name: "Tuyến đường" });
    fireEvent.click(routeInput);

    const createOption = await screen.findByRole("option", { name: "+ Thêm" });
    fireEvent.click(createOption);

    expect(setRouteDialogTargetKey).toHaveBeenCalledWith("row-1");
    expect(setRouteDialogInitialName).toHaveBeenCalledWith("");
    expect(setRouteDialogOpen).toHaveBeenCalledWith(true);
  });
});

/**
 * SIL-626 (id 730, owner 31/10) — the factory quick-add lives INSIDE the
 * "Nhà máy" picker: a "+ Thêm nhà máy..." footer option (the house
 * createOption pattern, 20260920_26) opens the workspace quick-add dialog
 * through `onAddFactory`. The standalone header button is retired.
 */
describe("ShipmentCreateContainerRow factory dropdown add-new (SIL-626)", () => {
  const FACTORIES = [
    { id: 41, siteType: "FACTORY", code: "ASK-1", shortName: "ASKEY-1", name: "CÔNG TY ASKEY 1", address: "" },
    { id: 42, siteType: "FACTORY", code: "ASK-2", shortName: "ASKEY-2", name: "CÔNG TY ASKEY 2", address: "" },
  ] as unknown as OperationalSite[];

  function FactoryRow({ onAddFactory = vi.fn() }: { onAddFactory?: () => void }) {
    const [operationalSiteId, setOperationalSiteId] = useState("");
    const { props } = baseProps({ operationalSites: FACTORIES, customerId: "1" });
    return (
      <table>
        <tbody>
          <ShipmentCreateContainerRow
            {...props}
            row={{ ...props.row, operationalSiteId }}
            selectContainerFactory={(_, value) => setOperationalSiteId(value)}
            onAddFactory={onAddFactory}
          />
        </tbody>
      </table>
    );
  }

  it("lists '+ Thêm nhà máy...' as the LAST option of the factory dropdown", async () => {
    render(<FactoryRow />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);

    const options = await screen.findAllByRole("option");
    const labels = options.map((o) => o.textContent?.trim() ?? "");
    expect(labels[labels.length - 1]).toBe("+ Thêm nhà máy...");
    expect(labels.filter((t) => t === "+ Thêm nhà máy...")).toHaveLength(1);
  });

  it("opens the quick-add dialog via onAddFactory when the footer option is picked", async () => {
    const onAddFactory = vi.fn();
    render(<FactoryRow onAddFactory={onAddFactory} />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);

    fireEvent.click(await screen.findByRole("option", { name: "+ Thêm nhà máy..." }));
    expect(onAddFactory).toHaveBeenCalledTimes(1);
    // The row only forwards to the workspace gate — no factory value commits.
    const cell = document.querySelector('td[data-field-id$="-factory"]') as HTMLElement;
    expect(cell?.querySelector(".csc-container-cell__display")?.textContent).toBe("Chọn nhà máy");
  });

  it("survives a typed filter — the footer always matches (house createOption law)", async () => {
    render(<FactoryRow />);
    const input = screen.getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "zzz-no-match" } });

    const footer = await screen.findByRole("option", { name: "+ Thêm nhà máy..." });
    expect(footer).toBeTruthy();
  });
});

/**
 * Card 171026113500 (FB-006 verify-fail round 17) — after a pointer pick the
 * "Nhà máy" cell kept the full combobox and its "Xoá" button over the chosen
 * factory name for as long as focus stayed inside the cell. The cell must read
 * as the name + the detail magnifier only: the editor leaves the visible DOM —
 * and the accessibility tree — behind the `--picked` modifier (see
 * ShipmentContainerCell.css), and activating the cell is what brings it back
 * for a re-pick. The row opts the catalog factory cell into that contract;
 * Lệnh chạy ngoài keeps the free-text editor in place.
 */
describe("ShipmentCreateContainerRow factory cell collapse (card 171026113500)", () => {
  const FACTORIES = [
    { id: 41, siteType: "FACTORY", code: "ASK-1", shortName: "ASKEY-1", name: "CÔNG TY ASKEY 1", address: "" },
    { id: 42, siteType: "FACTORY", code: "ASK-2", shortName: "ASKEY-2", name: "CÔNG TY ASKEY 2", address: "" },
  ] as unknown as OperationalSite[];

  function FactoryRow({ initialSiteId = "", isAdHoc = false }: { initialSiteId?: string; isAdHoc?: boolean }) {
    const [operationalSiteId, setOperationalSiteId] = useState(initialSiteId);
    const { props } = baseProps({ operationalSites: FACTORIES, customerId: isAdHoc ? "" : "1", isAdHoc });
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

  async function openFactoryMenu(cell: HTMLElement) {
    const input = within(cell).getByRole("combobox", { name: /^Nhà máy/ });
    input.focus();
    fireEvent.click(input);
    return input;
  }

  it("collapses to the picked name + magnifier right after the pick, focus still inside the cell", async () => {
    render(<FactoryRow />);
    const cell = document.querySelector('td[data-field-id$="-factory"]') as HTMLElement;
    await openFactoryMenu(cell);

    fireEvent.click(await screen.findByRole("option", { name: /ASKEY-1/ }));

    await waitFor(() => expect(cell.querySelector(".csc-container-cell__display")?.textContent).toBe("ASKEY-1"));
    // The collapsed state the stylesheet turns into "editor out of the visible
    // DOM / out of the a11y tree": no revealed combobox, no editing session.
    expect(cell.classList.contains("csc-container-cell--picked")).toBe(true);
    expect(cell.classList.contains("csc-container-cell--editing")).toBe(false);
    expect(cell.querySelector("[role='combobox'][aria-expanded='true']")).toBeNull();
    // Focus is not what decides the collapse: the pick leaves the input
    // focused (no stylesheet in jsdom, so nothing blurs it) and the modifier
    // is set anyway — the state that used to pin the combobox chrome on screen.
    expect(cell.contains(document.activeElement)).toBe(true);
    // SIL-628 (id 732): the detail magnifier is retired — the picked name is
    // the whole cell, and no actions overlay exists anywhere in the table.
    expect(within(cell).queryByRole("button", { name: /Xem chi tiết nhà máy/ })).toBeNull();
    expect(document.querySelector(".csc-container-cell__actions")).toBeNull();
  });

  it("reopens the editor when the collapsed cell is clicked, and re-collapses on the next pick", async () => {
    render(<FactoryRow initialSiteId="41" />);
    const cell = document.querySelector('td[data-field-id$="-factory"]') as HTMLElement;
    expect(cell.classList.contains("csc-container-cell--picked")).toBe(true);
    expect(cell.classList.contains("csc-container-cell--editing")).toBe(false);

    fireEvent.click(cell);

    // Activating the cell reveals the editor (the stylesheet rule) and the
    // shipped click-through focuses + opens the picker, so a re-pick is one
    // pointer away — the collapsed cell is never a dead end.
    await waitFor(() => expect(cell.classList.contains("csc-container-cell--editing")).toBe(true));
    fireEvent.click(await screen.findByRole("option", { name: /ASKEY-2/ }));

    await waitFor(() => expect(cell.querySelector(".csc-container-cell__display")?.textContent).toBe("ASKEY-2"));
    expect(cell.classList.contains("csc-container-cell--picked")).toBe(true);
    expect(cell.classList.contains("csc-container-cell--editing")).toBe(false);
    expect(cell.querySelector("[role='combobox'][aria-expanded='true']")).toBeNull();
  });

  // Clearing stays where the shipped design put it: the combobox's own "Xoá",
  // inside the editor — reachable again once the cell is activated. (While a
  // picker menu is open react-aria hides the cell's other controls from the
  // a11y tree, so the button is asserted with the menu dismissed.)
  it("clears the pick through the combobox's own Xoá once the cell is activated", async () => {
    render(<FactoryRow initialSiteId="41" />);
    const cell = document.querySelector('td[data-field-id$="-factory"]') as HTMLElement;
    fireEvent.click(cell);
    await screen.findByRole("option", { name: /ASKEY-1/ });

    const input = within(cell).getByRole("combobox", { name: /^Nhà máy/ });
    fireEvent.keyDown(input, { key: "Escape" });
    const clear = await waitFor(() => within(cell).getByRole("button", { name: "Xoá" }));
    fireEvent.click(clear);

    await waitFor(() => expect(cell.querySelector(".csc-container-cell__display")?.textContent).toBe("Chọn nhà máy"));
    // The cell is back to an empty picker: the editor belongs to the cell
    // again, and the collapse modifier goes with the value.
    expect(cell.classList.contains("csc-container-cell--picked")).toBe(false);
    expect(cell.classList.contains("csc-container-cell--editing")).toBe(false);
  });

  // An abandoned edit session must not keep the editor in the cell: moving on
  // without picking collapses it again (the value never changed).
  it("drops the edit session when focus leaves the activated cell", async () => {
    render(<FactoryRow initialSiteId="41" />);
    const cell = document.querySelector('td[data-field-id$="-factory"]') as HTMLElement;
    fireEvent.click(cell);
    await waitFor(() => expect(cell.classList.contains("csc-container-cell--editing")).toBe(true));

    fireEvent.blur(within(cell).getByRole("combobox", { name: /^Nhà máy/ }), { relatedTarget: document.body });

    await waitFor(() => expect(cell.classList.contains("csc-container-cell--editing")).toBe(false));
    expect(cell.classList.contains("csc-container-cell--picked")).toBe(true);
    expect(cell.querySelector(".csc-container-cell__display")?.textContent).toBe("ASKEY-1");
  });

  // Non-goal: Lệnh chạy ngoài keeps its free-text editor. The operator types
  // into the field, so the catalog-collapse contract is not opted in and the
  // cell never leaves its editor behind a `--picked` modifier.
  it("leaves the free-text (Lệnh chạy ngoài) factory cell without the collapse contract", async () => {
    render(<FactoryRow initialSiteId="41" isAdHoc />);
    const cell = document.querySelector('td[data-field-id$="-factory"]') as HTMLElement;

    fireEvent.click(cell);

    await waitFor(() => expect(cell.querySelector("[role='combobox'][aria-expanded='true']")).toBeTruthy());
    expect(cell.classList.contains("csc-container-cell--picked")).toBe(false);
    expect(cell.classList.contains("csc-container-cell--editing")).toBe(false);
  });
});
