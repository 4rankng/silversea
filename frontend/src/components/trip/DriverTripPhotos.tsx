import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { getAuthenticatedPhotoUrl } from '../../lib/api';

/**
 * Shared photo primitives for the driver trip surfaces (structure-guard
 * split from DriverContainerCard). A "photo reference" accepts either a
 * bare storage key (e.g. `trips/154/container-….jpg`) or an already-formed
 * `/api/photos/…` URL.
 */

/** Normalize a stored photo reference to an authenticated `/api/photos/` URL.
 *  Bare keys are encoded so the slashes survive as a single path segment that
 *  the wildcard photo route decodes. */
export function photoSrc(value: string | null | undefined): string {
  if (!value) return '';
  const url = value.startsWith('/api/photos/') ? value : `/api/photos/${encodeURIComponent(value)}`;
  return getAuthenticatedPhotoUrl(url);
}

function EmptyThumb({ label }: { label: string }) {
  return <div className="dcc-bento__thumb-empty"><ImageOff size={15} /><span>{label}</span></div>;
}

/** One bento thumbnail: preflight the protected photo URL so missing files render
 *  as a calm placeholder instead of a broken browser image on the driver phone. */
export function BentoThumb({ photoKey, label }: { photoKey: string | null; label: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!photoKey) {
      setSrc('');
      return;
    }

    const nextSrc = photoSrc(photoKey);
    const controller = new AbortController();

    fetch(nextSrc, { method: 'HEAD', signal: controller.signal })
      .then(response => {
        setSrc(response.ok ? nextSrc : '');
      })
      .catch(() => {
        if (!controller.signal.aborted) setSrc('');
      });

    return () => controller.abort();
  }, [photoKey]);

  return src
    ? <img className="dcc-bento__thumb" src={src} alt={`Ảnh ${label.toLowerCase()}`} onError={() => setSrc('')} />
    : <EmptyThumb label={label} />;
}

/** One bento thumbnail: the photo if `key` is present and valid, else a labelled
 *  empty placeholder. Cont/Seal/biên bản thumbs are identical modulo key + label. */
export function renderThumb(key: string | null, label: string) {
  return <BentoThumb photoKey={key} label={label} />;
}
