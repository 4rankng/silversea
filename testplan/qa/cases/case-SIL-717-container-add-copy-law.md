# Case SIL-717 (id 837) — Thêm container tự copy mọi trường từ dòng trên, TRỪ số cont + loại cont

## Luật (KB 06/11, mở rộng SIL-180 card 221026173728)

Khi bấm **Thêm container** (CUS Tổng quan), dòng mới tự copy **TẤT CẢ** trường từ
dòng trên liền kề — TRỪ **Số container** + **Loại container** (hai trường đó để
trống cho người nhập). Trọng lượng PHẢI copy (owner ruling REQ-22 / SIL-180).

- Shared owner: `frontend/src/features/shipments/containerCopyLaw.ts`
  (`CONTAINER_ADD_COPY_KEYS` — loại trừ 2 trường ở mức TYPE).
- Wire: `frontend/src/features/shipments/cus/cusContainerAdd.ts`
  (`cusContainerAddCopy` + `cusContainerAddPayload` — FE gửi explicit để copy
  theo dòng ĐÚNG phía trên, không theo sibling cũ nhất của server).
- Form: `frontend/src/features/shipments/ContainerAddForm.tsx` (seed weight từ
  copy; số cont + loại cont rỗng).
- Pin: `frontend/src/features/shipments/ContainerAddForm.sil717.test.tsx` (form)
  + `frontend/src/features/shipments/cus/cusContainerAdd.test.ts` (law + wire).

## Cách tái hiện (đã chạy 09/11, local main 6d7a3886)

1. Login CUS `tiepvv` → /shipments/new → tạo lô FCL (LONG MINH, Bill
   R8B717-FCL, Nhập khẩu, dòng 1: TSTU1712008 / 20DC / 12.000 kg / ASKEY-XƯỞNG 1
   / KCN QUẾ VÕ / Cảng Green Port / Cảng Chùa Vẽ / 20/11 10:00).
2. Mở Chi tiết lô → bấm **Thêm container** → form hiện caption
   "Copy từ container 1 · …", **Trọng lượng (kg) seed 12000.00**, Số container +
   Loại container RỖNG.
3. Nhập số cont mới (TSTU1712100) + loại → Lưu.

## Kết quả mong đợi

- Dòng 2 trong DB (`shipment_containers`): `cargo_weight_kg = 12000.00`,
  route/site/cảng/ngày giờ KHỚP dòng 1; `container_number` + `container_type_id`
  là giá trị người nhập.
- Đã chứng minh 09/11: row 2435 `TSTU1712100 | 1 | 12000.00 | 5 | 6 | 5 | 18 |
  2026-11-20 03:00+00` (qa/2026-11-09_SIL-717_db-proof.txt).

## Bài học QA — false regression 08/11 (staging c4cea6b6)

Driver script bơm trọng lượng dòng 1 qua DOM (synthetic input) mà React state
không nhận → row 1 lưu `NULL` → seed dòng 2 rỗng, nhìn như mất copy. DOM vẫn
đọc được "12.000" (giá trị bơm) trong khi DB là NULL. Khi drive, giá trị phải
vào React state (nhập thật hoặc native-setter + input event) và phải đối chiếu
DB, không đối chiếu DOM. Trên origin/main 6d7a3886 KHÔNG tái hiện được lỗi copy.
