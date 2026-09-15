import { describe, expect, it } from 'vitest';
import { entranceDelay, visibleEntranceTargets } from './operational-entrance';

function surface(top = 20) {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => ({ width: 100, height: 40, top, bottom: top + 40, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) });
  return node;
}

describe('operational entrance selection', () => {
  it('deduplicates nested panels and table wrappers to avoid compounded fades', () => {
    const panel = surface(); const table = surface(); panel.append(table);
    const sibling = surface();
    expect(visibleEntranceTargets([table, panel, panel, sibling])).toEqual([panel, sibling]);
  });

  it('leaves off-screen and hidden records untouched', () => {
    const visible = surface(); const below = surface(window.innerHeight + 20);
    const above = surface(-100); const hidden = document.createElement('div');
    expect(visibleEntranceTargets([visible, below, above, hidden])).toEqual([visible]);
  });

  it('caps total delay for large lists and extreme caller values', () => {
    expect(entranceDelay(0, 12)).toBe(0);
    expect(entranceDelay(2, 12)).toBe(24);
    expect(entranceDelay(29, 40, 60)).toBe(80);
    expect(entranceDelay(10000, 99999, 99999)).toBe(80);
    expect(entranceDelay(1, NaN, -30)).toBe(0);
  });
});
