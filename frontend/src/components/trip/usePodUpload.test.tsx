import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../../api/driverClient';
import { usePodUpload } from './usePodUpload';
const { compress } = vi.hoisted(() => ({ compress: vi.fn() }));
vi.mock('../../lib/imageCompression', () => ({ compressImageFile: compress }));
const draft = { id: 1, status: TripPodStatus.DRAFT } as DriverTaskPodSubmission;
const yard = TripPodFileType.YARD_OR_DROP_RECEIPT;
const signed = TripPodFileType.SIGNED_DELIVERY_NOTE;
const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });
function setup(blocked = false) {
  const upload = vi.fn().mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue(undefined);
  const error = vi.fn();
  const hook = renderHook(({ locked }) => usePodUpload({ currentSubmission: draft, blocked: locked,
    onEnsureDraft: vi.fn(), onUploadFile: upload, onError: error }), { initialProps: { locked: blocked } });
  return { ...hook, upload, error };
}
describe('POD retained evidence', () => {
  beforeEach(() => compress.mockReset().mockImplementation(async (file: File) => file));
  it('UI-DC-22 retries the failed prepared file without reselection or repeating compression', async () => {
    const prepared = new File(['prepared'], 'first.jpg', { type: 'image/jpeg' });
    compress.mockResolvedValue(prepared);
    const { result, upload } = setup();
    await act(() => result.current.uploadPodFile(yard, first, null));
    expect(result.current.pendingFiles[yard]?.file).toBe(prepared);
    expect(upload).toHaveBeenCalledTimes(1);
    await act(() => result.current.retryUpload(yard));
    expect(upload).toHaveBeenLastCalledWith(draft, yard, prepared);
    expect(compress).toHaveBeenCalledTimes(1);
    expect(result.current.pendingFiles[yard]).toBeUndefined();
  });
  it('UI-DC-22 preserves another category, supports discard and never replays on online', async () => {
    const { result, upload } = setup();
    upload.mockRejectedValue(new Error('Mất kết nối'));
    await act(() => result.current.uploadPodFile(yard, first, null));
    await act(() => result.current.uploadPodFile(signed, second, null));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(upload).toHaveBeenCalledTimes(2);
    act(() => result.current.discardUpload(yard));
    expect(result.current.pendingFiles[yard]).toBeUndefined();
    expect(result.current.pendingFiles[signed]?.file).toBe(second);
  });
  it('UI-DC-22 retains failed evidence while a later lock blocks retry', async () => {
    const { result, upload, rerender } = setup();
    await act(() => result.current.uploadPodFile(yard, first, null));
    rerender({ locked: true });
    await act(() => result.current.retryUpload(yard));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.current.pendingFiles[yard]?.file).toBe(first);
  });
  it('UI-DC-23 does not invent capture time for a gallery file', async () => {
    const { result } = setup();
    await act(() => result.current.uploadPodFile(yard, first, null));
    expect(compress).toHaveBeenCalledWith(first, { timestamp: undefined });
  });
  it('UI-DC-23 preserves known capture instant through preparation and retry', async () => {
    const capturedAt = new Date('2026-09-16T02:03:04Z');
    const { result } = setup();
    await act(() => result.current.uploadPodFile(yard, first, null, capturedAt));
    await act(() => result.current.retryUpload(yard));
    expect(compress).toHaveBeenCalledExactlyOnceWith(first, { timestamp: capturedAt });
  });
});
