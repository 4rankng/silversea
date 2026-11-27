import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageOff, Loader2 } from 'lucide-react';
import { useAuthedPhotoUrl, useAuthedPhotoUrls } from '../../lib/api/photo';

/**
 * Shared photo primitives for the driver trip surfaces (structure-guard
 * split from DriverContainerCard). A "photo reference" accepts either a
 * bare storage key (e.g. `trips/154/container-….jpg`) or an already-formed
 * `/api/photos/…` URL.
 */

/** The face of a bento thumbnail slot. The three states are deliberately
 *  distinct — they mean different things to the driver:
 *
 *  - `empty`   — no photo on file: the camera is the upload affordance.
 *                SIL-1208: a crossed-out picture on a slot that never had a
 *                photo reads as "broken image", not "add a photo".
 *  - `loading` — the photo is on its way (read in flight, or being uploaded):
 *                the spinner, never an error.
 *  - `error`   — a photo IS on file but could not be read or decoded: the
 *                crossed-out picture keeps its own meaning (SIL-1130) and
 *                never shares the camera glyph of an empty slot. */
function SlotThumb({ label, state }: { label: string; state: 'empty' | 'loading' | 'error' }) {
  if (state === 'error') {
    return (
      <div className="dcc-bento__thumb-empty dcc-bento__thumb-empty--error">
        <ImageOff size={15} aria-hidden="true" />
        <span className="dcc-bento__thumb-empty-label">{label}</span>
        <span className="dcc-bento__thumb-empty-status">Lỗi tải</span>
      </div>
    );
  }
  return (
    <div className="dcc-bento__thumb-empty">
      {state === 'loading' ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
      <span className="dcc-bento__thumb-empty-label">{state === 'loading' ? 'Đang tải…' : label}</span>
    </div>
  );
}

/** One bento thumbnail. The protected photo loads through an Authorization-
 *  header blob fetch (DRV-DET-08 — never a `?token=` URL), so a missing or
 *  denied file renders as a calm placeholder instead of a broken browser image
 *  on the driver phone. */
export function BentoThumb({ photoKey, label, uploading }: { photoKey: string | null; label: string; uploading?: boolean }) {
  // The blob read resolves to '' for a denied, a pending AND an absent
  // photo, so the URL alone cannot tell the three apart. The hook's array
  // length can: a settled read keeps its slot in the array (even when the
  // value is ''), a pending one has none yet.
  const urls = useAuthedPhotoUrls([photoKey]);
  const settled = urls.length > 0;
  const src = urls[0] ?? '';
  // A read that succeeds but hands back bytes the browser cannot decode
  // (truncated or corrupt stored file) would otherwise paint the raw
  // broken-image glyph. The tile falls back to the error affordance, so
  // "Ảnh 2/3" never coexists with a broken tile.
  const [undecodable, setUndecodable] = useState(false);
  // One stable identity shared by the native listener, the decode() probe and
  // React's onError — all three signals mean the same thing: bytes undecodable.
  const markBroken = useCallback(() => setUndecodable(true), []);
  useEffect(() => { setUndecodable(false); }, [src]);

  // Belt 1 — native listener on the mounted element. React's own `onError`
  // enters through its event system, which silently drops a dispatch that
  // lands inside a commit's disabled-events window (rare, but observed under
  // scheduler contention: the raw DOM listener fires while React's never
  // runs, and the broken image would stay mounted forever). The native
  // listener bypasses that gate entirely, so the fallback cannot be missed.
  // Belt 2 — `decode()` (real browsers only; jsdom has none) rejects even
  // when the error event fired before any listener could attach, e.g. an
  // already-failed cached blob. Belt 3 is React's `onError` below.
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    let cancelled = false;
    el.addEventListener('error', markBroken);
    if (typeof el.decode === 'function') {
      el.decode().catch(() => { if (!cancelled) markBroken(); });
    }
    return () => {
      cancelled = true;
      el.removeEventListener('error', markBroken);
    };
  }, [src, markBroken]);

  if (src && !undecodable) {
    return (
      <img
        ref={imgRef}
        className="dcc-bento__thumb"
        src={src}
        alt={`Ảnh ${label.toLowerCase()}`}
        onError={markBroken}
      />
    );
  }
  // Never had a photo — the camera is the upload affordance (SIL-1208).
  if (!photoKey) {
    return <SlotThumb label={label} state={uploading ? 'loading' : 'empty'} />;
  }
  // A photo is on file and still being read — the spinner, never an error.
  if (!settled) {
    return <SlotThumb label={label} state="loading" />;
  }
  // A photo is on file but the read failed or the bytes cannot be decoded —
  // the error affordance (SIL-1130), kept apart from the empty slot.
  return <SlotThumb label={label} state="error" />;
}

/** An authenticated `<img>` for a protected photo reference: same blob-fetch
 *  contract as `BentoThumb` without the bento frame, and nothing at all while
 *  the read is pending or denied. */
export function AuthedPhotoImg({ photoKey, className, alt }: { photoKey: string | null; className?: string; alt: string }) {
  const src = useAuthedPhotoUrl(photoKey);

  return src ? <img className={className} src={src} alt={alt} /> : null;
}

/** One bento thumbnail: the photo if `key` is present and valid, else a labelled
 *  empty placeholder. Cont/Seal/biên bản thumbs are identical modulo key + label. */
export function renderThumb(key: string | null, label: string, uploading?: boolean) {
  return <BentoThumb photoKey={key} label={label} uploading={uploading} />;
}
