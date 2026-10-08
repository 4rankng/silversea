// Card 071026212510 — QA reported the e-POD file-count badge as "1tệp". The DOM
// measurement in-card proved the shipped string already carried the space
// (textContent " 1 tệp", codepoints 31 20 74 1ec7 70): the report is not
// reproducible. Lead ruling (user 2026-10-08): the count label must be immune
// to flex/anonymous-item space trimming BY CONSTRUCTION — the number+unit pair
// renders as ONE text node built from a template literal, so the U+0020 space
// between number and unit is structural, not incidental JSX whitespace that a
// flex layout could trim. Icon separation stays CSS gap.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import { TripPodSubmission } from './TripPodSubmission';

function podFile(id: number) {
  return {
    id,
    fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
    label: 'Phiếu bãi / phiếu hạ',
    originalFileName: `photo-${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 2048,
    createdAt: '2026-08-01T01:05:00.000Z',
    downloadUrl: `/api/driver/me/fulfillments/90/pod-files/${id}`,
  };
}

function submission(files: unknown[]) {
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
    files,
  };
}

function renderPod(files: unknown[]) {
  return render(
    <TripPodSubmission
      tripVersion={3}
      currentSubmission={submission(files) as never}
      history={[]}
      creatingDraft={false}
      uploading={false}
      onEnsureDraft={vi.fn()}
      onUploadFile={vi.fn()}
      onRemoveFile={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

function countLabel(container: HTMLElement, expectedCount: number) {
  const labels = container.querySelectorAll('.trip-pod__state-count');
  expect(labels).toHaveLength(1);
  const label = labels[0];
  // The whole "N tệp" label is exactly one text node — never JSX-split
  // children whose whitespace a flex container could trim.
  expect(label.childNodes).toHaveLength(1);
  expect(label.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  expect(label.textContent).toBe(`${expectedCount} tệp`);
  return label;
}

describe('TripPodSubmission — file-count badge is one text node (card 071026212510)', () => {
  it('renders "N tệp" as a single text node with a U+0020 space between number and unit', () => {
    const { container } = renderPod([podFile(31)]);
    const label = countLabel(container, 1);
    expect(Array.from(label.textContent ?? '', (ch) => ch.charCodeAt(0))).toEqual([
      0x31, // '1'
      0x20, // U+0020 normal space — pinned between number and unit
      0x74, // 't'
      0x1ec7, // 'ệ'
      0x70, // 'p'
    ]);
    expect(label.textContent).not.toMatch(/\d+tệp/);
  });

  it('keeps the single-text-node label for a larger count', () => {
    const { container } = renderPod([podFile(31), podFile(32)]);
    countLabel(container, 2);
  });
});
