import { LoadingType } from '@tingting/shared';
import type { FormLeg } from './useTripFormLegs';

export interface PlannedContainer {
  containerTypeId?: number | null;
}

export function resolveContainerCount(raw: string): number {
  return Math.min(10, Math.max(1, Number(raw) || 1));
}

export function resolveCommonContainerTypeId(
  containers: PlannedContainer[] | undefined,
): string {
  if (!containers?.length) return '';
  const typeIds = containers.map((container) => container.containerTypeId);

  if (typeIds.some((typeId) => typeId == null)) return '';
  return typeIds.every((typeId) => typeId === typeIds[0])
    ? String(typeIds[0])
    : '';
}

export function createFallbackLegsFromRouteName(
  routeName: string | undefined,
  idFactory: () => string = () => Math.random().toString(),
): FormLeg[] {
  const parts = (routeName || '').split(/\s*[-→]\s*/).filter(Boolean);
  const originGuess = parts[0]?.trim() || '';
  const destGuess = parts.length > 1 ? parts[parts.length - 1].trim() : '';

  return [
    {
      id: idFactory(),
      sequence: 1,
      origin: originGuess,
      destination: destGuess,
      km: '',
      loadingType: LoadingType.HANG,
    },
    {
      id: idFactory(),
      sequence: 2,
      origin: destGuess,
      destination: originGuess,
      km: '',
      loadingType: LoadingType.VO,
    },
  ];
}
