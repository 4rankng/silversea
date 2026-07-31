// AUTO-GENERATED from docs/BIẾU MẪU BÁO CÁO/*.xlsx by the customer-data extractor.
// Do not edit by hand — re-run the extractor (see plans/260731-customer-audit-reseed) to refresh.
// Values are the customer's real master data (2026-07-30 delivery).
export interface CustomerSeed { internalCode:string; taxCode:string; name:string; address:string; email:string; directorPhone:string; paymentTermChiHoDays:number|null; paymentTermCuocDays:number|null; manager:string; }
export const customers: CustomerSeed[] = [
  {
    "internalCode": "LONG MINH",
    "taxCode": "2300540419",
    "name": "CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH",
    "address": "Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh",
    "email": "longminh.logistic@gmail.com; account1@longminhbn.com.vn",
    "directorPhone": "",
    "paymentTermChiHoDays": 25,
    "paymentTermCuocDays": 15,
    "manager": "Ms.Vân"
  }
];
export const companyIdentity = {
  "name": "CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ SILVER SEA",
  "address": "Số 65, Tổ 9 Khu 6, Phường Hồng An, Thành phố Hải Phòng",
  "taxCode": "0201985011",
  "phone": "0976496385",
  "email": "silverseahp@gmail.com",
  "bankAccount": "0031000391518",
  "bankName": "Vietcombank",
  "representative": "Nguyễn Thị Phương"
} as const;
