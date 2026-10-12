import type { TripDetail } from '@tingting/shared';
import type { FormLeg } from './useTripFormLegs';
import type { UseTripFormStateReturn } from './useTripFormState';
import type { PhotoUploadedHandler } from './useTripFormPhotos';

export interface SubmitOptions {
  creditException?: { reason: string; expiresAt: string; scopeType: 'SHIPMENT' | 'EXPIRY'; exposureCeiling: number };
  conflictResolution?: { version: number; choices: Record<string, 'local' | 'server'> };
}

export interface TripFormSubmitParams {
  state: UseTripFormStateReturn;
  isEditMode: boolean;
  existingTrip: TripDetail | undefined;
  legs: FormLeg[];
  requiredFieldsFilled: number;
  hasOptionalData: boolean;
  photoUrls: string[];
  flushPendingPhotos: (tripId: number) => Promise<string[]>;
  flushPendingContainerPhotos: (tripId: number, rowKeyToContainerId: Map<string, number>, onUploaded?: PhotoUploadedHandler) => Promise<Map<string, string>>;
  governanceReason?: string;
  onCreditLimitBlocked?: (details: { message: string; customerId: number; proposedAmount: number }) => void;
  /** Ticket 111026105630 (FB-038 family): surfaces the rig-overlap warn-once
   *  dialog ('Vẫn lưu?'). Absent → the 409 rethrows unchanged (no dead-end
   *  retry, the pre-guard behavior). */
  confirmRigOverlap?: (message: string) => Promise<boolean>;
}
