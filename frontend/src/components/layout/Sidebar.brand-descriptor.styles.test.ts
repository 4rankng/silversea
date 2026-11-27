import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../../brand';

/* ---------------------------------------------------------------------------
 * SIL-1170 — the brand descriptor must read IN FULL, on ONE line, inside the
 * sidebar brand row (it used to render as "Quản lý vận tải và log…").
 *
 * Two standing laws collide on that row:
 *   · SIL-899 — the descriptor stays on ONE line, so the brand block height
 *     never depends on font metrics and the collapsed rail / hover bloom /
 *     expanded sidebar keep the same nav Y positions.
 *   · the no-truncate law — the string is never ellipsised.
 *
 * So the fix is neither "let it wrap" nor "shorten the copy": the brand row
 * gives the descriptor the width the string needs, which means the Pin
 * leaves the row's inline flow and becomes the brand block's corner action.
 *
 * Every number below is MEASURED, not estimated:
 *   · the REQUIRED width comes from the advance widths of the shipped face
 *     (public/fonts/BeVietnamPro-*.ttf — the weight face --font-body
 *     resolves to for the descriptor's own font-weight), so the pin fails
 *     for ANY copy change, in either direction;
 *   · the AVAILABLE width is computed from the tokens and the brand row's
 *     own layout (sidebar width − paddings − logo − gap).
 * ------------------------------------------------------------------------ */

const ROOT = process.cwd();

function readCss(relative: string): string {
  // Comments are stripped: the rules are read for their DECLARATIONS, and a
  // comment may mention a property (or a value) without declaring it.
  return readFileSync(resolve(ROOT, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const sidebarCss = readCss('src/components/layout/sidebar.css');
const hoverCss = readCss('src/components/layout/sidebar-hover.css');
const overlayCss = readCss('src/components/layout/sidebar-overlay.css');
const tokensCss = readCss('src/styles/tokens.css');

/* ── CSS readers ─────────────────────────────────────────────────────────── */

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The selector must be a WHOLE selector: it may be preceded by whitespace
  // or a comment, but never by a name character (so `.sidebar-brand` never
  // matches `.sidebar-brand-logo`).
  const match = new RegExp(`(?:^|[^\\w.-])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

/** The first declaration of `property` in a rule body, if the rule has one. */
function optionalDeclaration(body: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|[;{]|\\s)${property}\\s*:\\s*([^;]+)`).exec(body);
  return match ? match[1].trim() : undefined;
}

/** A declaration the rule must carry. */
function declaration(body: string, property: string): string {
  const value = optionalDeclaration(body, property);
  if (value === undefined) throw new Error(`CSS declaration not found: ${property}`);
  return value;
}

function px(body: string, property: string): number {
  const value = optionalDeclaration(body, property);
  const match = value ? /^(-?[\d.]+)px$/.exec(value) : null;
  return match ? Number(match[1]) : Number.NaN;
}

/** The CSS `padding` shorthand, normalised to the four box edges. */
function paddingBox(body: string): { top: number; right: number; bottom: number; left: number } {
  const values = declaration(body, 'padding')
    .split(/\s+/)
    .map((part) => Number(part.replace('px', '')));
  const [first, second, third, fourth] = values;
  if (values.length === 1) return { top: first, right: first, bottom: first, left: first };
  if (values.length === 2) return { top: first, right: second, bottom: first, left: second };
  if (values.length === 3) return { top: first, right: second, bottom: third, left: second };
  return { top: first, right: second, bottom: third, left: fourth };
}

/** Resolve `var(--token)` (one level) against the token sheet. */
function resolveVar(value: string, fallback = ''): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!match) return value.trim();
  const token = new RegExp(`${match[1]}\\s*:\\s*([^;]+)`).exec(tokensCss);
  return token ? token[1].trim() : fallback;
}

/* ── Font metrics (the shipped TTF, not an estimate) ─────────────────────── */

interface Face {
  unitsPerEm: number;
  advanceFor(code: number): number;
}

function readFace(relativePath: string): Face {
  const buf = readFileSync(resolve(ROOT, relativePath));
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    tables[buf.toString('latin1', record, record + 4)] = buf.readUInt32BE(record + 8);
  }
  const head = tables.head;
  const hhea = tables.hhea;
  const hmtx = tables.hmtx;
  const cmap = tables.cmap;
  if (!head || !hhea || !hmtx || !cmap) throw new Error(`incomplete font: ${relativePath}`);

  const unitsPerEm = buf.readUInt16BE(head + 18);
  const numberOfHMetrics = buf.readUInt16BE(hhea + 34);
  const advanceWidths: number[] = [];
  for (let i = 0; i < numberOfHMetrics; i++) {
    advanceWidths.push(buf.readUInt16BE(hmtx + i * 4));
  }

  // cmap — prefer a Windows full-repertoire subtable, else the BMP one.
  const numSubtables = buf.readUInt16BE(cmap + 2);
  let chosen = -1;
  let chosenFormat = 0;
  for (let i = 0; i < numSubtables; i++) {
    const record = cmap + 4 + i * 8;
    const platformId = buf.readUInt16BE(record);
    const encodingId = buf.readUInt16BE(record + 2);
    const offset = cmap + buf.readUInt32BE(record + 4);
    const unicode = platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10));
    if (!unicode) continue;
    const format = buf.readUInt16BE(offset);
    if (format === 12) {
      chosen = offset;
      chosenFormat = 12;
      break;
    }
    if (format === 4 && chosenFormat !== 12) {
      chosen = offset;
      chosenFormat = 4;
    }
  }
  if (chosen < 0) throw new Error(`no unicode cmap: ${relativePath}`);

  const glyphFor = (code: number): number => {
    if (chosenFormat === 12) {
      const groups = buf.readUInt32BE(chosen + 12);
      for (let g = 0; g < groups; g++) {
        const record = chosen + 16 + g * 12;
        const start = buf.readUInt32BE(record);
        const end = buf.readUInt32BE(record + 4);
        if (code >= start && code <= end) return buf.readUInt32BE(record + 8) + (code - start);
      }
      return 0;
    }
    const segCountX2 = buf.readUInt16BE(chosen + 6);
    const segCount = segCountX2 / 2;
    const endBase = chosen + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    for (let s = 0; s < segCount; s++) {
      const end = buf.readUInt16BE(endBase + s * 2);
      if (code > end) continue;
      const start = buf.readUInt16BE(startBase + s * 2);
      if (code < start) return 0;
      const delta = buf.readInt16BE(deltaBase + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyph = buf.readUInt16BE(rangeBase + s * 2 + rangeOffset + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };

  return {
    unitsPerEm,
    advanceFor(code: number): number {
      const glyph = glyphFor(code);
      if (!glyph) return 0;
      return advanceWidths[Math.min(glyph, numberOfHMetrics - 1)];
    },
  };
}

const FACE_BY_WEIGHT: Record<number, string> = {
  300: 'public/fonts/BeVietnamPro-Light.ttf',
  400: 'public/fonts/BeVietnamPro-Regular.ttf',
  500: 'public/fonts/BeVietnamPro-Medium.ttf',
  600: 'public/fonts/BeVietnamPro-SemiBold.ttf',
  700: 'public/fonts/BeVietnamPro-Bold.ttf',
  800: 'public/fonts/BeVietnamPro-ExtraBold.ttf',
};

function measureText(text: string, fontSizePx: number, face: Face): number {
  let units = 0;
  for (const character of text) {
    units += face.advanceFor(character.codePointAt(0) as number);
  }
  return (units / face.unitsPerEm) * fontSizePx;
}

/* ── The brand row's own geometry ────────────────────────────────────────── */

const brandRule = ruleBody(sidebarCss, '.sidebar-brand');
const logoRule = ruleBody(sidebarCss, '.sidebar-brand-logo');
const metaRule = ruleBody(sidebarCss, '.sidebar-brand-meta');
const strongRule = ruleBody(sidebarCss, '.sidebar-brand-meta strong');
const descriptorRule = ruleBody(sidebarCss, '.sidebar-brand-meta span');
const pinRule = ruleBody(hoverCss, '.sidebar-pin');

const sidebarWidthToken = /--sidebar-w\s*:\s*(-?[\d.]+)px/.exec(tokensCss);
if (!sidebarWidthToken) throw new Error('token not found: --sidebar-w');
const sidebarWidth = Number(sidebarWidthToken[1]);
const brandPadding = paddingBox(brandRule);
const brandPadTop = brandPadding.top;
const brandPadRight = brandPadding.right;
const brandPadLeft = brandPadding.left;
const brandGap = px(brandRule, 'gap');
const logoWidth = px(logoRule, 'width');
const logoHeight = px(logoRule, 'height');
const metaGap = px(metaRule, 'gap');

const descriptorSize = Number(resolveVar(declaration(descriptorRule, 'font-size')).replace('px', ''));
const descriptorWeight = Number(resolveVar(declaration(descriptorRule, 'font-weight')));
const brandNameSize = Number(resolveVar(declaration(strongRule, 'font-size')).replace('px', ''));
const brandNameWeight = Number(resolveVar(declaration(strongRule, 'font-weight')));

/** The brand row's content box (the row is a flex line of the sidebar). */
const brandContentLeft = brandPadLeft;
const brandContentRight = sidebarWidth - brandPadRight;
const brandRowTop = brandPadTop;

/** The Pin's own box (absolute, so it never takes row width). */
const pinWidth = px(pinRule, 'width');
const pinHeight = px(pinRule, 'height');
const pinTop = px(pinRule, 'top');
const pinRight = sidebarWidth - px(pinRule, 'right');
const pinLeft = pinRight - pinWidth;

/**
 * The width the descriptor's box owns: the row's content width minus the
 * logo and the gap that follows it. The Pin takes a slice of the row only
 * while it sits IN the inline flow (an absolute control takes none), and the
 * drawer close button takes none at all on desktop (display:none).
 */
const pinLeavesTheRow = optionalDeclaration(pinRule, 'position') === 'absolute';
const inlinePinWidth = pinLeavesTheRow ? 0 : pinWidth + brandGap;
const availableDescriptorWidth =
  brandContentRight - brandContentLeft - logoWidth - brandGap - inlinePinWidth;

/** The brand meta block's line boxes, stacked under the brand name. */
const strongLineHeight = brandNameSize * 1.35;
const descriptorLineHeight = descriptorSize * 1.35;
const metaHeight = strongLineHeight + metaGap + descriptorLineHeight;
const metaTop = brandRowTop + (logoHeight - metaHeight) / 2;
const descriptorLineTop = metaTop + strongLineHeight + metaGap;

describe('SIL-1170 — the brand descriptor reads in full on one line', () => {
  it('gives the descriptor box at least the width the string needs', () => {
    const face = readFace(FACE_BY_WEIGHT[descriptorWeight]);
    const required = measureText(BRAND.shellDescriptor, descriptorSize, face);

    // The owner measured the rendered descriptor at 147px (scrollWidth) in
    // the browser: the shipped face must reproduce that number, or the
    // measurement below is measuring the wrong thing.
    expect(required).toBeGreaterThan(147);
    expect(required).toBeLessThan(149);

    expect(availableDescriptorWidth).toBeGreaterThanOrEqual(required);
  });

  it('keeps a real margin so the copy is not one pixel from the edge', () => {
    const face = readFace(FACE_BY_WEIGHT[descriptorWeight]);
    const required = measureText(BRAND.shellDescriptor, descriptorSize, face);

    expect(availableDescriptorWidth - required).toBeGreaterThanOrEqual(8);
  });

  it('never ellipsises the descriptor and keeps it on one line (SIL-899)', () => {
    expect(declaration(descriptorRule, 'white-space')).toBe('nowrap');
    expect(descriptorRule).not.toContain('text-overflow');
    expect(descriptorRule).not.toContain('ellipsis');
  });

  it('keeps the Pin out of the brand row inline flow', () => {
    // The Pin is the brand block's corner action: absolute, so the row hands
    // its whole width to the descriptor. Inline, it would squeeze the
    // descriptor box back to 127px and the copy would ellipsise again.
    expect(declaration(pinRule, 'position')).toBe('absolute');
    expect(pinRule).not.toContain('margin-left');
    // The drawer close button is display:none on desktop: it takes no width
    // from the row either.
    expect(declaration(ruleBody(overlayCss, '.sidebar-close'), 'display')).toBe('none');
  });

  it('never lets the Pin cover the descriptor or the brand name', () => {
    const nameFace = readFace(FACE_BY_WEIGHT[brandNameWeight]);
    const nameWidth = measureText(BRAND.name, brandNameSize, nameFace);

    // The Pin's box sits above the descriptor's line box …
    expect(pinTop + pinHeight).toBeLessThan(descriptorLineTop);
    // … and to the right of the brand name.
    expect(brandContentLeft + logoWidth + brandGap + nameWidth).toBeLessThan(pinLeft);
  });

  it('keeps the rail and the hover bloom in parity with the expanded sidebar', () => {
    // The rail hides the meta, so the expanded brand block must not grow:
    // the Pin leaves the flow, so it adds no height either.
    expect(metaHeight).toBeLessThanOrEqual(logoHeight);
    // The bloom restores the expanded padding, so the descriptor owns the
    // same box there as in the expanded sidebar.
    expect(declaration(ruleBody(hoverCss, '.app.sidebar-closed.sidebar-hover-open .sidebar-brand'), 'padding'))
      .toBe(declaration(brandRule, 'padding'));
  });
});
