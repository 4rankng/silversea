import { describe, expect, it } from 'vitest';
import {
  containsInternalCode,
  stripInternalCodeFromFileName,
  stripInternalCodes,
} from './internalCode';

// Card 261022201006c / PRD ManHinhLaiXe §3.1: the app lái xe shows NO raw
// internal code — not on the cards, not in notification copy, not in a
// document's file name. The trip code stays in the DB and the API payload;
// only the display is cleaned. These pins cover EVERY code shape the platform
// stores, so a new shape cannot slip through a narrow regex again.
describe('internalCode — the shared owner of "this is an internal code"', () => {
  describe('stripInternalCodes (prose)', () => {
    it('strips the canonical trip code', () => {
      expect(stripInternalCodes('Chuyến TRP-202610-0028 đã được điều xe'))
        .toBe('Chuyến đã được điều xe');
    });

    it('strips the seeded TRP-YYYY-MM-NNNN shape', () => {
      expect(stripInternalCodes('Chuyến TRP-2026-10-0028 đã được tạo'))
        .toBe('Chuyến đã được tạo');
    });

    it('strips a legacy trip code', () => {
      expect(stripInternalCodes('Chuyến TRP-C12-53-1791212851260-gvr4vb đã được tạo'))
        .toBe('Chuyến đã được tạo');
    });

    it('strips the bulk-seed trip code', () => {
      expect(stripInternalCodes('Chuyến BULK-TR-0011 đã được điều xe'))
        .toBe('Chuyến đã được điều xe');
    });

    it('strips a legacy container-shaped trip code', () => {
      expect(stripInternalCodes('Chuyến CN-MSCU1234561-1 đã được tạo'))
        .toBe('Chuyến đã được tạo');
    });

    it('strips the shipment code', () => {
      expect(stripInternalCodes('Lô SHP-2610-00069 đã được điều xe'))
        .toBe('Lô đã được điều xe');
    });

    it('strips every code in the message', () => {
      expect(stripInternalCodes('Chuyến TRP-202609-0001 đã hoàn thành và TRP-202609-0002 đã hủy'))
        .toBe('Chuyến đã hoàn thành và đã hủy');
    });

    it('keeps the business reference (số Bill/Booking) untouched', () => {
      expect(stripInternalCodes('Chuyến BL-2026-001 đã được điều xe'))
        .toBe('Chuyến BL-2026-001 đã được điều xe');
      expect(stripInternalCodes('Booking HANGH7523800 đã được điều xe'))
        .toBe('Booking HANGH7523800 đã được điều xe');
    });

    it('keeps an address that merely contains "CN-"', () => {
      // "Lô CN-09" is a Vietnamese address lot, not a code — the code form
      // always carries a dash-digit group, the address form never does.
      expect(stripInternalCodes('Kho tại Lô CN-09, KCN Vân Trung'))
        .toBe('Kho tại Lô CN-09, KCN Vân Trung');
    });

    it('returns null when the text is nothing but a code', () => {
      expect(stripInternalCodes('TRP-202610-0028')).toBeNull();
      expect(stripInternalCodes('')).toBeNull();
      expect(stripInternalCodes(null)).toBeNull();
      expect(stripInternalCodes(undefined)).toBeNull();
    });
  });

  describe('containsInternalCode', () => {
    it('detects every code shape', () => {
      expect(containsInternalCode('Chuyến TRP-202610-0028 đã được điều xe')).toBe(true);
      expect(containsInternalCode('Chuyến TRP-2026-10-0028 đã được tạo')).toBe(true);
      expect(containsInternalCode('Chuyến BULK-TR-0011 đã được điều xe')).toBe(true);
      expect(containsInternalCode('Chuyến CN-MSCU1234561-1 đã được tạo')).toBe(true);
    });

    it('does not fire on business copy', () => {
      expect(containsInternalCode('Chuyến BL-2026-001 đã được điều xe')).toBe(false);
      expect(containsInternalCode('Kho tại Lô CN-09, KCN Vân Trung')).toBe(false);
      expect(containsInternalCode('Lô hàng MSKU1234565 đã giao')).toBe(false);
    });
  });

  describe('stripInternalCodeFromFileName', () => {
    it('drops the leading trip code from the seeded e-POD file name', () => {
      expect(stripInternalCodeFromFileName('TRP-202609-0001-YARD_OR_DROP_RECEIPT.pdf'))
        .toBe('YARD_OR_DROP_RECEIPT.pdf');
    });

    it('keeps a driver photo name untouched', () => {
      expect(stripInternalCodeFromFileName('IMG_7804.jpeg')).toBe('IMG_7804.jpeg');
      expect(stripInternalCodeFromFileName('pod-yard_or_drop_receipt.jpg'))
        .toBe('pod-yard_or_drop_receipt.jpg');
    });

    it('returns null when the whole name is a code', () => {
      expect(stripInternalCodeFromFileName('TRP-202609-0001')).toBeNull();
      expect(stripInternalCodeFromFileName('')).toBeNull();
      expect(stripInternalCodeFromFileName(null)).toBeNull();
    });

    it('returns null when a code survives the leading run (two codes in one name)', () => {
      expect(stripInternalCodeFromFileName('TRP-202609-0001-TRP-202609-0002.pdf')).toBeNull();
    });
  });
});
