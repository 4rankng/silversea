import React, { useState } from 'react';
import { Image as ImageIcon, ImageOff } from 'lucide-react';
import { getAuthenticatedPhotoUrl } from '../../../lib/api';
import { PhotoViewer } from '../../../components/PhotoViewer';
import '../../../components/PhotoViewer.css';

interface PhotosCardProps {
  photoUrls: string[] | null;
}

export function PhotosCard({ photoUrls }: PhotosCardProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Track which photos failed to load so we can swap in an elegant
  // placeholder instead of the browser's default broken-image glyph
  // (which is just a tiny "?" icon — looks broken on mobile).
  const [brokenSet, setBrokenSet] = useState<Set<number>>(new Set());

  if (!photoUrls || photoUrls.length === 0) return null;

  const authUrls = photoUrls.map(u => getAuthenticatedPhotoUrl(u));

  return (
    <section className="card anim d6" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2><span className="hicon"><ImageIcon size={15} /></span>Ảnh chuyến đi</h2>
      </div>
      <div className="card-body">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}>
          {authUrls.map((url, i) => {
            const isBroken = brokenSet.has(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => { if (!isBroken) setViewerIndex(i); }}
                aria-label={isBroken ? `Ảnh ${i + 1} (không tải được)` : `Mở ảnh ${i + 1}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  aspectRatio: '4/3',
                  borderRadius: 'var(--r-md, 14px)',
                  overflow: 'hidden',
                  border: '1px solid var(--line)',
                  transition: '0.15s ease',
                  padding: 0,
                  background: isBroken ? 'var(--bg-3, #EFF1F5)' : 'none',
                  cursor: isBroken ? 'default' : 'pointer',
                  width: '100%',
                  color: 'var(--ink-3)',
                  fontSize: 12,
                }}
              >
                {isBroken ? (
                  <>
                    <ImageOff size={20} aria-hidden="true" />
                    <span>Ảnh {i + 1}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Không tải được</span>
                  </>
                ) : (
                  <img
                    src={url}
                    alt={`Ảnh ${i + 1}`}
                    onError={() => setBrokenSet(prev => new Set(prev).add(i))}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    loading="lazy"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {viewerIndex !== null && (
        <PhotoViewer
          urls={authUrls}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </section>
  );
}
