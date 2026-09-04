import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/features/fleet/DriverFormModal.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(process.cwd(), "src/pages/FleetPage.css"),
  "utf8",
);

describe("DriverFormModal desktop density", () => {
  it("keeps the compact dialog on a paired two-column grid", () => {
    expect(source).toMatch(/maxWidth=\{620\}/);
    expect(source).toContain("fleet-form__grid--driver");
    expect(styles).toMatch(
      /\.fleet-form__grid--driver\s*\{[^}]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it("collapses the driver grid to one column at the 760px sheet", () => {
    // Matches only the media override: the desktop rule's column value is
    // repeat(2, minmax(0, 1fr)), which cannot satisfy a bare `1fr` lookahead.
    expect(styles).toMatch(
      /\.fleet-form__grid--driver\s*\{[^}]*?grid-template-columns:\s*1fr/,
    );
  });

  it("labels every field explicitly — all inputs use explicit htmlFor labels", () => {
    expect(source).toMatch(/<label htmlFor="driver-code">/);
    expect(source).toMatch(/<label htmlFor="driver-name">/);
    expect(source).toMatch(/<label htmlFor="driver-phone">/);
    expect(source).toMatch(/<label htmlFor="driver-salaryType">/);
    expect(source).toContain("btn btn--secondary btn--sm");
  });
});
