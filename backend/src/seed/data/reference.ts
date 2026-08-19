// AUTO-GENERATED from docs/BIẾU MẪU BÁO CÁO/*.xlsx by the customer-data extractor.
// Do not edit by hand — re-run the extractor (see plans/260731-customer-audit-reseed) to refresh.
// Values are the customer's real master data (2026-07-30 delivery).
export interface PortSeed { name:string; address:string; web:string; }
export const ports: PortSeed[] = [
  {
    "name": "Cảng Tân Vũ",
    "address": "ĐT356, KCN Đình Vũ, Đông Hải, Hải Phòng",
    "web": "https://eport.haiphongport.com.vn/User/Login"
  },
  {
    "name": "Cảng Đình Vũ",
    "address": "Lô KB4 Khu công nghiệp Minh Phương, Phường Đông Hải, Thành phố Hải Phòng, Việt Nam",
    "web": "https://eport.dinhvuport.com.vn/"
  },
  {
    "name": "Cảng Nam Đình Vũ",
    "address": "Khu phi thuế quan và Khu công nghiệp Nam Đình Vũ, Phường Đông Hải 2, Quận Hải An, Hải Phòng.",
    "web": "https://smartport.gemadept.com.vn/login"
  },
  {
    "name": "Cảng Nam Hải Đình Vũ",
    "address": "",
    "web": "https://eport.namhaidvport.com.vn/"
  },
  {
    "name": "Cảng Xanh - Green port",
    "address": "",
    "web": "https://eport.greenport.com.vn/"
  },
  {
    "name": "Cảng Xanh Vip - Vip Green Port",
    "address": "KCN Đình Vũ, Phường Đông Hải 2, Quận Hải An, Hải",
    "web": "https://eport.vipgreenport.com.vn/"
  },
  {
    "name": "Cảng Hải An",
    "address": "",
    "web": "https://vietnamhub.vn/login"
  },
  {
    "name": "ICD",
    "address": "Lô CN1.1 & CN1.2 KCN Minh Phương, Phường Đông Hải 2, Quận Hải An, Hải Phòng.",
    "web": ""
  },
  {
    "name": "Cảng Hoàng Diệu",
    "address": "Số 5 đường Chùa Vẽ, Phường Đông Hải 1, Quận Hải An, Hải Phòng.",
    "web": ""
  },
  {
    "name": "TC - HICT",
    "address": "Khu Đôn Lương, thị trấn Cát Hải, huyện Cát Hải, thành phố Hải Phòng, Việt Nam",
    "web": "https://eport.hict.net.vn/"
  },
  {
    "name": "TIL - HTIT",
    "address": "Bến số 3 & 4 Cảng nước sâu Lạch Huyện, Khu phố Đôn Lương, Đặc khu Cát Hải, Thành Phố Hải Phòng, Việt Nam",
    "web": "https://eport.htit.com.vn/"
  },
  {
    "name": "Hateco - HHIT",
    "address": "Bến container số 5&6 Khu cảng Lạch Huyện, Đặc khu Cát Hải, TP. Hải Phòng, Việt Nam",
    "web": "https://hhit.com.vn/"
  },
  {
    "name": "Bãi SITC",
    "address": "",
    "web": ""
  },
  {
    "name": "Bãi GFT",
    "address": "",
    "web": ""
  },
  {
    "name": "Bãi Minh Phương",
    "address": "",
    "web": ""
  },
  {
    "name": "Bãi Liên Việt",
    "address": "",
    "web": ""
  },
  {
    "name": "Bãi Chân Thật - THT",
    "address": "",
    "web": ""
  }
];
export interface RouteSeed { name:string; sharePct:number|null; oneWayKm:number|null; twoWayKm:number|null; }
export const routes: RouteSeed[] = [
  {
    "name": "Hải Phòng-NEWEB",
    "sharePct": 2,
    "oneWayKm": 130,
    "twoWayKm": 260
  },
  {
    "name": "ASKEY",
    "sharePct": 4,
    "oneWayKm": 100,
    "twoWayKm": 200
  },
  {
    "name": "SUNRISE+  SJ",
    "sharePct": 2.5,
    "oneWayKm": 120,
    "twoWayKm": 240
  }
];
export interface ContainerTypeSeed { code:string; name:string; }
export const containerTypes: ContainerTypeSeed[] = [
  {
    "code": "20DC",
    "name": "20'DC"
  },
  {
    "code": "20HC",
    "name": "20'HC"
  },
  {
    "code": "40DC",
    "name": "40'DC"
  },
  {
    "code": "40HC",
    "name": "40'HC"
  },
  {
    "code": "40RF",
    "name": "40'RF"
  },
  {
    "code": "20RF",
    "name": "20'RF"
  },
  {
    "code": "45HC",
    "name": "45'HC"
  }
];
