import { describe, expect, it } from 'vitest';
import { overpayAnnotationOf } from './overpayAnnotation';

const row = (tong: number, da: number) => ({ tongPhaiThuTra: tong, daThuTra: da });

describe('card 20260922_2 — over-pay annotation branches', () => {
  it('da > tong returns the hoan-lai annotation with the exact difference', () => {
    const annotation = overpayAnnotationOf(row(250000, 300000));
    expect(annotation).toContain('Đã thu/trả vượt');
    expect(annotation).toContain('hoàn lại 50.000');
  });

  it('da < tong returns no annotation', () => {
    expect(overpayAnnotationOf(row(250000, 200000))).toBeNull();
  });

  it('da = tong returns no annotation', () => {
    expect(overpayAnnotationOf(row(250000, 250000))).toBeNull();
  });
});
