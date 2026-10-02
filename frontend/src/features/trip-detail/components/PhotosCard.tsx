import { PhotoImage } from '../../../components/shared/PhotoImage';
import React, { useState } from 'react';
import { Image as ImageIcon, ImageOff } from 'lucide-react';
import { useAuthedPhotoUrls } from '../../../lib/api/photo';
import { PhotoViewer } from '../../../components/PhotoViewer';
import '../../../components/PhotoViewer.css';

interface PhotosCardProps {
  photoUrls: string[] | null;
}

export function PhotosCard({ photoUrls }: PhotosCardProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Failed reads and decode errors use the same unavailable placeholder.
  // URL keys keep a replaced photo from inheriting an old index's error.
  const [brokenSet, setBrokenSet] = useState<Set<string>>(new Set());
  // DRV-DET-08: trip photos load with the Authorization header (blob), never a
  // ?token= query string. Called before the empty-state early return so the
  // hook order stays stable.
  const authUrls = useAuthedPhotoUrls(photoUrls ?? []);

  if (!photoUrls || photoUrls.length === 0) return null;

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
            const isBroken = !url || brokenSet.has(url);
            return (
              <button
                key={i}
                type="button"
                disabled={isBroken}
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
                  fontSize: 'var(--text-caption-size)',
                }}
              >
                {isBroken ? (
                  <>
                    <ImageOff size={20} aria-hidden="true" />
                    <span>Ảnh {i + 1}</span>
                    <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-4)' }}>Không tải được</span>
                  </>
                ) : (
                  <PhotoImage
                    src={url}
                    alt={`Ảnh ${i + 1}`}
                    onError={() => setBrokenSet(prev => new Set(prev).add(url))}
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
