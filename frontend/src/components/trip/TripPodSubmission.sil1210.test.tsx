/**
 * SIL-1210 (QA wave a8f059c0, 1440px) — in an e-POD card head the "Bắt buộc"
 * badge and the state chip ("Chưa có" / "Đã lưu") were 8px out of vertical
 * alignment: the badge was centred inside the (two-line) title block and a
 * stale override pinned it to 20px against the chip's 28px.
 *
 * The CSS that gives both badges one top edge lives in
 * `TripPodSubmission.sil1210.styles.test.ts`. This file pins the DOM half of
 * the same contract: both badges of a card live in ONE head row, so the row's
 * alignment governs both of them — no badge can drift on its own line.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import { TripPodSubmission } from './TripPodSubmission';

function draftSubmission(overrides: Partial<Parameters<typeof TripPodSubmission>[0]['currentSubmission']> = {}) {
  return {
    id: 81,
    tripId: 55,
    fulfillmentId: 90,
    submissionVersion: 1,
    status: TripPodStatus.DRAFT,
    sourceTripVersion: 3,
    version: 2,
    createdAt: '2026-08-01T01:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    submittedAt: null,
    reviewedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    acceptedAt: null,
    supersedesSubmissionId: null,
    supersedesJobId: null,
    files: [],
    ...overrides,
  };
}

function renderSubmission(submission = draftSubmission()) {
  return render(
    <TripPodSubmission
      tripVersion={3}
      currentSubmission={submission}
      history={[]}
      creatingDraft={false}
      uploading={false}
      onEnsureDraft={vi.fn().mockResolvedValue(submission)}
      onUploadFile={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

const STATE_CHIP = '.trip-pod__state-ok, .trip-pod__state-missing, .trip-pod__state-unreadable';

describe('SIL-1210 — both badges of an e-POD card head sit in one row', () => {
  it('every card head holds the "Bắt buộc" badge and the state chip together', () => {
    renderSubmission();
    const heads = [...document.querySelectorAll('.trip-pod__card-head')];
    expect(heads.length).toBeGreaterThan(0);

    for (const head of heads) {
      const badge = head.querySelector('.trip-pod__required');
      const chip = head.querySelector(STATE_CHIP);
      expect(badge, 'the card head carries the "Bắt buộc" badge').toBeTruthy();
      expect(chip, 'the card head carries the state chip').toBeTruthy();
      // One row: the badge is rendered before the chip, so the head row's
      // alignment (align-items) governs both of them.
      expect(
        badge!.compareDocumentPosition(chip!) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the badge precedes the state chip inside the same head row',
      ).toBeTruthy();
    }
  });

  it('the badge belongs to the title row — the row that carries the first line', () => {
    renderSubmission();
    const titles = [...document.querySelectorAll('.trip-pod__card-title')];
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      // The badge is a child of the TITLE row (not of the card), so it can
      // only be aligned by that row — a wrapped title may grow downward, but
      // the badge never leaves the first line's top edge.
      expect(title.querySelector('.trip-pod__required')).toBeTruthy();
      expect(title.querySelector('.trip-pod__card-title-text')).toBeTruthy();
    }
  });

  it('a card with a saved file still pairs its badge with the "Đã lưu" chip', () => {
    renderSubmission(draftSubmission({
      files: [{
        id: 1,
        fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
        originalFileName: 'phieu-bai.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        createdAt: '2026-11-26T09:14:00.000Z',
      }],
    }) as never);
    expect(screen.getByText('Đã lưu')).toBeTruthy();
    const okHead = document.querySelector('.trip-pod__state-ok')!.closest('.trip-pod__card-head')!;
    expect(okHead.querySelector('.trip-pod__required')).toBeTruthy();
  });
});
