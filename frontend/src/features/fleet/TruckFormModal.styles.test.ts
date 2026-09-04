import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/features/fleet/TruckFormModal.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(process.cwd(), "src/pages/FleetPage.css"),
  "utf8",
);
const operationalStyles = readFileSync(
  resolve(process.cwd(), "src/styles/operational-density.css"),
  "utf8",
);

describe("TruckFormModal desktop density", () => {
  it("uses a wide desktop dialog and a two-field reminder row", () => {
    expect(source).toMatch(/maxWidth=\{920\}/);
    expect(styles).toMatch(
      /\.truck-alert-fields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    );
    expect(styles).toMatch(
      /\.truck-alert-field--oil-calculator\s*\{[\s\S]*?grid-column:\s*1 \/ -1[\s\S]*?display:\s*flex/,
    );
    expect(source).toContain('label="Lịch bảo trì"');
    expect(source).toContain("TruckDateField");
  });

  it("uses the shared compact control contract and a stable desktop grid", () => {
    expect(styles).toMatch(
      /\.fleet-form__grid--truck\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    );
    expect(styles).toMatch(
      /\.fleet-form__field--wide\s*\{[\s\S]*?grid-column:\s*span 2/,
    );
    expect(styles).toContain("--fleet-form-row-gap: 24px");
    expect(styles).toContain("min-height: var(--control-compact-h)");
    expect(styles).toContain("font-size: var(--control-compact-font-size)");
    expect(operationalStyles).toContain("calc(var(--control-compact-h) - 2px)");
    expect(operationalStyles).toContain(
      ".ds-uui-select--operational .ds-uui-select__control > button > span p",
    );
    expect(operationalStyles).toContain(
      "font-size: var(--control-compact-touch-font-size)",
    );
    expect(operationalStyles).toContain(
      ".ds-uui-select--operational .ds-uui-select__control > button",
    );
    // The app-wide ≤900px rule would raise native inputs to 44px while the
    // UUI selects stay compact — the 641–900px band must counter it so every
    // control in a row shares one boundary until the 640px phone sheet.
    expect(styles).toMatch(
      /@media \(min-width: 641px\) and \(max-width: 900px\)\s*\{[\s\S]*?\.fleet-form \.input:not\(textarea\)\s*\{[\s\S]*?height:\s*var\(--control-compact-h\) !important/,
    );
    expect(source).toContain("btn btn--secondary btn--sm");
  });

  it("keeps the reminder matrix single-column on narrow canvases", () => {
    expect(styles).toMatch(
      /@media \(max-width: 760px\)\s*\{[\s\S]*?\.truck-alert-fields\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 760px\)\s*\{[\s\S]*?\.truck-oil-helper__controls\s*\{[\s\S]*?flex:\s*0 1 auto[\s\S]*?width:\s*100%/,
    );
    expect(styles).toContain("min-height: var(--control-touch-h)");
    expect(styles).toContain(".modal__body .fleet-form .field .input");
  });

  it("uses the field labels once, with explicit htmlFor on every input", () => {
    expect(source).toMatch(/label="Biển số xe đầu kéo"/);
    expect(source).toMatch(/label="Loại hình xe"/);
    expect(source).toMatch(/label="Hãng xe"/);
    expect(source).toMatch(/label="Trọng tài kéo"/);
    // Date fields use TruckDateField subcomponent with htmlFor={id}
    expect(source).toMatch(/id="truck-inspection"/);
    expect(source).toMatch(/id="truck-insurance"/);
    expect(source).toContain('label="Ghi chú"');
  });
});
