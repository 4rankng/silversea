import { useState, useEffect, useMemo, useCallback } from 'react';
import { LoadingType } from '@tingting/shared';
import type { RouteOption } from './useTripOptions';

export interface FormLeg {
  id: string;
  sequence: number;
  origin: string;
  destination: string;
  km: string;
  loadingType: LoadingType;
}

function getOppositeLoadingType(type: LoadingType): LoadingType {
  return type === LoadingType.HANG ? LoadingType.VO : LoadingType.HANG;
}

interface ApplyLegUpdateOptions {
  isEditMode?: boolean;
  hasDeletedReturnLeg: boolean;
  idFactory?: () => string;
}

export function applyLegUpdate(
  previous: FormLeg[],
  idx: number,
  field: keyof FormLeg,
  value: string,
  {
    isEditMode,
    hasDeletedReturnLeg,
    idFactory = () => Math.random().toString(),
  }: ApplyLegUpdateOptions,
): FormLeg[] {
  const next = previous.map((leg, i) => (
    i === idx ? { ...leg, [field]: value } as FormLeg : leg
  ));

  if (idx !== 0) return next;

  const first = next[0];
  if (
    next.length === 1 &&
    !isEditMode &&
    !hasDeletedReturnLeg &&
    (first.origin || first.destination || first.km)
  ) {
    next.push({
      id: idFactory(),
      sequence: 2,
      origin: first.destination,
      destination: first.origin,
      km: first.km,
      loadingType: getOppositeLoadingType(first.loadingType),
    });
    return next;
  }

  if (next.length !== 2) return next;

  const previousFirst = previous[0];
  const previousReturn = previous[1];
  const linkedReturn = { ...next[1] };

  // Keep the generated return leg convenient while each field still mirrors
  // leg 1. Once a user customizes a return/unloading field, that field becomes
  // authoritative and later edits must not replace it with the route default.
  if (field === 'origin' && previousReturn.destination === previousFirst.origin) {
    linkedReturn.destination = first.origin;
  }
  if (field === 'destination' && previousReturn.origin === previousFirst.destination) {
    linkedReturn.origin = first.destination;
  }
  if (field === 'km' && previousReturn.km === previousFirst.km) {
    linkedReturn.km = first.km;
  }
  if (
    field === 'loadingType' &&
    previousReturn.loadingType === getOppositeLoadingType(previousFirst.loadingType)
  ) {
    linkedReturn.loadingType = getOppositeLoadingType(first.loadingType);
  }

  next[1] = linkedReturn;
  return next;
}

export function useTripFormLegs(routes: RouteOption[], routeId: string, isEditMode?: boolean) {
  const [legs, setLegs] = useState<FormLeg[]>([]);
  const [hasDeletedReturnLeg, setHasDeletedReturnLeg] = useState(false);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === Number(routeId)),
    [routes, routeId],
  );

  useEffect(() => {
    setHasDeletedReturnLeg(false);
  }, [routeId]);

  useEffect(() => {
    if (isEditMode) return;
    if (!selectedRoute || legs.length > 0) return;

    if (selectedRoute.defaultLegs && selectedRoute.defaultLegs.length > 0) {
      if (selectedRoute.defaultLegs.length === 1) {
        const l = selectedRoute.defaultLegs[0];
        setLegs([
          {
            id: Math.random().toString(),
            sequence: 1,
            origin: l.origin,
            destination: l.destination,
            km: l.km.toString(),
            loadingType: l.loadingType as LoadingType,
          },
          {
            id: Math.random().toString(),
            sequence: 2,
            origin: l.destination,
            destination: l.origin,
            km: l.km.toString(),
            loadingType: getOppositeLoadingType(l.loadingType as LoadingType),
          },
        ]);
      } else {
        setLegs(selectedRoute.defaultLegs.map((l, i) => ({
          id: Math.random().toString(),
          sequence: i + 1,
          origin: l.origin,
          destination: l.destination,
          km: l.km.toString(),
          loadingType: l.loadingType as LoadingType,
        })));
      }
    } else {
      const parts = selectedRoute.name.split(/\s*[-→]\s*/).filter(Boolean);
      const origin = parts[0]?.trim() || "";
      const destination = parts.length > 1 ? parts[parts.length - 1].trim() : "";
      const km = selectedRoute.distanceKm ? String(selectedRoute.distanceKm) : "";
      setLegs([
        {
          id: Math.random().toString(),
          sequence: 1,
          origin,
          destination,
          km,
          loadingType: LoadingType.HANG,
        },
        {
          id: Math.random().toString(),
          sequence: 2,
          origin: destination,
          destination: origin,
          km,
          loadingType: LoadingType.VO,
        },
      ]);
    }
  }, [selectedRoute, legs.length, isEditMode]);

  const addLeg = useCallback(() => {
    setLegs((prev) => {
      const lastLeg = prev[prev.length - 1];
      return [
        ...prev,
        {
          id: Math.random().toString(),
          sequence: prev.length + 1,
          origin: lastLeg ? lastLeg.destination : "",
          destination: "",
          km: "",
          loadingType: LoadingType.HANG,
        },
      ];
    });
  }, []);

  const removeLeg = useCallback((idx: number) => {
    setLegs((prev) => {
      if (prev.length === 2 && idx === 1) {
        setHasDeletedReturnLeg(true);
      }
      return prev
        .filter((_, i) => i !== idx)
        .map((leg, i) => ({ ...leg, sequence: i + 1 }));
    });
  }, []);

  const updateLeg = useCallback(
    (idx: number, field: keyof FormLeg, value: string) => {
      setLegs((prev) => applyLegUpdate(prev, idx, field, value, {
        isEditMode,
        hasDeletedReturnLeg,
      }));
    },
    [isEditMode, hasDeletedReturnLeg],
  );

  return {
    legs,
    setLegs,
    addLeg,
    removeLeg,
    updateLeg,
  };
}
