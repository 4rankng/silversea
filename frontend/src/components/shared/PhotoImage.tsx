import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import './PhotoImage.css';

/** The authenticated loader owns the URL. A missing or failed photo stays
 * visible as an unavailable slot rather than an empty image or blank link. */
export function PhotoImage({ src, alt, className, style, onError, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => { setFailedSource(null); }, [src]);
  if (!src?.trim() || failedSource === src) {
    return <span role="img" aria-label={`${alt || 'Ảnh'} (không tải được)`}
      className={`photo-image__unavailable${className ? ` ${className}` : ''}`} style={style}>Không tải được</span>;
  }
  return <img src={src} alt={alt} className={className} style={style} {...props}
    onError={event => { setFailedSource(src); onError?.(event); }} />;
}
