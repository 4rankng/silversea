// AUTO-GENERATED from the customer's 2026-09-03 master-data delivery
// (Data form.xlsx + User & Role.xlsx). Source of truth for `pnpm seed:prod`.
// Regenerate with the same extractor; do not hand-edit.

export interface ProdStaffSeed { username: string; employeeCode: string; fullName: string; roleGroup: string; }
export interface ProdDriverSeed { code: string; username: string; name: string; idNumber: string | null; phone: string | null; bankName: string | null; bankAccount: string | null; }
export interface ProdCustomerSeed { name: string; shortName: string | null; code: string; taxCode: string | null; address: string | null; director: string | null; directorPhone: string | null; email: string | null; paymentTermChiHoDays: number | null; paymentTermCuocDays: number | null; }
export interface ProdSiteSeed { name: string; code: string; shortName: string | null; customerCode: string | null; routeName: string | null; address: string | null; note: string | null; contactPhone: string | null; mapsUrl: string | null; }
export interface ProdRouteSeed { name: string; fullName: string; shortName: string; loadPoint: string | null; distanceKm: number | null; tolls: number | null; }
export interface ProdTractorSeed { plate: string; driverName: string | null; type: string | null; }
export interface ProdTrailerSeed { plate: string; pairedTractor: string | null; type: string | null; }

export const prodStaff: ProdStaffSeed[] = [
  {
    "username": "nv001",
    "employeeCode": "NV001",
    "fullName": "Nguyễn Thị Phương",
    "roleGroup": "Ban Giám Đốc"
  },
  {
    "username": "nv002",
    "employeeCode": "NV002",
    "fullName": "Nguyễn Văn Nam",
    "roleGroup": "Ban Giám Đốc"
  },
  {
    "username": "nv003",
    "employeeCode": "NV003",
    "fullName": "Nguyễn Huy Hoàng",
    "roleGroup": "Ops"
  },
  {
    "username": "nv004",
    "employeeCode": "NV004",
    "fullName": "Lưu Danh Hùng",
    "roleGroup": "Ops"
  },
  {
    "username": "nv005",
    "employeeCode": "NV005",
    "fullName": "Trần Thiên Dương",
    "roleGroup": "Ops"
  },
  {
    "username": "nv006",
    "employeeCode": "NV006",
    "fullName": "Vũ Ngọc Tú",
    "roleGroup": "Ops"
  },
  {
    "username": "nv007",
    "employeeCode": "NV007",
    "fullName": "Nguyễn Minh Hoàng",
    "roleGroup": "Ops"
  },
  {
    "username": "nv008",
    "employeeCode": "NV008",
    "fullName": "Vũ Đình Cường",
    "roleGroup": "Ops"
  },
  {
    "username": "nv009",
    "employeeCode": "NV009",
    "fullName": "Phạm Thị Hòa",
    "roleGroup": "Kế toán"
  },
  {
    "username": "nv010",
    "employeeCode": "NV010",
    "fullName": "Nguyễn Thị Liên",
    "roleGroup": "Kế toán"
  },
  {
    "username": "nv011",
    "employeeCode": "NV011",
    "fullName": "Đoàn Phương Ly",
    "roleGroup": "Kế toán"
  },
  {
    "username": "nv012",
    "employeeCode": "NV012",
    "fullName": "Nguyễn Thị Thảo Vân",
    "roleGroup": "Kế toán"
  },
  {
    "username": "nv013",
    "employeeCode": "NV013",
    "fullName": "Vũ Thị Trà My",
    "roleGroup": "Kế toán"
  },
  {
    "username": "nv014",
    "employeeCode": "NV014",
    "fullName": "Nguyễn Thị Minh Ngọc",
    "roleGroup": "Kế toán"
  },
  {
    "username": "nv015",
    "employeeCode": "NV015",
    "fullName": "Nguyễn Văn Dũng",
    "roleGroup": "Điều vận"
  },
  {
    "username": "nv016",
    "employeeCode": "NV016",
    "fullName": "Đỗ Khoan Bắc",
    "roleGroup": "Điều vận"
  },
  {
    "username": "nv017",
    "employeeCode": "NV017",
    "fullName": "Nguyễn Thị Hương",
    "roleGroup": "Điều vận"
  },
  {
    "username": "nv018",
    "employeeCode": "NV018",
    "fullName": "Đinh Công Thành",
    "roleGroup": "Cus"
  },
  {
    "username": "nv019",
    "employeeCode": "NV019",
    "fullName": "Vũ Văn Tiệp",
    "roleGroup": "Cus"
  },
  {
    "username": "nv020",
    "employeeCode": "NV020",
    "fullName": "Đặng Thị Vân Anh",
    "roleGroup": "Cus"
  },
  {
    "username": "nv021",
    "employeeCode": "NV021",
    "fullName": "Nguyễn Thị Thanh Huyền",
    "roleGroup": "Cus"
  },
  {
    "username": "nv022",
    "employeeCode": "NV022",
    "fullName": "Nguyễn Thị Ngọc Ánh",
    "roleGroup": "Cus"
  }
];

export const prodDrivers: ProdDriverSeed[] = [
  {
    "code": "LVLONG",
    "username": "lvlong",
    "name": "Lương Văn Long",
    "idNumber": "038092001476",
    "phone": "0988822579",
    "bankName": "Công Thương Việt Nam (VIETINBANK)",
    "bankAccount": "100800882279"
  },
  {
    "code": "NVTHO",
    "username": "nvtho",
    "name": "Nguyễn Văn Thọ",
    "idNumber": "03009100747",
    "phone": null,
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "0351000894686"
  },
  {
    "code": "NDTUAN",
    "username": "ndtuan",
    "name": "Nguyễn Duy Tuấn",
    "idNumber": "025093009151",
    "phone": "0979697258",
    "bankName": "Quân đội (MB)",
    "bankAccount": "3540107506007"
  },
  {
    "code": "NTVU",
    "username": "ntvu",
    "name": "Nguyễn Thế Vũ",
    "idNumber": "031088001164",
    "phone": null,
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1048253879"
  },
  {
    "code": "NHVUONG",
    "username": "nhvuong",
    "name": "Nguyễn Huy Vương",
    "idNumber": "030084005894",
    "phone": "0984963484",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1043565309"
  },
  {
    "code": "BVAN",
    "username": "bvan",
    "name": "Bùi Văn An",
    "idNumber": "030084011951",
    "phone": "0961250628",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "0341006964468"
  },
  {
    "code": "DVTHUC",
    "username": "dvthuc",
    "name": "Dương Văn Thực",
    "idNumber": "024085007906",
    "phone": "0985246985",
    "bankName": "Tiên Phong (TPB)",
    "bankAccount": "00000813397"
  },
  {
    "code": "PNVAN",
    "username": "pnvan",
    "name": "Phạm Ngọc Văn",
    "idNumber": "015097002811",
    "phone": "0336170697",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0336170697"
  },
  {
    "code": "DTTHINH",
    "username": "dtthinh",
    "name": "Đinh Thanh Thịnh",
    "idNumber": "025090001409",
    "phone": "0973768118",
    "bankName": "Quân đội (MB)",
    "bankAccount": "6666118906666"
  },
  {
    "code": "BVHAU",
    "username": "bvhau",
    "name": "Bùi Văn Hậu",
    "idNumber": "038091015152",
    "phone": "0367873329",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1024754965"
  },
  {
    "code": "BQHUONG",
    "username": "bqhuong",
    "name": "Bùi Quang Hường",
    "idNumber": "030090011211",
    "phone": "0987278910",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0987278910"
  },
  {
    "code": "HTHUNG",
    "username": "hthung",
    "name": "Hoàng Trọng Hùng",
    "idNumber": "025094010778",
    "phone": "0966341815",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "0351001041356"
  },
  {
    "code": "VVTRUNG",
    "username": "vvtrung",
    "name": "Vũ Văn Trung",
    "idNumber": "027087009767",
    "phone": "0981309345",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "0351001228809"
  },
  {
    "code": "NVDUONG",
    "username": "nvduong",
    "name": "Nguyễn Văn Dương",
    "idNumber": "030084002733",
    "phone": "0977094284",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "0541000186578"
  },
  {
    "code": "TTHIEU",
    "username": "tthieu",
    "name": "Trần Trung Hiếu",
    "idNumber": "034085020347",
    "phone": "0964496330",
    "bankName": "Công Thương Việt Nam (VIETINBANK)",
    "bankAccount": "100879528403"
  },
  {
    "code": "BTDUNG",
    "username": "btdung",
    "name": "Bùi Tiến Dũng",
    "idNumber": "017084004899",
    "phone": null,
    "bankName": "Hàng hải (MSB)",
    "bankAccount": "8606101984"
  },
  {
    "code": "LVTUYEN",
    "username": "lvtuyen",
    "name": "Lưu Văn Tuyền",
    "idNumber": "030084002127",
    "phone": "0974847679",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1002056789"
  },
  {
    "code": "NVDUNG",
    "username": "nvdung",
    "name": "Nguyễn Văn Dũng",
    "idNumber": "027083019159",
    "phone": "0362157612",
    "bankName": "Công Thương Việt Nam (VIETINBANK)",
    "bankAccount": "109873767998"
  },
  {
    "code": "LVLO",
    "username": "lvlo",
    "name": "Lục Văn Lô",
    "idNumber": "024091017708",
    "phone": null,
    "bankName": "Công Thương Việt Nam (VIETINBANK)",
    "bankAccount": "106866946004"
  },
  {
    "code": "PTSON",
    "username": "ptson",
    "name": "Phạm Thanh Sơn",
    "idNumber": "030085025100",
    "phone": "0978257219",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0978257219"
  },
  {
    "code": "PVTRUONG",
    "username": "pvtruong",
    "name": "Phan Văn Trường",
    "idNumber": "027083015590",
    "phone": "0988786345",
    "bankName": "Công Thương Việt Nam (VIETINBANK)",
    "bankAccount": "101870115196"
  },
  {
    "code": "LNLONG",
    "username": "lnlong",
    "name": "Lê Ngọc Long",
    "idNumber": "030090009661",
    "phone": "0988481519",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1017226171"
  },
  {
    "code": "TVTHANG",
    "username": "tvthang",
    "name": "Trần Văn Thắng",
    "idNumber": "030080002683",
    "phone": "0985873114",
    "bankName": "Hàng hải (MSB)",
    "bankAccount": "02001018550873"
  },
  {
    "code": "VVCHINH",
    "username": "vvchinh",
    "name": "Vũ Văn Chính",
    "idNumber": "027078006674",
    "phone": "0917977922",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0917977922"
  },
  {
    "code": "NVQUYNH",
    "username": "nvquynh",
    "name": "Nguyễn Văn Quỳnh",
    "idNumber": "031081022033",
    "phone": "0967603996",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0989215833"
  },
  {
    "code": "LQTUYEN",
    "username": "lqtuyen",
    "name": "Lê Quang Tuyền",
    "idNumber": "027092012146",
    "phone": "0326059129",
    "bankName": "Hàng hải (MSB)",
    "bankAccount": "80000016796"
  },
  {
    "code": "TTQUAN",
    "username": "ttquan",
    "name": "Trần Thế Quân",
    "idNumber": "030091003096",
    "phone": "0982165163",
    "bankName": "Kỹ Thương (TCB)",
    "bankAccount": "2979686869"
  },
  {
    "code": "BVKIEM",
    "username": "bvkiem",
    "name": "Bùi Văn Kiệm",
    "idNumber": "030085020425",
    "phone": "0989112123",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0989112123"
  },
  {
    "code": "TVTHAM",
    "username": "tvtham",
    "name": "Tô Viết Thấm",
    "idNumber": "020082009871",
    "phone": "0982365118",
    "bankName": "Kỹ Thương (TCB)",
    "bankAccount": "881212128888"
  },
  {
    "code": "HQTHO",
    "username": "hqtho",
    "name": "Hoàng Quang Thơ",
    "idNumber": "015093006478",
    "phone": "0332702789",
    "bankName": "Hàng hải (MSB)",
    "bankAccount": "80001251274"
  },
  {
    "code": "LVDIEP",
    "username": "lvdiep",
    "name": "Lê Văn Diệp",
    "idNumber": "030088003622",
    "phone": "0376345569",
    "bankName": "Công Thương Việt Nam (VIETINBANK)",
    "bankAccount": "104582156789"
  },
  {
    "code": "LHNAM",
    "username": "lhnam",
    "name": "Lê Hải Nam",
    "idNumber": "030077022437",
    "phone": "0904609712",
    "bankName": "Đầu tư và phát triển (BIDV)",
    "bankAccount": "46110000370855"
  },
  {
    "code": "PVCAN",
    "username": "pvcan",
    "name": "Nguyễn Văn Cần",
    "idNumber": "027085003346",
    "phone": null,
    "bankName": "Hàng hải (MSB)",
    "bankAccount": "80000338995"
  },
  {
    "code": "PDPHUNG",
    "username": "pdphung",
    "name": "Phùng Đắc Phụng",
    "idNumber": "027088014447",
    "phone": null,
    "bankName": "Hàng hải (MSB)",
    "bankAccount": "03101011835094"
  },
  {
    "code": "NVHOAN",
    "username": "nvhoan",
    "name": "Nguyễn Văn Hoan",
    "idNumber": "027088003648",
    "phone": "0385596865",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1014892282"
  },
  {
    "code": "LVKHAI",
    "username": "lvkhai",
    "name": "Lê Văn Khải",
    "idNumber": "038090015135",
    "phone": "0983162141",
    "bankName": "Ngoại thương Việt Nam (VCB)",
    "bankAccount": "1032921556"
  },
  {
    "code": "DVDAI",
    "username": "dvdai",
    "name": "Đinh Văn Đại",
    "idNumber": "025090003558",
    "phone": "0971063590",
    "bankName": "Quân đội (MB)",
    "bankAccount": "0971063590"
  },
  {
    "code": "PXHUAN",
    "username": "pxhuan",
    "name": "Phí Xuân Hoàn",
    "idNumber": "025081014378",
    "phone": "0394812299",
    "bankName": "Sài Gòn Hà Nội (SHB)",
    "bankAccount": "198133683368"
  }
];

export const prodCustomers: ProdCustomerSeed[] = [
  {
    "name": "CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH",
    "shortName": "Long Minh",
    "code": "LONGMINH",
    "taxCode": "2300540419",
    "address": "Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh",
    "director": "LƯƠNG VĂN LONG",
    "directorPhone": "0912334455",
    "email": "longminh.logistic@gmail.com; account1@longminhbn.com.vn",
    "paymentTermChiHoDays": 25,
    "paymentTermCuocDays": 75
  },
  {
    "name": "CÔNG TY TNHH LOGCOM VIỆT NAM",
    "shortName": "LOG COM",
    "code": "LOGCOM",
    "taxCode": "2300975219",
    "address": "Đường Hoàng Hoa Thám, Phường Võ Cường, Tỉnh Bắc Ninh, Việt Nam",
    "director": "LƯƠNG VĂN AN",
    "directorPhone": "0988559068",
    "email": null,
    "paymentTermChiHoDays": 25,
    "paymentTermCuocDays": 75
  }
];

export const prodSites: ProdSiteSeed[] = [
  {
    "name": "CÔNG TY TNHH NEWEB VIỆT NAM",
    "code": "NEWEB-1",
    "shortName": "NEWEB-1",
    "customerCode": "LOGCOM",
    "routeName": "KCN Đồng Văn III, Ninh Bình",
    "address": "Lô đất CN01, Khu công nghiệp Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình, Việt Nam",
    "note": "\"3. Lưu ý cần chú ý khi đóng/ trả hàng tại nhà máy\n- Lái xe đăng ký bảo vệ vào đóng/ trả cho công ty Long Minh- Trước khi vào đóng/ trả hàng lái xe gọi đúng SĐT\nngười quản lý hàng xuất/nhập trong kho để hướng dẫn vị trí đóng/ trả hàng- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, ko thủng rách, dính dầu, nước, không, mù\"",
    "contactPhone": "Mr Ngọc Anh : 0989130345",
    "mapsUrl": "https://maps.app.goo.gl/ybazQGNV6aikJm4z8"
  },
  {
    "name": "CÔNG TY TNHH NEWEB VIỆT NAM",
    "code": "NEWEB-2",
    "shortName": "NEWEB-2",
    "customerCode": "LOGCOM",
    "routeName": "KCN Đồng Văn III, Ninh Bình",
    "address": "Một phần lô đất CN12, khu công nghiệp hỗ trợ Đồng Văn III, Phường Tiên Sơn, tỉnh Ninh Bình, Việt Nam",
    "note": "\"3. Lưu ý cần chú ý khi đóng/ trả hàng tại nhà máy\n- Lái xe đăng ký bảo vệ vào đóng/ trả cho công ty Long Minh- Trước khi vào đóng/ trả hàng lái xe gọi đúng SĐT\nngười quản lý hàng xuất/nhập trong kho để hướng dẫn vị trí đóng/ trả hàng- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, ko thủng rách, dính dầu, nước, không, mù\"",
    "contactPhone": "白班 --- CA NGÀY",
    "mapsUrl": "https://maps.app.goo.gl/36mrLqTitnj1i6Cu5"
  },
  {
    "name": "CÔNG TY TNHH NEWEB VIỆT NAM",
    "code": "NEWEB-3",
    "shortName": "NEWEB-3",
    "customerCode": "LOGCOM",
    "routeName": "KCN Đồng Văn I, Ninh Bình",
    "address": "Khu Công Nghiệp Đồng Văn I Mở Rộng , Phường Đồng Văn, Tỉnh Ninh Bình, Việt Nam",
    "note": "\"3. Lưu ý cần chú ý khi đóng/ trả hàng tại nhà máy\n- Lái xe đăng ký bảo vệ vào đóng/ trả cho công ty Long Minh- Trước khi vào đóng/ trả hàng lái xe gọi đúng SĐT\nngười quản lý hàng xuất/nhập trong kho để hướng dẫn vị trí đóng/ trả hàng- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, ko thủng rách, dính dầu, nước, không, mù\"",
    "contactPhone": "ANH CƯƠNG : 0971560672",
    "mapsUrl": "https://maps.app.goo.gl/eTrnQTm9enFiRiV19"
  },
  {
    "name": "CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM",
    "code": "ASKEY-1",
    "shortName": "ASKEY-1",
    "customerCode": "LONG MINH",
    "routeName": "KCN Quế Võ, Bắc Ninh",
    "address": "Lô C7-2,KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh, Việt Nam",
    "note": "\"*CÁC NỘI DUNG CẦN CHÚ Ý KHI ĐÓNG TRẢ NHÀ MÁY:\n- Trả  hàng xong chụp luôn BBGH lên nhóm ạ\n- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, ko thủng rách, ko dính dầu, nước\nLƯU Ý KHI ĐÓNG XONG HÀNG YÊU CẦU XE VỀ THẲNG CẢNG HẠ, KHÔNG ĐỖ DỪNG NGHỈ DỌC ĐƯỜNG QUÁ 30'. (CHỈ ĐƯỢC PHÉP TRONG 4H DI CHUYỂN TỪ NHÀ MÁY ĐẾN KHI HẠ HÀNG). NẾU PHÁT SINH KHÔNG HẠ KỊP BÁO NGAY LẠI KHI PHÁT SINH. HẠ HÀNG XONG GỬI LUÔN ẢNH PHƠI HẠ HÀNG, ĐỊNH VỊ CHO BÊN E NHÉ. KHÁCH RẤT KHÓ TÍNH VÀ NGHIÊM TRONG VẤN ĐỀ NÀY. NẾU KO THỰC HIỆN ĐÚNG KHÁCH KO THANH TOÁN CƯỚC ĐÂU Ạ.\"",
    "contactPhone": "Xưởng 1",
    "mapsUrl": "https://maps.app.goo.gl/YcxGG719wmH7knjR9"
  },
  {
    "name": "CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM",
    "code": "ASKEY-2",
    "shortName": "ASKEY-2",
    "customerCode": "LONG MINH",
    "routeName": "KCN Quế Võ, Bắc Ninh",
    "address": "Lô C7-2,KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh, Việt Nam",
    "note": "\"*CÁC NỘI DUNG CẦN CHÚ Ý KHI ĐÓNG TRẢ NHÀ MÁY:\n- Trả  hàng xong chụp luôn BBGH lên nhóm ạ\n- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, ko thủng rách, ko dính dầu, nước\nLƯU Ý KHI ĐÓNG XONG HÀNG YÊU CẦU XE VỀ THẲNG CẢNG HẠ, KHÔNG ĐỖ DỪNG NGHỈ DỌC ĐƯỜNG QUÁ 30'. (CHỈ ĐƯỢC PHÉP TRONG 4H DI CHUYỂN TỪ NHÀ MÁY ĐẾN KHI HẠ HÀNG). NẾU PHÁT SINH KHÔNG HẠ KỊP BÁO NGAY LẠI KHI PHÁT SINH. HẠ HÀNG XONG GỬI LUÔN ẢNH PHƠI HẠ HÀNG, ĐỊNH VỊ CHO BÊN E NHÉ. KHÁCH RẤT KHÓ TÍNH VÀ NGHIÊM TRONG VẤN ĐỀ NÀY. NẾU KO THỰC HIỆN ĐÚNG KHÁCH KO THANH TOÁN CƯỚC ĐÂU Ạ.\"",
    "contactPhone": "Xưởng 2",
    "mapsUrl": "https://maps.app.goo.gl/JXwySTuxyGARCcE57"
  },
  {
    "name": "CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)",
    "code": "SUNRISE",
    "shortName": "SUNRISE",
    "customerCode": "LONG MINH",
    "routeName": "KCN Vân Trung, Nếnh, Bắc Ninh",
    "address": "Một phần Lô CN-09, Khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh, Việt Nam",
    "note": "\"3. Nội dung lưu ý kho đóng/trả hàng\n- Lái xe vào nhà máy yêu cầu ăn mặc gọn gàng (quần áo dài )- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, không mùi, thủng rách ,dính dầu, nước\"",
    "contactPhone": "0946445198",
    "mapsUrl": "https://maps.app.goo.gl/Qh9GMWCAAu2TKXGcA"
  },
  {
    "name": "CÔNG TY TNHH MỘT THÀNH VIÊN SJ TECH VIỆT NAM",
    "code": "SJ TECH",
    "shortName": "SJ",
    "customerCode": "LONG MINH",
    "routeName": "KCN Vân Trung, Nếnh, Bắc Ninh",
    "address": "Lô số CN-16, khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh, Việt Nam",
    "note": "\"3. Nội dung lưu ý kho đóng/trả hàng\n- Lái xe vào nhà máy yêu cầu ăn mặc gọn gàng (quần áo dài )\n- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, không mùi, thủng rách ,dính dầu, nước\n-----------------------------------------------------------------------------------------------\n(LƯU Ý KHO BẮT BUỘC PHẢI CÓ BIÊN BẢN KÝ XÁC NHẬN ĐÓNG/ TRẢ HÀNG XONG - IN 2 BẢN ĐƯA LÁI XE CẦM THEO KÝ NHẬN\"",
    "contactPhone": "CHUYÊN: 0974987576",
    "mapsUrl": "https://maps.app.goo.gl/tRDrmQTXEmMfyEbx9"
  },
  {
    "name": "CÔNG TY TNHH S-CONNECT BG VINA",
    "code": "SCONECT",
    "shortName": "SCONECT",
    "customerCode": "LONG MINH",
    "routeName": "KCN Vân Trung, Nếnh, Bắc Ninh",
    "address": "Lô CN-17, Khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh, Việt NaM",
    "note": "\"3. Nội dung lưu ý kho đóng/trả hàng\n- Lái xe vào nhà máy yêu cầu ăn mặc gọn gàng (quần áo dài )\n- Nghiêm cấm hút thuốc trong địa phận công ty\n- Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe, không mùi, thủng rách ,dính dầu, nước\n-----------------------------------------------------------------------------------------------\n(LƯU Ý KHO BẮT BUỘC PHẢI CÓ BIÊN BẢN KÝ XÁC NHẬN ĐÓNG/ TRẢ HÀNG XONG - IN 2 BẢN ĐƯA LÁI XE CẦM THEO KÝ NHẬN\"",
    "contactPhone": "Ms. Huyền – 0358334025",
    "mapsUrl": "https://maps.app.goo.gl/7P66XdaioJAfnHb58"
  }
];

export const prodRoutes: ProdRouteSeed[] = [
  {
    "name": "Đồng Văn III",
    "fullName": "KCN Đồng Văn III, Đồng Văn, Ninh Bình",
    "shortName": "KCN Đồng Văn III, Hà Nam",
    "loadPoint": "Lô đất CN01, Khu công nghiệp Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình, Việt Nam",
    "distanceKm": null,
    "tolls": null
  },
  {
    "name": "Đồng Văn I",
    "fullName": "KCN Đồng Văn III, Đồng Văn, Ninh Bình",
    "shortName": "KCN Đồng Văn I, Hà Nam",
    "loadPoint": "Khu Công Nghiệp Đồng Văn I Mở Rộng , Phường Đồng Văn, Tỉnh Ninh Bình, Việt Nam",
    "distanceKm": null,
    "tolls": null
  },
  {
    "name": "KCN Quế Võ",
    "fullName": "KCN Quế Võ, Nam Sơn, Bắc Ninh",
    "shortName": "KCN Quế Võ, Bắc Ninh",
    "loadPoint": "Lô C7-2,KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh, Việt Nam",
    "distanceKm": null,
    "tolls": null
  },
  {
    "name": "Nếnh",
    "fullName": "KCN Vân Trung, Nếnh, Bắc Ninh",
    "shortName": "KCN Vâng Trung, Bắc Giang",
    "loadPoint": "Một phần Lô CN-09, Khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh, Việt Nam",
    "distanceKm": null,
    "tolls": null
  },
  {
    "name": "Nếnh 2",
    "fullName": "KCN Vân Trung, Nếnh, Bắc Ninh",
    "shortName": "KCN Vâng Trung, Bắc Giang",
    "loadPoint": "Lô số CN-16, khu công nghiệp Vân Trung, Phường Nếnh, Tỉnh Bắc Ninh, Việt Nam",
    "distanceKm": null,
    "tolls": null
  }
];

export const prodTractors: ProdTractorSeed[] = [
  {
    "plate": "15E-016.26",
    "driverName": "Nguyễn Duy Tuấn",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-052.82",
    "driverName": "Đinh Thanh Thịnh",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-055.79",
    "driverName": "Bùi Văn Hậu",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-207.01",
    "driverName": "Lê Văn Khải",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-076.36",
    "driverName": "Hoàng Trọng Hùng",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-076.50",
    "driverName": "Vũ Văn Trung",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15C-167.31",
    "driverName": "Lương Văn Long",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-205.57",
    "driverName": "Nguyễn Văn Hoàn",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-209.51",
    "driverName": "Phí Xuân Hoàn",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-209.49",
    "driverName": "Đinh Văn Đại",
    "type": "2 CẦU 3 DÀN"
  },
  {
    "plate": "15H-087.19",
    "driverName": "Trần Trung Hiếu",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15E-019.80",
    "driverName": "Nguyễn Huy Vương",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15H-118.47",
    "driverName": "Lục Văn Lô",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15H-118.97",
    "driverName": "Phạm Thanh Sơn",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15F-016.98",
    "driverName": "Bùi Văn An",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15E-018.83",
    "driverName": "Bùi Ngọc Long",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15E-018.83",
    "driverName": "Nguyễn Thế Vũ",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15C-184.62",
    "driverName": "Nguyễn Văn Thọ",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15H-039.39",
    "driverName": "Phạm Ngọc Văn",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15H-021.39",
    "driverName": "Dương Văn Thực",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15H-002.14",
    "driverName": "Trần Đức Trung",
    "type": "1 CẦU 2 DÀN"
  },
  {
    "plate": "15H-085.66",
    "driverName": "Nguyễn Văn Dương",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-116,24",
    "driverName": "Lưu Văn Tuyền",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-117.55",
    "driverName": "Nguyễn Văn Dung",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-119.64",
    "driverName": "Phan Văn Trường",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-149.80",
    "driverName": "Nguyễn Văn Quỳnh",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-119.87",
    "driverName": "Lê Ngọc Long",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-175.17",
    "driverName": "Lê Hải Nam",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-174.81",
    "driverName": "Lê Văn Điệp",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-15077",
    "driverName": "Lê Quang Tuyền",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-147.38",
    "driverName": "Vũ Văn Chính",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-15498",
    "driverName": "Tô Viết Thấm",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-154.26",
    "driverName": "Trần Thế Quân",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-15438",
    "driverName": "Bùi Văn Kiệm",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-176.93",
    "driverName": "Lê Quang Hảo",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-176.93",
    "driverName": "Phùng Đắc Phụng",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-174.23",
    "driverName": "Hoàng Quang Thơ",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-176.51",
    "driverName": "Nguyễn Văn Cần",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-104.03",
    "driverName": "Bùi Tiến Dũng",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-121.95",
    "driverName": "Trần Văn Thắng",
    "type": "1 CẦU 3 DÀN"
  },
  {
    "plate": "15H-061.14",
    "driverName": "Bùi Quang Hường",
    "type": "1 CẦU 3 DÀN"
  }
];

export const prodTrailers: ProdTrailerSeed[] = [
  {
    "plate": "15RM-007.55",
    "pairedTractor": "15E-016.26",
    "type": null
  },
  {
    "plate": "15R-182.06",
    "pairedTractor": "15H-052.82",
    "type": null
  },
  {
    "plate": "15R-184.18",
    "pairedTractor": "15H-055.79",
    "type": null
  },
  {
    "plate": "15RM-034.16",
    "pairedTractor": "15H-207.01",
    "type": null
  },
  {
    "plate": "15R-068.52",
    "pairedTractor": "15H-076.36",
    "type": null
  },
  {
    "plate": "15R-089.78",
    "pairedTractor": "15H-076.50",
    "type": null
  },
  {
    "plate": "15R-103.08",
    "pairedTractor": "15C-167.31",
    "type": null
  },
  {
    "plate": "15R-09689",
    "pairedTractor": "15H-205.57",
    "type": null
  },
  {
    "plate": "15RM-077.01",
    "pairedTractor": "15H-209.51",
    "type": null
  },
  {
    "plate": "15RM-07700",
    "pairedTractor": "15H-209.49",
    "type": null
  },
  {
    "plate": "15RM-017.97",
    "pairedTractor": "15H-087.19",
    "type": null
  },
  {
    "plate": "15RM-008.02",
    "pairedTractor": "15E-019.80",
    "type": null
  },
  {
    "plate": "15RM027,54",
    "pairedTractor": "15H-118.47",
    "type": null
  },
  {
    "plate": "15RM-02934",
    "pairedTractor": "15H-118.97",
    "type": null
  },
  {
    "plate": "15RM-001.41",
    "pairedTractor": "15F-016.98",
    "type": null
  },
  {
    "plate": "15RM-006.78",
    "pairedTractor": "15E-018.83",
    "type": null
  },
  {
    "plate": "15RM-023,26",
    "pairedTractor": "15C-184.62",
    "type": null
  },
  {
    "plate": "15RM-171.96",
    "pairedTractor": "15H-039.39",
    "type": null
  },
  {
    "plate": "15RM-013.12",
    "pairedTractor": "15H-021.39",
    "type": null
  },
  {
    "plate": "15RM-018.38",
    "pairedTractor": "15H-085.66",
    "type": null
  },
  {
    "plate": "15RM-026.14",
    "pairedTractor": "15H-116.24",
    "type": null
  },
  {
    "plate": "15RM02944",
    "pairedTractor": "15H-117.55",
    "type": null
  },
  {
    "plate": "15RM-02971",
    "pairedTractor": "15H-119.64",
    "type": null
  },
  {
    "plate": "15RM-053.76",
    "pairedTractor": "15H-149.80",
    "type": null
  },
  {
    "plate": "15RM-02628",
    "pairedTractor": "15H-119.87",
    "type": null
  },
  {
    "plate": "15RM-06661",
    "pairedTractor": "15H-175.17",
    "type": null
  },
  {
    "plate": "15RM-066.67",
    "pairedTractor": "15H-174.81",
    "type": null
  },
  {
    "plate": "15RM-054.53",
    "pairedTractor": "15H-150.77",
    "type": null
  },
  {
    "plate": "15RM-053.05",
    "pairedTractor": "15H-147.38",
    "type": null
  },
  {
    "plate": "15RM-055.47",
    "pairedTractor": "15H-154.98",
    "type": null
  },
  {
    "plate": "15RM-053.12",
    "pairedTractor": "15H-154.26",
    "type": null
  },
  {
    "plate": "15RM-054.29",
    "pairedTractor": "15H-154.38",
    "type": null
  },
  {
    "plate": "15RM-066.65",
    "pairedTractor": "15H-176.93",
    "type": null
  },
  {
    "plate": "15RM-066.60",
    "pairedTractor": "15H-174.23",
    "type": null
  },
  {
    "plate": "15RM-066.62",
    "pairedTractor": "15H-176.51",
    "type": null
  },
  {
    "plate": "15RM-107.28",
    "pairedTractor": "15H-104.03",
    "type": null
  },
  {
    "plate": "15RM-107.29",
    "pairedTractor": "15H-121.95",
    "type": null
  },
  {
    "plate": "15RM-107.33",
    "pairedTractor": "15H-061.14",
    "type": null
  }
];
