// SIL-1107 (KB §3.5.4) + SIL-918 (KB §3.5.2/§3.6.1) — the e-POD document
// names and the mode-aware required set. These live in the shared package so
// the driver's screen and the "Nợ chứng từ" screen cannot disagree about what
// a lot owes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIP_POD_FILE_LABELS,
  TripPodFileType,
  missingPodFileTypes,
  requiredPodFileTypes,
} from './constants';

describe('SIL-1107 — tên tài liệu e-POD', () => {
  it('đặt tên đúng tài liệu KB nêu, mỗi loại một tên', () => {
    assert.equal(TRIP_POD_FILE_LABELS[TripPodFileType.YARD_OR_DROP_RECEIPT], 'Phiếu bãi / phiếu hạ');
    assert.equal(TRIP_POD_FILE_LABELS[TripPodFileType.SIGNED_DELIVERY_NOTE], 'Biên bản giao nhận có ký nhận');
    assert.equal(TRIP_POD_FILE_LABELS[TripPodFileType.TOLL_TICKET], 'Vé cầu đường');
  });
});

describe('SIL-918 — tập tài liệu e-POD bắt buộc theo chế độ hàng', () => {
  it('FCL (và chế độ chưa biết) bắt buộc cả phiếu bãi lẫn biên bản', () => {
    assert.deepEqual(requiredPodFileTypes('FCL'), [
      TripPodFileType.YARD_OR_DROP_RECEIPT,
      TripPodFileType.SIGNED_DELIVERY_NOTE,
    ]);
    assert.deepEqual(requiredPodFileTypes(null), [
      TripPodFileType.YARD_OR_DROP_RECEIPT,
      TripPodFileType.SIGNED_DELIVERY_NOTE,
    ]);
  });

  it('hàng lẻ không có container nên không nợ phiếu hạ bãi', () => {
    assert.deepEqual(requiredPodFileTypes('LCL'), [TripPodFileType.SIGNED_DELIVERY_NOTE]);
  });

  it('chỉ nêu loại tài liệu chưa có, không nêu loại đã lưu', () => {
    assert.deepEqual(
      missingPodFileTypes([TripPodFileType.YARD_OR_DROP_RECEIPT], 'FCL'),
      [TripPodFileType.SIGNED_DELIVERY_NOTE],
    );
    assert.deepEqual(
      missingPodFileTypes(
        [TripPodFileType.YARD_OR_DROP_RECEIPT, TripPodFileType.SIGNED_DELIVERY_NOTE],
        'FCL',
      ),
      [],
    );
  });
});
