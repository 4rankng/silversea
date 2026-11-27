// SIL-1107 (KB §3.5.4) — the THREE independent document-status layers of one
// lot, PURE.
//
// KB §3.5.4 names three layers that never infer each other:
//
//   Lớp 1 — e-POD          (Chưa có / Đã lưu / Chưa đọc được)
//   Lớp 2 — bộ hồ sơ gốc   (Còn thiếu / Đang bổ sung / Đã đủ)
//   Lớp 3 — nhận phơi       (Chưa nhận phơi / Đã nhận phơi)
//
// and the "Nợ chứng từ" screen must NAME the documents each layer still owes.
// This module derives that breakdown from facts that already exist (no new DB
// state), so the debt screen and the lot's own status block read the same
// evidence.
//
// Split out of the debt service so the unit tree can pin the law without a db
// import (2026-10-19 owner ruling) — the same seam as
// shipment-status-summary-law.ts.
//
// Laws:
//  - A layer with nothing to owe is NOT a debt: a lot with no live trip owes
//    no phơi, a lot with no e-POD obligation owes no e-POD. The layer then
//    says so ('Không có chuyến e-POD') instead of pretending it is complete.
//  - The layers never borrow each other's state: Lớp 1 is decided by the
//    saved e-POD files, Lớp 2 by the document-set fact, Lớp 3 by the phơi
//    date. A complete Lớp 2 never hides an open Lớp 1.
//  - A missing document is named, never counted: the screen answers "còn
//    thiếu tài liệu gì?" with the document's own name.

import {
  SHIPMENT_DOCUMENT_DEBT_LAYER_LABELS,
  SHIPMENT_DOCUMENT_SET_STATUS_LABELS,
  ShipmentDocumentDebtLayer,
  ShipmentDocumentSetStatus,
  TRIP_POD_FILE_LABELS,
  missingPodFileTypes,
  type ShipmentDocumentDebtLayerItem,
} from '@tingting/shared';

/** One fulfillment's e-POD evidence (Lớp 1). */
export interface DocumentDebtPodFact {
  /** The fulfillment still requires e-POD (a waived/canceled one does not). */
  required: boolean;
  /** SIL-918: the required e-POD set is mode-aware (hàng lẻ carries no phiếu hạ). */
  cargoMode: string;
  /** The file types saved in the fulfillment's current e-POD submission. */
  presentFileTypes: string[];
}

/** One live trip's phơi state (Lớp 3). */
export interface DocumentDebtPhoiFact {
  tripId: number;
  tripCode: string | null;
  /** The date the paper phơi was taken; null = the lot still owes it. */
  phoiTakenDate: string | null;
}

export interface DocumentDebtLayerFacts {
  /** Lớp 2 — the lot's latest document-set fact (null = 'Còn thiếu'). */
  documentSet: {
    status: ShipmentDocumentSetStatus;
    missingDocuments: string[];
  } | null;
  /** Lớp 1 — the lot's e-POD facts. */
  pod: DocumentDebtPodFact[];
  /** Lớp 3 — the lot's live trips. */
  phoi: DocumentDebtPhoiFact[];
}

/** Lớp 1 — e-POD. The layer is open while a required file type was never
 *  saved on any trip that still owes an e-POD. */
function buildEpodLayer(facts: DocumentDebtLayerFacts): ShipmentDocumentDebtLayerItem {
  const requiredFacts = facts.pod.filter((fact) => fact.required);
  if (requiredFacts.length === 0) {
    return {
      layer: ShipmentDocumentDebtLayer.EPOD,
      label: SHIPMENT_DOCUMENT_DEBT_LAYER_LABELS[ShipmentDocumentDebtLayer.EPOD],
      status: 'Không có chuyến e-POD',
      ok: true,
      applicable: false,
      missingDocuments: [],
      detail: null,
    };
  }
  const missing = new Set<string>();
  let missingCount = 0;
  for (const fact of requiredFacts) {
    const absent = missingPodFileTypes(fact.presentFileTypes, fact.cargoMode);
    missingCount += absent.length;
    for (const fileType of absent) {
      missing.add(TRIP_POD_FILE_LABELS[fileType]);
    }
  }
  const names = [...missing];
  return {
    layer: ShipmentDocumentDebtLayer.EPOD,
    label: SHIPMENT_DOCUMENT_DEBT_LAYER_LABELS[ShipmentDocumentDebtLayer.EPOD],
    status: names.length === 0 ? 'Đã lưu' : 'Chưa có',
    ok: names.length === 0,
    applicable: true,
    missingDocuments: names,
    detail: names.length === 0
      ? null
      : `${missingCount} tài liệu e-POD chưa lưu trên ${requiredFacts.length} chuyến`,
  };
}

/** Lớp 2 — bộ hồ sơ chứng từ gốc. The absence of a fact IS the debt. */
function buildDocumentSetLayer(facts: DocumentDebtLayerFacts): ShipmentDocumentDebtLayerItem {
  const status = facts.documentSet?.status ?? ShipmentDocumentSetStatus.MISSING;
  const ok = status === ShipmentDocumentSetStatus.COMPLETE;
  const recorded = (facts.documentSet?.missingDocuments ?? []).filter((name) => name.trim() !== '');
  // An open set whose document list nobody wrote yet still owes documents —
  // the screen must say so instead of showing an empty cell.
  const names = !ok && recorded.length === 0 ? ['Chưa ghi nhận danh mục'] : recorded;
  return {
    layer: ShipmentDocumentDebtLayer.DOCUMENT_SET,
    label: SHIPMENT_DOCUMENT_DEBT_LAYER_LABELS[ShipmentDocumentDebtLayer.DOCUMENT_SET],
    status: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[status],
    ok,
    applicable: true,
    missingDocuments: names,
    detail: ok
      ? null
      : `Bộ hồ sơ gốc ${status === ShipmentDocumentSetStatus.SUPPLEMENTING ? 'đang bổ sung' : 'còn thiếu'}`,
  };
}

/** Lớp 3 — nhận phơi. The paper phơi of a live trip is taken (ngày lấy phơi). */
function buildPhoiLayer(facts: DocumentDebtLayerFacts): ShipmentDocumentDebtLayerItem {
  if (facts.phoi.length === 0) {
    return {
      layer: ShipmentDocumentDebtLayer.PHOI,
      label: SHIPMENT_DOCUMENT_DEBT_LAYER_LABELS[ShipmentDocumentDebtLayer.PHOI],
      status: 'Không có chuyến đi lấy phơi',
      ok: true,
      applicable: false,
      missingDocuments: [],
      detail: null,
    };
  }
  const owed = facts.phoi.filter((fact) => fact.phoiTakenDate == null);
  return {
    layer: ShipmentDocumentDebtLayer.PHOI,
    label: SHIPMENT_DOCUMENT_DEBT_LAYER_LABELS[ShipmentDocumentDebtLayer.PHOI],
    status: owed.length === 0 ? 'Đã nhận phơi' : 'Chưa nhận phơi',
    ok: owed.length === 0,
    applicable: true,
    missingDocuments: owed.map((fact) => {
      const code = fact.tripCode?.trim();
      return code ? `Phiếu phơi chuyến ${code}` : 'Phiếu phơi';
    }),
    detail: owed.length === 0
      ? null
      : `Chưa nhận phơi ${owed.length}/${facts.phoi.length} chuyến`,
  };
}

/** The three layers in KB §3.5.4 order — three states, never merged. */
export function buildShipmentDocumentDebtLayers(
  facts: DocumentDebtLayerFacts,
): ShipmentDocumentDebtLayerItem[] {
  return [buildEpodLayer(facts), buildDocumentSetLayer(facts), buildPhoiLayer(facts)];
}

/** A lot owes documents while ANY of its three layers is open. */
export function shipmentDocumentDebtHasOpenLayer(
  layers: ShipmentDocumentDebtLayerItem[],
): boolean {
  return layers.some((layer) => !layer.ok);
}
