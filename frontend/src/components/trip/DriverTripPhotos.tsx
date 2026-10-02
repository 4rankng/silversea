import { ImageOff } from 'lucide-react';
import { useAuthedPhotoUrl } from '../../lib/api/photo';

/**
 * Shared photo primitives for the driver trip surfaces (structure-guard
 * split from DriverContainerCard). A "photo reference" accepts either a
 * bare storage key (e.g. `trips/154/container-….jpg`) or an already-formed
 * `/api/photos/…` URL.
 */

function EmptyThumb({ label }: { label: string }) {
  return <div className="dcc-bento__thumb-empty"><ImageOff size={15} /><span>{label}</span></div>;
}

/** One bento thumbnail. The protected photo loads through an Authorization-
 *  header blob fetch (DRV-DET-08 — never a `?token=` URL), so a missing or
 *  denied file renders as a calm placeholder instead of a broken browser image
 *  on the driver phone. */
export function BentoThumb({ photoKey, label }: { photoKey: string | null; label: string }) {
  const src = useAuthedPhotoUrl(photoKey);

  return src
    ? <img className="dcc-bento__thumb" src={src} alt={`Ảnh ${label.toLowerCase()}`} />
    : <EmptyThumb label={label} />;
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
export function renderThumb(key: string | null, label: string) {
  return <BentoThumb photoKey={key} label={label} />;
}
