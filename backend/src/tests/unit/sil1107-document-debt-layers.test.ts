// SIL-1107 (KB §3.5.4) — the "Nợ chứng từ" screen's three document-status
// layers. Pure derivation, no db / app boot (BE unit-only law, 2026-10-19
// ruling): e-POD (Lớp 1) · bộ hồ sơ chứng từ gốc (Lớp 2) · nhận phơi
// (Lớp 3) stay three SEPARATE states, each naming the documents it owes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ShipmentDocumentDebtLayer,
  ShipmentDocumentSetStatus,
  TripPodFileType,
} from '@tingting/shared';
import {
  buildShipmentDocumentDebtLayers,
  shipmentDocumentDebtHasOpenLayer,
  type DocumentDebtLayerFacts,
} from '../../services/shipment-document-debt-layers';

const facts = (over: Partial<DocumentDebtLayerFacts> = {}): DocumentDebtLayerFacts => ({
  documentSet: { status: ShipmentDocumentSetStatus.COMPLETE, missingDocuments: [] },
  pod: [],
  phoi: [],
  ...over,
});

describe('SIL-1107 — buildShipmentDocumentDebtLayers: ba lớp độc lập', () => {
  it('trả đủ ba lớp theo thứ tự KB §3.5.4, không gộp làm một', () => {
    const layers = buildShipmentDocumentDebtLayers(facts());
    assert.deepEqual(layers.map((item) => item.layer), [
      ShipmentDocumentDebtLayer.EPOD,
      ShipmentDocumentDebtLayer.DOCUMENT_SET,
      ShipmentDocumentDebtLayer.PHOI,
    ]);
    assert.deepEqual(layers.map((item) => item.label), [
      'e-POD',
      'Bộ hồ sơ chứng từ gốc',
      'Phiếu phơi',
    ]);
  });

  it('Lớp 1 — nêu TÊN tài liệu e-POD chưa lưu, theo tập bắt buộc của chế độ hàng', () => {
    const [epod] = buildShipmentDocumentDebtLayers(facts({
      pod: [{
        required: true,
        cargoMode: 'FCL',
        presentFileTypes: [TripPodFileType.YARD_OR_DROP_RECEIPT],
      }],
    }));
    assert.equal(epod.ok, false);
    assert.equal(epod.status, 'Chưa có');
    assert.deepEqual(epod.missingDocuments, ['Biên bản giao nhận có ký nhận']);

    // SIL-918 — hàng lẻ carries no phiếu hạ: the LCL evidence set is the
    // biên bản giao nhận alone, so it is never owed.
    const [lcl] = buildShipmentDocumentDebtLayers(facts({
      pod: [{ required: true, cargoMode: 'LCL', presentFileTypes: [] }],
    }));
    assert.deepEqual(lcl.missingDocuments, ['Biên bản giao nhận có ký nhận']);
    assert.equal(lcl.ok, false);
  });

  it('Lớp 1 — lô không có chuyến e-POD thì lớp này không áp dụng, không nợ gì', () => {
    const [epod] = buildShipmentDocumentDebtLayers(facts());
    assert.equal(epod.applicable, false);
    assert.equal(epod.ok, true);
    assert.deepEqual(epod.missingDocuments, []);
    assert.equal(epod.status, 'Không có chuyến e-POD');
  });

  it('Lớp 1 — một chuyến đã lưu đủ tệp thì lớp đóng, không nợ tài liệu nào', () => {
    const [epod] = buildShipmentDocumentDebtLayers(facts({
      pod: [{
        required: true,
        cargoMode: 'FCL',
        presentFileTypes: [TripPodFileType.YARD_OR_DROP_RECEIPT, TripPodFileType.SIGNED_DELIVERY_NOTE],
      }],
    }));
    assert.equal(epod.ok, true);
    assert.equal(epod.status, 'Đã lưu');
    assert.deepEqual(epod.missingDocuments, []);
  });

  it('Lớp 2 — bộ hồ sơ gốc chưa ghi danh mục thì nói thẳng, không bịa danh sách', () => {
    const [, documentSet] = buildShipmentDocumentDebtLayers(facts({
      documentSet: { status: ShipmentDocumentSetStatus.MISSING, missingDocuments: [] },
    }));
    assert.equal(documentSet.ok, false);
    assert.equal(documentSet.status, 'Còn thiếu');
    assert.deepEqual(documentSet.missingDocuments, ['Chưa ghi nhận danh mục']);
  });

  it('Lớp 2 — bộ hồ sơ gốc đủ thì đóng lớp, không nợ tài liệu nào', () => {
    const [, documentSet] = buildShipmentDocumentDebtLayers(facts({
      documentSet: { status: ShipmentDocumentSetStatus.COMPLETE, missingDocuments: [] },
    }));
    assert.equal(documentSet.ok, true);
    assert.equal(documentSet.status, 'Đã đủ');
    assert.deepEqual(documentSet.missingDocuments, []);
  });

  it('Lớp 3 — chuyến chưa nhận phơi thì nêu TÊN phiếu phơi kèm chuyến', () => {
    const [, , phoi] = buildShipmentDocumentDebtLayers(facts({
      phoi: [
        { tripId: 7, tripCode: 'TRP-7', phoiTakenDate: null },
        { tripId: 8, tripCode: 'TRP-8', phoiTakenDate: '2026-11-26' },
      ],
    }));
    assert.equal(phoi.ok, false);
    assert.equal(phoi.status, 'Chưa nhận phơi');
    assert.deepEqual(phoi.missingDocuments, ['Phiếu phơi chuyến TRP-7']);
    assert.equal(phoi.detail, 'Chưa nhận phơi 1/2 chuyến');
  });

  it('lô không có chuyến đi thì lớp phơi không áp dụng — không nợ phiếu phơi nào', () => {
    const [, , phoi] = buildShipmentDocumentDebtLayers(facts());
    assert.equal(phoi.applicable, false);
    assert.equal(phoi.ok, true);
    assert.equal(phoi.status, 'Không có chuyến đi lấy phơi');
  });

  it('lô nợ chứng từ khi BẤT KỲ lớp nào còn mở — hồ sơ gốc đủ không che e-POD', () => {
    const complete = buildShipmentDocumentDebtLayers(facts({
      pod: [{ required: true, cargoMode: 'FCL', presentFileTypes: [] }],
    }));
    assert.equal(shipmentDocumentDebtHasOpenLayer(complete), true);

    const allClosed = buildShipmentDocumentDebtLayers(facts({
      pod: [{
        required: true,
        cargoMode: 'FCL',
        presentFileTypes: [TripPodFileType.YARD_OR_DROP_RECEIPT, TripPodFileType.SIGNED_DELIVERY_NOTE],
      }],
    }));
    assert.equal(shipmentDocumentDebtHasOpenLayer(allClosed), false);
  });
});
