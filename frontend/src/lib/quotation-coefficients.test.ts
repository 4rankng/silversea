import { describe, expect, it } from 'vitest';
import { quotationCellSchema } from '@tingting/shared';
import fixture from './quotation-coefficients.fixture.json';
import { mergeQuotationCoefficients } from './quotation-coefficients';

const cells = quotationCellSchema.array().parse(fixture.cells);
const key = (cell: typeof cells[number]) => `${cell.routeId}:${cell.vehicleSizeClassCode}`;

describe('UI35 full replace-all coefficient payload', () => {
  it('retains all30 real cells/three routes when one route submits ten cells', () => {
    const route = cells.filter(cell => cell.routeId === cells[0].routeId);
    const changes = route.map((cell, index) => ({ ...cell, heSo: index === 0 ? 1.1 : cell.heSo }));
    const merged = mergeQuotationCoefficients(cells, changes);
    expect(cells).toHaveLength(30);
    expect(new Set(cells.map(cell => cell.routeId)).size).toBe(3);
    expect(merged.map(key)).toEqual(cells.map(key));
    expect(merged[0].heSo).toBe(1.1);
    expect(merged.slice(1)).toEqual(cells.slice(1));
    expect(cells[0].heSo).toBe(1);
  });

  it('matches both route and class so the same class on other routes is untouched', () => {
    const changed = cells.find(cell => cell.routeId !== cells[0].routeId && cell.vehicleSizeClassCode === cells[0].vehicleSizeClassCode)!;
    const merged = mergeQuotationCoefficients(cells, [{ ...changed, heSo: 1.1 }]);
    for (let index = 0; index < cells.length; index++) {
      expect(merged[index]).toEqual(key(cells[index]) === key(changed) ? { ...changed, heSo: 1.1 } : cells[index]);
    }
    expect(mergeQuotationCoefficients(cells, [])).toEqual(cells);
  });
});
