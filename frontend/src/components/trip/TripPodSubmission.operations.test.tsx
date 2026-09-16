import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../../api/driverClient';
import { TripPodSubmission } from './TripPodSubmission';

const { compressMock } = vi.hoisted(() => ({ compressMock: vi.fn() }));
vi.mock('../../lib/imageCompression', () => ({ compressImageFile: compressMock }));

const draft: DriverTaskPodSubmission = {
  id: 81, tripId: 55, fulfillmentId: 90, submissionVersion: 1,
  status: TripPodStatus.DRAFT, sourceTripVersion: 3, version: 2,
  createdAt: '2026-09-16T01:00:00.000Z', updatedAt: '2026-09-16T01:00:00.000Z',
  submittedAt: null, reviewedAt: null, rejectedAt: null, rejectionReason: null,
  acceptedAt: null, supersedesSubmissionId: null, files: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('TripPodSubmission operation boundaries', () => {
  beforeEach(() => compressMock.mockReset().mockImplementation(async (file: File) => file));

  it('DRV-FOLLOWUP-002 blocks a second file through preparation and upload, then permits retry', async () => {
    const prepared = deferred<File>();
    compressMock.mockReturnValueOnce(prepared.promise);
    const onUploadFile = vi.fn().mockRejectedValueOnce(new Error('Mạng bị gián đoạn')).mockResolvedValue(undefined);
    const onBusyChange = vi.fn();
    const { container } = render(<TripPodSubmission
      tripVersion={3} currentSubmission={draft} history={[]} creatingDraft={false} uploading={false}
      onEnsureDraft={vi.fn()} onUploadFile={onUploadFile} onBusyChange={onBusyChange}
    />);
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const first = new File(['a'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    fireEvent.change(inputs[0], { target: { files: [first] } });
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    screen.getAllByRole('button', { name: /Chụp|Tải tệp/ }).forEach((button) => expect(button).toBeDisabled());
    fireEvent.change(inputs[1], { target: { files: [second] } });
    expect(compressMock).toHaveBeenCalledTimes(1);
    await act(async () => prepared.resolve(first));
    await screen.findByText('Mạng bị gián đoạn');
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    screen.getAllByRole('button', { name: /Chụp|Tải tệp/ }).forEach((button) => expect(button).toBeEnabled());
    fireEvent.change(inputs[0], { target: { files: [first] } });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(2));
    expect(onUploadFile).toHaveBeenLastCalledWith(draft, TripPodFileType.YARD_OR_DROP_RECEIPT, first);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('DRV-FOLLOWUP-001 explains a read-only state without offering dead-end capture actions', () => {
    render(<TripPodSubmission
      tripVersion={3} currentSubmission={draft} history={[]} creatingDraft={false} uploading={false}
      onEnsureDraft={vi.fn()} onUploadFile={vi.fn()} readOnlyReason="Lô hàng đã khóa kế toán."
    />);
    expect(screen.getByRole('status')).toHaveTextContent('Lô hàng đã khóa kế toán.');
    expect(screen.queryByRole('button', { name: 'Chụp' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tải tệp' })).toBeNull();
  });
});
