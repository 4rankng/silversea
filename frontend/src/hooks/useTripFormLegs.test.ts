import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { LoadingType } from '@tingting/shared';
import { applyLegUpdate, useTripFormLegs, type FormLeg } from './useTripFormLegs';
import type { RouteOption } from './useTripOptions';

const outbound: FormLeg = {
  id: 'outbound',
  sequence: 1,
  origin: 'Cảng Nam Đình Vũ',
  destination: 'Trà Xanh Ngọc Thanh',
  km: '212',
  loadingType: LoadingType.VO,
};

describe('applyLegUpdate', () => {
  it('keeps generated return fields linked while they still mirror leg 1', () => {
    const result = applyLegUpdate([
      outbound,
      {
        id: 'return',
        sequence: 2,
        origin: 'Trà Xanh Ngọc Thanh',
        destination: 'Cảng Nam Đình Vũ',
        km: '212',
        loadingType: LoadingType.HANG,
      },
    ], 0, 'destination', 'Trà Xanh Phú Thọ', {
      isEditMode: true,
      hasDeletedReturnLeg: false,
    });

    expect(result[1].origin).toBe('Trà Xanh Phú Thọ');
    expect(result[1].destination).toBe('Cảng Nam Đình Vũ');
  });

  it('preserves a customized unloading port when leg 1 changes later', () => {
    const result = applyLegUpdate([
      outbound,
      {
        id: 'return',
        sequence: 2,
        origin: 'Trà Xanh Ngọc Thanh',
        destination: 'Cảng Chùa Vẽ',
        km: '212',
        loadingType: LoadingType.HANG,
      },
    ], 0, 'origin', 'Kho SINOVNL Hải Phòng', {
      isEditMode: true,
      hasDeletedReturnLeg: false,
    });

    expect(result[1].destination).toBe('Cảng Chùa Vẽ');
  });

  it('preserves custom return distance and loading type independently', () => {
    const customReturn: FormLeg = {
      id: 'return',
      sequence: 2,
      origin: 'Trà Xanh Ngọc Thanh',
      destination: 'Cảng Chùa Vẽ',
      km: '225',
      loadingType: LoadingType.VO,
    };

    const afterDistance = applyLegUpdate(
      [outbound, customReturn],
      0,
      'km',
      '214',
      { isEditMode: true, hasDeletedReturnLeg: false },
    );
    const afterLoadingType = applyLegUpdate(
      [outbound, customReturn],
      0,
      'loadingType',
      LoadingType.HANG,
      { isEditMode: true, hasDeletedReturnLeg: false },
    );

    expect(afterDistance[1].km).toBe('225');
    expect(afterLoadingType[1].loadingType).toBe(LoadingType.VO);
  });

  it('keeps hydrated legs unchanged across unrelated form rerenders', () => {
    const routes: RouteOption[] = [{
      id: 1,
      label: 'Hải Phòng - Phú Thọ',
      name: 'Hải Phòng - Phú Thọ',
      distanceKm: 212,
    }];
    const { result, rerender } = renderHook(
      ({ routeOptions, revision }) => {
        void revision;
        return useTripFormLegs(routeOptions, '1', true);
      },
      { initialProps: { routeOptions: routes, revision: 0 } },
    );

    const customizedLegs = [
      outbound,
      {
        id: 'return',
        sequence: 2,
        origin: 'Trà Xanh Ngọc Thanh',
        destination: 'Cảng Chùa Vẽ',
        km: '225',
        loadingType: LoadingType.HANG,
      },
    ];
    act(() => result.current.setLegs(customizedLegs));

    rerender({ routeOptions: [...routes], revision: 1 });
    expect(result.current.legs).toEqual(customizedLegs);
  });
});
