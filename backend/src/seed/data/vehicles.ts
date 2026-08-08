// AUTO-GENERATED from /Users/dev/My Drive/SilverSea/2. Raw_data/29.7 - DATA PM.xlsx - LOẠI HÌNH XE sheet
// Run: node tools/generate-seed-data.mjs to regenerate

export interface VehicleSeed {
  type: string;
  licensePlate: string;
  trailerPlate: string;
  inspectionDeadline: string | null;
  driver: string;
  licenseDeadline: string | null;
  maxLoadTon: number | null;
  maxLoadFront: number | null;
  maxLoadRear: number | null;
  preferredRoute: string;
  note: string;
}

export const vehicles: VehicleSeed[] = [
  {
    "type": "NẶNG 2 CẦU 3 GIÀN",
    "licensePlate": "15E-016.26",
    "trailerPlate": "15RM-007.55",
    "inspectionDeadline": null,
    "driver": "NGUYỄN DUY TUẤN",
    "licenseDeadline": null,
    "maxLoadTon": 33000,
    "maxLoadFront": 15000,
    "maxLoadRear": 25000,
    "preferredRoute": "ĐI COMBO-ĐÚNG GIƠ",
    "note": ""
  },
  {
    "type": "NHẸ 1 CẦU 2 GIÀN",
    "licensePlate": "15H-087.19",
    "trailerPlate": "15RM-017.97",
    "inspectionDeadline": null,
    "driver": "TRẦN TRUNG HIẾU",
    "licenseDeadline": null,
    "maxLoadTon": 22000,
    "maxLoadFront": 10000,
    "maxLoadRear": 15000,
    "preferredRoute": "HÀ NAM",
    "note": ""
  },
  {
    "type": "1 CẦU 3 DÀN",
    "licensePlate": "15H-085.66",
    "trailerPlate": "15RM-018.38",
    "inspectionDeadline": null,
    "driver": "NGUYỄN VĂN DƯƠNG",
    "licenseDeadline": null,
    "maxLoadTon": 29000,
    "maxLoadFront": 10000,
    "maxLoadRear": 25000,
    "preferredRoute": "",
    "note": ""
  }
];
