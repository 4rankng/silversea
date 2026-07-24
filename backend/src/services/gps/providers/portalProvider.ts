import { z } from 'zod';
import type { GpsProvider, NormalizedGpsVehicle } from './types';
import { parseAspDate } from '../parse';
import { ensurePortalSession, isPortalConfigured, portalPost } from '../portalClient';

/**
 * Web-portal source: get_AllTIBase via the shared portal session (see
 * portalClient.ts). Works today without the vendor enabling API-gateway access,
 * but is an undocumented internal endpoint — isolated here so changes only
 * affect this file. Extended telemetry (camera, odometer, driving time…) is
 * populated into `details`.
 */

const portalVehicleSchema = z.object({
  NumberPlate: z.string().catch(''),
  DeviceId: z.union([z.number(), z.string()]).catch(''),
  DriverName: z.string().nullable().catch(null),
  Lt: z.number().catch(0),
  Ln: z.number().catch(0),
  Speed: z.number().catch(0),
  Angle: z.number().catch(0),
  Address: z.string().nullable().catch(null),
  AccHard: z.string().nullable().catch(null),
  Oil: z.number().nullable().catch(null),
  RealDate: z.string().nullable().catch(null),
  GPSStatus: z.boolean().catch(true),
  CarID: z.number().nullable().catch(null),
  // Extended telemetry (portal only)
  ModelCar: z.string().nullable().catch(null),
  TotalKmRun: z.number().catch(0),
  KmInDay: z.number().catch(0),
  AccOnOffPeriod: z.string().nullable().catch(null),
  door: z.string().nullable().catch(null),
  Air: z.string().nullable().catch(null),
  Acquy: z.string().nullable().catch(null),
  DriverTime: z.string().nullable().catch(null),
  DriverTimeInDay: z.string().nullable().catch(null),
  StopNumber: z.number().catch(0),
  OverSpeeds: z.number().catch(0),
  StopOrParkTime: z.string().nullable().catch(null),
  OilPercent: z.number().catch(0),
  GSSMSignal: z.number().nullable().catch(null),
  DriverLicense: z.string().nullable().catch(null),
  DriverPhone: z.string().nullable().catch(null),
  IssuanceDate: z.string().nullable().catch(null),
  ExpirationDate: z.string().nullable().catch(null),
  ImageLink: z.string().nullable().catch(null),
});

type PortalVehicle = z.infer<typeof portalVehicleSchema>;

function mapPortalVehicle(v: PortalVehicle): NormalizedGpsVehicle {
  return {
    numberPlate: v.NumberPlate,
    deviceId: v.DeviceId === '' ? null : String(v.DeviceId),
    driverName: v.DriverName,
    lat: v.Lt,
    lng: v.Ln,
    speed: v.Speed,
    angle: v.Angle,
    address: v.Address,
    ignitionOn: (v.AccHard ?? '').toLowerCase().includes('bật'),
    fuel: v.Oil && v.Oil > 0 ? v.Oil : null,
    lastSeenAt: parseAspDate(v.RealDate),
    lostSignal: v.GPSStatus === false,
    carId: v.CarID,
    details: {
      modelCar: v.ModelCar || null,
      odometerKm: v.TotalKmRun || null,
      kmToday: v.KmInDay || null,
      engineSince: v.AccOnOffPeriod || null,
      doorStatus: v.door || null,
      airConditioning: v.Air || null,
      batteryV: v.Acquy || null,
      drivingTime: v.DriverTime || null,
      drivingTimeToday: v.DriverTimeInDay || null,
      stopCount: v.StopNumber || null,
      overSpeedCount: v.OverSpeeds || null,
      parkedTime: v.StopOrParkTime || null,
      fuelPercent: v.OilPercent || null,
      signalDb: v.GSSMSignal ?? null,
      driverLicense: v.DriverLicense || null,
      driverPhone: v.DriverPhone || null,
      licenseIssued: v.IssuanceDate || null,
      licenseExpiry: v.ExpirationDate || null,
      cameraImage: v.ImageLink && v.ImageLink.startsWith('http') ? v.ImageLink : null,
    },
  };
}

export const portalProvider: GpsProvider = {
  name: 'portal',
  isConfigured: () => isPortalConfigured(),
  async fetchVehicles(): Promise<NormalizedGpsVehicle[]> {
    if (!(await isPortalConfigured())) return [];
    let userId: string;
    try {
      userId = (await ensurePortalSession()).userId;
    } catch (err) {
      console.error('[gps][portal] login failed:', err instanceof Error ? err.message : err);
      return [];
    }
    try {
      const { status, text } = await portalPost(
        '/Home/get_AllTIBase',
        JSON.stringify({ userID: userId }),
        { contentType: 'application/json; charset=UTF-8', referer: 'Home/CameraSystem' },
      );
      if (status !== 200) {
        console.error(`[gps][portal] get_AllTIBase → HTTP ${status}`);
        return [];
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return [];
      }
      if (!Array.isArray(raw)) return [];
      return raw
        .map((item: unknown) => portalVehicleSchema.safeParse(item))
        .filter((r) => r.success)
        .map((r) => mapPortalVehicle((r as { data: PortalVehicle }).data))
        .filter((v) => v.numberPlate !== '' && !(v.lat === 0 && v.lng === 0));
    } catch (err) {
      console.error('[gps][portal] get_AllTIBase failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};
