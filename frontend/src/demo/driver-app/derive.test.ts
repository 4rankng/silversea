/**
 * SIL-162 unit pins for the driver-app derivations (TC-SIL162-02): kẹp đôi
 * detection, financial guidance lines per fee arrangement, OCR demo values
 * (seed spec vs synthesized), and the day-trip selector. Pure functions —
 * no rendering.
 */
import { describe, expect, it } from 'vitest';
import { demoTrips } from '../data';
import { DRIVER_APP_DAY, attendanceTime, driverDayTrips, financeLines, isTwinLiftTrip, ocrDemoValues, routeStops } from './derive';

const byId = (id: string) => demoTrips.find((t) => t.id === id)!;

describe('driverDayTrips — chọn góc nhìn tài xế (TC-SIL162-01)', () => {
  it('DRV-01 có 2 chuyến trong ngày demo, DRV-02 có 3 (gồm cặp kẹp)', () => {
    expect(driverDayTrips('DRV-01')).toHaveLength(2);
    expect(driverDayTrips('DRV-02')).toHaveLength(3);
  });

  it('xếp theo giờ có mặt tăng dần', () => {
    const times = driverDayTrips('DRV-02').map(attendanceTime);
    expect(times).toEqual([...times].sort());
    expect(times[0]).toBe('04:30'); // T-2403/T-2404 nâng kẹp sớm nhất
  });

  it('không lọt chuyến của ngày khác hay của tài xế khác', () => {
    const ids = driverDayTrips('DRV-01').map((t) => t.id);
    expect(ids).toEqual(['T-2401', 'T-2402']);
    for (const t of driverDayTrips('DRV-01')) {
      expect(t.driverId).toBe('DRV-01');
      expect(t.date).toBe(DRIVER_APP_DAY);
    }
  });
});

describe('isTwinLiftTrip — badge CHẠY KẸP (TC-SIL162-02)', () => {
  it('cặp 20′ cùng booking SITVBM9911455 của TRK-02 là kẹp đôi', () => {
    expect(isTwinLiftTrip(byId('T-2403'))).toBe(true);
    expect(isTwinLiftTrip(byId('T-2404'))).toBe(true);
  });

  it('chuyến đơn (dù cùng đầu kéo) không kẹp', () => {
    expect(isTwinLiftTrip(byId('T-2401'))).toBe(false);
    expect(isTwinLiftTrip(byId('T-2405'))).toBe(false);
  });
});

describe('routeStops — chip lộ trình (TC-SIL162-02)', () => {
  it('chuyến vòng 3 điểm: cảng nâng ➔ nhà máy ➔ cảng hạ', () => {
    expect(routeStops(byId('T-2401')).map((s) => s.label)).toEqual(['Cát Lái', 'Samsung SEHC', 'Cát Lái']);
    expect(routeStops(byId('T-2401')).map((s) => s.kind)).toEqual(['lift', 'factory', 'drop']);
  });

  it('chuyến nhập giao nhà máy chỉ 2 điểm (không trả vỏ)', () => {
    expect(routeStops(byId('T-2402')).map((s) => s.label)).toEqual(['VICT', 'Nhựa Duy Tan (VSIP II)']);
  });
});

describe('financeLines — chỉ dẫn tài chính tại cảng (TC-SIL162-02)', () => {
  it('lift UNC đã chuyển → 🟢 vào lấy lệnh', () => {
    expect(financeLines(byId('T-2401'))).toEqual([{ tone: 'green', text: 'Công ty đã UNC — vào lấy lệnh' }]);
  });

  it('lift UNC đã trả + phụ phí tự chi → 🟢 kèm dòng 🟠 phụ phí (T-2413)', () => {
    const lines = financeLines(byId('T-2413'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ tone: 'green', text: 'Công ty đã UNC — vào lấy lệnh' });
    expect(lines[1].tone).toBe('orange');
    expect(lines[1].text).toContain('Tự chi phụ phí 150.000 ₫');
    expect(lines[1].text).toContain('HĐ về tên Tổng CTY CP Cát Lái');
  });

  it('lift driver-cash gộp tổng tự chi + đơn vị hóa đơn (T-2402 = 1.430.000 ₫)', () => {
    const lines = financeLines(byId('T-2402'));
    expect(lines).toHaveLength(1);
    expect(lines[0].tone).toBe('orange');
    expect(lines[0].text).toBe('Lái xe tự chi 1.430.000 ₫ — HĐ về tên Công ty CP VICT');
  });

  it('lift driver-cash đơn lẻ (T-2406 = 2.150.000 ₫ phí nâng 40′ Cát Lái)', () => {
    expect(financeLines(byId('T-2406'))).toEqual([
      { tone: 'orange', text: 'Lái xe tự chi 2.150.000 ₫ — HĐ về tên Tổng CTY CP Cát Lái' },
    ]);
  });

  it('lift UNC chưa duyệt → 🟡 chờ kế toán (T-2407)', () => {
    expect(financeLines(byId('T-2407'))).toEqual([
      { tone: 'yellow', text: 'Chờ kế toán UNC phí nâng — chưa vào lấy lệnh được' },
    ]);
  });

  it('lift UNC chưa duyệt + phụ phí tự chi → 🟡 rồi 🟠 (T-2408)', () => {
    const lines = financeLines(byId('T-2408'));
    expect(lines).toHaveLength(2);
    expect(lines[0].tone).toBe('yellow');
    expect(lines[1].tone).toBe('orange');
    expect(lines[1].text).toContain('Tự chi phụ phí 200.000 ₫');
  });
});

describe('ocrDemoValues — 4 ô sau AI OCR (TC-SIL162-03)', () => {
  it('chuyến có containerSpec đọc đúng số liệu seed', () => {
    expect(ocrDemoValues(byId('T-2401'))).toEqual({
      contNo: 'MSKU 7648291',
      sealNo: 'SL-88124',
      maxGrossKg: '32500',
      tareKg: '3900',
    });
  });

  it('chuyến thiếu spec (T-2404) điền giá trị demo suy từ contNo + cỡ cont', () => {
    expect(ocrDemoValues(byId('T-2404'))).toEqual({
      contNo: 'GLDU 3395018',
      sealNo: 'SL-3395018',
      maxGrossKg: '30480',
      tareKg: '2250',
    });
  });
});
