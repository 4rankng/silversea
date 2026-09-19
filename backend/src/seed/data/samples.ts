// AUTO-GENERATED from docs/BIẾU MẪU BÁO CÁO/*.xlsx by the customer-data extractor.
// Do not edit by hand — re-run the extractor (see plans/260731-customer-audit-reseed) to refresh.
// Values are the customer's real master data (2026-07-30 delivery).
export interface SampleTrip { seq:number; date2026:string; customer:string; factory:string; route:string; contType:string; exportImport:string; weightTons:number|null; bill:string; containerNo:string; carrier:string; bks:string; receivable:{cuoc:number;zoneSurcharge:number;phuPhi:number;com:number;phatSinh:number;tongThu:number}; payable:{cuoc:number;zoneSurcharge:number;phuPhi:number;phatSinh:number;tongTra:number}; }
export const sampleTrips: SampleTrip[] = [
  {
    "seq": 1,
    "date2026": "25/06",
    "customer": "LONG MINH",
    "factory": "NEWEB",
    "route": "ĐỒNG VĂN, NINH BÌNH",
    "contType": "40",
    "exportImport": "N",
    "weightTons": 7,
    "bill": "JJCTCHPDY260231",
    "containerNo": "HPCU4868579",
    "carrier": "ABC",
    "bks": "15F-01698",
    "receivable": {
      "cuoc": 4160000,
      "zoneSurcharge": 0,
      "phuPhi": 398119,
      "com": 100000,
      "phatSinh": 0,
      "tongThu": 4558119
    },
    "payable": {
      "cuoc": 3800000,
      "zoneSurcharge": 0,
      "phuPhi": 475000,
      "phatSinh": 0,
      "tongTra": 4275000
    }
  },
  {
    "seq": 2,
    "date2026": "2/7",
    "customer": "LONG MINH",
    "factory": "NEWEB",
    "route": "HÀ NỘI",
    "contType": "40",
    "exportImport": "X",
    "weightTons": 7,
    "bill": "JJCTCHPDY541863",
    "containerNo": "TEMU8475173",
    "carrier": "ABC",
    "bks": "15H-014.85",
    "receivable": {
      "cuoc": 4500000,
      "zoneSurcharge": 500000,
      "phuPhi": 398119,
      "com": 0,
      "phatSinh": 0,
      "tongThu": 5398119
    },
    "payable": {
      "cuoc": 3800000,
      "zoneSurcharge": 350000,
      "phuPhi": 100000,
      "phatSinh": 0,
      "tongTra": 4250000
    }
  },
  {
    "seq": 3,
    "date2026": "12/7",
    "customer": "LONG MINH",
    "factory": "NEWEB",
    "route": "BẮC NINH",
    "contType": "40",
    "exportImport": "N",
    "weightTons": 7,
    "bill": "JJCTCHPDX001212",
    "containerNo": "APHU6821471",
    "carrier": "ABC",
    "bks": "15C-332.45",
    "receivable": {
      "cuoc": 4500000,
      "zoneSurcharge": 0,
      "phuPhi": 398119,
      "com": 0,
      "phatSinh": 0,
      "tongThu": 4898119
    },
    "payable": {
      "cuoc": 4000000,
      "zoneSurcharge": 0,
      "phuPhi": 0,
      "phatSinh": 0,
      "tongTra": 4000000
    }
  },
  {
    "seq": 4,
    "date2026": "13/7",
    "customer": "LONG MINH",
    "factory": "NEWEB",
    "route": "BẮC GIANG",
    "contType": "40",
    "exportImport": "N",
    "weightTons": 7,
    "bill": "JJCTCHPDY682453",
    "containerNo": "HPCU4864174",
    "carrier": "ABC",
    "bks": "15H-154.28",
    "receivable": {
      "cuoc": 4700000,
      "zoneSurcharge": 500000,
      "phuPhi": 398119,
      "com": 0,
      "phatSinh": 0,
      "tongThu": 5598119
    },
    "payable": {
      "cuoc": 4000000,
      "zoneSurcharge": 350000,
      "phuPhi": 250000,
      "phatSinh": 0,
      "tongTra": 4600000
    }
  }
];
