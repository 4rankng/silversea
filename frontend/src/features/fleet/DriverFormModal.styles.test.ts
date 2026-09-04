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
    // Sectioned kit form: fields pair through the shared EntityFormSection
    // responsive grid; the legacy fleet grid classes no longer apply.
    expect(source).toContain("EntityFormSection");
    expect(source).toContain('label="Thông tin lái xe"');
    expect(source).toContain('label="Tài khoản nhận lương"');
  });

  it("collapses the driver grid to one column at the 760px sheet", () => {
    // Matches only the media override: the desktop rule's column value is
    // repeat(2, minmax(0, 1fr)), which cannot satisfy a bare `1fr` lookahead.
    expect(styles).toMatch(
      /\.fleet-form__grid--driver\s*\{[^}]*?grid-template-columns:\s*1fr/,
    );
  });

  it("labels every field explicitly — labels ride the kit field association", () => {
    expect(source).toMatch(/label="Mã tài xế"/);
    expect(source).toMatch(/label="Họ và tên"/);
    expect(source).toMatch(/label="Số điện thoại"/);
    expect(source).toMatch(/label="Hình thức lương"/);
    expect(source).toContain("btn btn--secondary btn--sm");
  });
});
