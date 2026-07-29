import { describe, expect, it } from 'vitest';
import { splitKpi } from './utils';

describe('splitKpi', () => {
  it('keeps VND KPI amounts as full Vietnamese numbers', () => {
    expect(splitKpi(30_430_000)).toEqual({ num: '30.430.000', suffix: '' });
  });
});
