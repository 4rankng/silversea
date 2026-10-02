import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

describe('UI54 legacy trip control ownership', () => {
  it('keeps driver navigation, primary actions and disclosure headers within the current owner budget', () => {
    const detail = read('pages/DriverTripDetailPage.css');
    for (const selector of ['driver-task-back', 'driver-task-complete', 'driver-task-accept-sticky__btn', 'driver-task-fuel-btn']) {
      const rules = [...detail.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`, 'g'))];
      expect(rules.length, selector).toBeGreaterThan(0);
      expect(rules[0][1], selector).toMatch(/min-height:\s*var\(--control-h\)/);
      for (const rule of rules) {
        if (/min-height:/.test(rule[1])) expect(rule[1], selector).toMatch(/min-height:\s*var\(--control-h\)/);
        expect(rule[1], selector).not.toMatch(/(?:min-)?height:\s*(?:44|48|52)px/);
        expect(rule[1], selector).not.toMatch(/overflow:\s*(?:hidden|clip)/);
      }
    }
    expect(detail).toMatch(/\.driver-task-back\s*\{[^}]*padding:\s*0 14px;/);
    expect(detail).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.driver-task-section__toggle\s*\{[^}]*min-height:\s*var\(--control-touch-h\);[^}]*padding:\s*0;/);
    expect(detail).toMatch(/\.driver-task-fact\s*\{[^}]*min-height:\s*48px;[^}]*padding:\s*12px 0;/);
    const list = read('pages/DriverTripsPage.css');
    for (const selector of ['driver-journey__day-view', 'driver-journey-card__footer']) {
      const rules = [...list.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`, 'g'))];
      expect(rules.length, selector).toBeGreaterThan(0);
      for (const rule of rules) expect(rule[1], selector).toMatch(/min-height:\s*var\(--control-h\)/);
    }
    expect(list).toMatch(/#root \.driver-journey__tabs \.ds-tabs__btn\s*\{[^}]*min-height:\s*var\(--control-h\)/);
    expect(read('pages/DriverTripPodPage.css')).toMatch(/\.driver-task-footer__conflict-reload\s*\{[^}]*min-height:\s*var\(--control-h\)/);
  });

  it('keeps exactly one edit action owner across the shared responsive cutoff', () => {
    const utilities = read('styles/utilities.css');
    const hiddenAt = Number(utilities.match(/@media\s*\(max-width:\s*(\d+)px\)\s*\{\s*\.mobile-only\s*\{[^}]*\}\s*\.desktop-only\s*\{[^}]*display:\s*none/)?.[1]);
    const css = read('pages/TripEditPage.css');
    const visibleAt: number[] = [];
    for (const match of css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
      let depth = 1;
      let cursor = match.index! + match[0].length;
      const start = cursor;
      while (cursor < css.length && depth > 0) {
        if (css[cursor] === '{') depth += 1;
        if (css[cursor] === '}') depth -= 1;
        cursor += 1;
      }
      if (/\.tc-edit-mobile-bar\s*\{[^}]*display:\s*flex/.test(css.slice(start, cursor - 1))) visibleAt.push(Number(match[1]));
    }
    expect(Number.isFinite(hiddenAt)).toBe(true);
    expect(visibleAt.length).toBe(1);
    for (const width of [390, 640, 641, 768, hiddenAt, hiddenAt + 1, 1440]) {
      const railVisible = width > hiddenAt;
      const footerVisible = width <= visibleAt[0];
      expect(Number(railVisible) + Number(footerVisible), `Exactly one Save/Cancel group at${width}px`).toBe(1);
    }
  });

  it('keeps the native small input modifier in the shared Input primitive', () => {
    const input = read('components/Input.css');
    const small = input.match(/\.input--sm\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(small).toContain('height: var(--control-compact-h)');
    expect(small).toContain('min-height: var(--control-compact-h)');
    expect(small).toContain('padding: 0 10px');
    expect(read('components/trip/JourneyLegRow.css')).not.toMatch(/\.input--sm\s*\{/);
    // The existing textareas retain their independent multiline anatomy.
    expect(input).toMatch(/textarea\.input\s*\{[^}]*height: auto;[^}]*min-height: 96px;/);
  });

  it('lets container fields and trip save actions inherit their actual house owners', () => {
    const container = read('components/trip/ContainerInstancesCard.css');
    expect(container).not.toMatch(/\.input\.ci-input-sm\s*\{/);
    const page = read('pages/TripEditPage.css');
    for (const selector of ['tc-rail-btn', 'tc-mobile-btn']) {
      const rules = [...page.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`, 'g'))];
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) expect(rule[1]).not.toMatch(/(?:min-)?height:/);
    }
    const source = read('pages/TripEditPage.tsx');
    for (const selector of ['tc-rail-btn', 'tc-mobile-btn']) expect(source).toMatch(new RegExp(`className="btn btn--(?:primary|secondary) ${selector}`));
  });

  it('budgets supported photo/POD action branches separately from their media and content cards', () => {
    const cases = [
      ['components/trip/ImagesNotesCard.css', 'photo-thumb__remove'],
      ['components/trip/DriverContainerCard.css', 'dcc-sheet__action'],
      ['components/trip/TripPodSubmission.css', 'trip-pod__file-download'],
    ];
    for (const [path, selector] of cases) {
      const rule = read(path).match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
      expect(rule, selector).toMatch(/(?:min-)?height:\s*var\(--control-h\)/);
    }
    const driver = read('components/trip/DriverContainerCard.css');
    const capture = driver.match(/\.dcc-capture-btn--primary\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(capture).toContain('height: var(--control-h)');
    expect(capture).not.toMatch(/overflow:\s*(?:hidden|clip)/);
    expect(driver).toMatch(/\.dcc-capture-btn\s*\{[^}]*flex-direction: row;[^}]*min-height: var\(--control-h\);/);
    expect(driver).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.dcc-capture-btn--secondary\s*\{[^}]*min-height:\s*var\(--control-h\)/);
    const pod = read('components/trip/TripPodSubmission.css');
    expect(pod).toMatch(/\.trip-pod__action,\s*\.trip-pod__submit\s*\{[^}]*min-height:\s*var\(--control-h\)/);
    const fuel = read('components/trip/FuelModeToggle.css').match(/\.tc-fuel-mode label\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(fuel).toContain('min-height: var(--control-h)');
    expect(fuel).toContain('font-size: var(--text-control-size)');
    expect(fuel).toContain('line-height: 1.35');
    expect(fuel).toContain('padding: 2px 12px');
    expect(fuel).not.toMatch(/overflow:\s*(?:hidden|clip)/);
    expect(read('components/trip/ImagesNotesCard.css')).toMatch(/\.photo-thumb\s*\{[^}]*width: 72px;[^}]*height: 72px;/);
    expect(read('components/trip/CheckboxCard.css')).toContain('.tc-checkbox-card__desc');
  });

  it('keeps single-line reminder, route, media-action and note controls on the canonical budget', () => {
    const controls = [
      ['components/trip/TripInstructionsCard.css', 'ti-chip'],
      ['components/trip/RouteChips.css', 'tc-route-chip'],
      ['components/trip/ContainerInstancesCard.css', 'ci-photo-lane__capture'],
      ['components/trip/ShipmentCostEntryForm.css', 'shipment-cost-entry__note-collapsed'],
    ];
    for (const [path, selector] of controls) {
      const rule = read(path).match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
      expect(rule, selector).toContain('min-height: var(--control-h)');
      expect(rule, selector).not.toMatch(/(?:min-)?height:\s*(?:44|45)px/);
    }
    const container = read('components/trip/ContainerInstancesCard.css');
    const remove = container.match(/\.ci-photo-slot__remove\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(remove).toContain('height: var(--control-h)');
    expect(remove).toContain('width: var(--control-h)');
    // Thumbnail content remains distinct from the icon action target.
    expect(container).toMatch(/\.ci-photo-lane__media,[\s\S]*?height: 54px;/);
  });
});
