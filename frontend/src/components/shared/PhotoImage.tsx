import { useEffect, useState, type ImgHTMLAttributes } from 'react';

type PhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /**
   * A browser-renderable URL — normally the `blob:` object URL a photo hook
   * produced. `''` / `null` / `undefined` (still loading, read denied) renders
   * nothing instead of pointing `<img>` at the page URL.
   */
  src?: string | null;
};

/**
 * Hardened `<img>` for photo surfaces (thumbnails, receipts, evidence).
 *
 * The authed-photo hooks resolve `''` while a read is pending or denied, and a
 * blob URL can still fail to decode — a raw `<img>` would then request the
 * page URL or show the browser's tiny broken-image glyph. This component
 * renders nothing for an empty `src`, and swaps itself out on a load error
 * while still forwarding `onError`, so a caller can render its own
 * placeholder (PhotosCard's "Không tải được" state).
 */
export function PhotoImage({ src, onError, ...imgProps }: PhotoImageProps) {
  const [failed, setFailed] = useState(false);

  // A new src is a new chance to load (retry flows re-run the authed fetch).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;

  return (
    <img
      {...imgProps}
      src={src}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
