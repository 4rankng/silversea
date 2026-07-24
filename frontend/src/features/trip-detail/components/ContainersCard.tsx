import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Loader2, Camera, ImageOff } from 'lucide-react';
import { api } from '../../../lib/api';
import { photoSrc } from '../../../lib/api/photo';
import { qk } from '../../../api/keys';
import { PhotoViewer } from '../../../components/PhotoViewer';
import '../../../components/PhotoViewer.css';

/** Shape returned by GET /api/trips/:id/containers (listTripContainers). */
interface ServerContainer {
  id: number;
  containerNumber: string | null;
  sealNumber: string | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
  cargoWeightKg: string | null;
  notes: string | null;
}

interface ContainersResponse {
  items: ServerContainer[];
  /** Trip-level latest cont/seal photo storage keys (trip_photos). Back-compat. */
  contPhotoKey?: string | null;
  sealPhotoKey?: string | null;
  /** Full list of cont/seal photo keys for this trip, newest first.
   *  Phase 1 addition — `contPhotoKeys[0] === contPhotoKey`. */
  contPhotoKeys?: string[];
  sealPhotoKeys?: string[];
}

interface Props {
  tripId: number;
}

/**
 * Read-only "Container & Seal" card for the trip detail page. Mirrors the
 * editor in `ContainerInstancesCard` but without inputs — renders the
 * per-container numbers, seal, type, weight, plus the trip-level container
 * and seal photos as galleries. The editor lives on TripEditPage; this is
 * the office-staff / manager view.
 *
 * Phase 1: surfaces ALL stored photos per type (not just the latest).
 * Phase 2+ will link photos per container row via trip_container_id.
 */
export function ContainersCard({ tripId }: Props) {
  const { data, isLoading } = useQuery<ContainersResponse>({
    queryKey: qk.tripForm.tripContainers(tripId),
    queryFn: () => api.get(`/trips/${tripId}/containers`),
    enabled: !!tripId,
  });

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const items = data?.items ?? [];
  // Prefer the new plural arrays; fall back to singular for older clients.
  const contKeys = data?.contPhotoKeys ?? (data?.contPhotoKey ? [data.contPhotoKey] : []);
  const sealKeys = data?.sealPhotoKeys ?? (data?.sealPhotoKey ? [data.sealPhotoKey] : []);
  const contUrls = contKeys.map(photoSrc);
  const sealUrls = sealKeys.map(photoSrc);

  const openGallery = (kind: 'cont' | 'seal', idx: number) => {
    const offset = kind === 'cont' ? 0 : contUrls.length;
    setViewerIndex(offset + idx);
  };

  // Combined gallery for the PhotoViewer — cont photos first, then seal photos.
  const gallery = [...contUrls, ...sealUrls];

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <span className="hicon"><Package size={15} /></span>
          Container &amp; Seal
          {items.length > 0 && (
            <span className="sub" style={{ margin: 0, marginLeft: 4, fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>
              • {items.length} cont
            </span>
          )}
        </h2>
      </div>
      <div className="card-body">
        {isLoading ? (
          <div style={{ padding: 16, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Loader2 size={14} className="spin" /> Đang tải…
          </div>
        ) : items.length === 0 && gallery.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--ink-4)', fontSize: 13 }}>Chưa có container.</div>
        ) : (
          <>
            {/* Trip-level photo galleries. Photos are stored at trip level in
                trip_photos, so they appear here even when no container row
                has been created yet (e.g. captured via OCR but row not saved).
                Phase 2+ will move these into per-container galleries when
                trip_container_id is set on the photo row. */}
            {(contUrls.length > 0 || sealUrls.length > 0) && (
              <div className="cs-galleries">
                <PhotoGallery
                  label={`Ảnh số cont${contUrls.length > 1 ? ` (${contUrls.length})` : ''}`}
                  kind="cont"
                  urls={contUrls}
                  broken={broken}
                  onOpen={i => openGallery('cont', i)}
                  onBroken={url => setBroken(prev => new Set(prev).add(url))}
                />
                <PhotoGallery
                  label={`Ảnh số seal${sealUrls.length > 1 ? ` (${sealUrls.length})` : ''}`}
                  kind="seal"
                  urls={sealUrls}
                  broken={broken}
                  onOpen={i => openGallery('seal', i)}
                  onBroken={url => setBroken(prev => new Set(prev).add(url))}
                />
              </div>
            )}

            {items.length > 0 && (
              <div className="containers-list">
                {items.map((c, idx) => (
                  <div key={c.id} className="container-row">
                    <div className="container-no">{idx + 1}</div>
                    <div className="container-fields">
                      <div className="cf">
                        <span className="cf-label">Số container</span>
                        <span className="cf-value mono">{c.containerNumber || '—'}</span>
                      </div>
                      <div className="cf">
                        <span className="cf-label">Số seal</span>
                        <span className="cf-value mono">{c.sealNumber || '—'}</span>
                      </div>
                      <div className="cf">
                        <span className="cf-label">Loại cont</span>
                        <span className="cf-value">
                          {c.containerTypeName
                            ? `${c.containerTypeName}${c.containerTypeCode ? ` (${c.containerTypeCode})` : ''}`
                            : '—'}
                        </span>
                      </div>
                      <div className="cf">
                        <span className="cf-label">Trọng lượng</span>
                        <span className="cf-value mono">
                          {c.cargoWeightKg ? `${Number(c.cargoWeightKg).toLocaleString('vi-VN')} kg` : '—'}
                        </span>
                      </div>
                      {c.notes && (
                        <div className="cf cf--full">
                          <span className="cf-label">Ghi chú</span>
                          <span className="cf-value">{c.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {viewerIndex !== null && (
        <PhotoViewer
          urls={gallery}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </section>
  );
}

/* ── Gallery sub-component (one per photo type) ─────────────────────────── */

interface PhotoGalleryProps {
  label: string;
  kind: 'cont' | 'seal';
  urls: string[];
  broken: Set<string>;
  onOpen: (idx: number) => void;
  onBroken: (url: string) => void;
}

function PhotoGallery({ label, kind, urls, broken, onOpen, onBroken }: PhotoGalleryProps) {
  if (urls.length === 0) {
    return (
      <div className={`cs-gallery cs-gallery--${kind}`}>
        <div className="cs-gallery__label">{label}</div>
        <div className="cs-thumbs">
          <div className="cs-thumb cs-thumb--empty">
            <Camera size={16} />
            <span>Chưa có</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`cs-gallery cs-gallery--${kind}`}>
      <div className="cs-gallery__label">{label}</div>
      <div className="cs-thumbs">
        {urls.map((url, i) => {
          const isBroken = broken.has(url);
          return (
            <button
              key={`${url}-${i}`}
              type="button"
              className="cs-thumb"
              onClick={() => !isBroken && onOpen(i)}
              aria-label={isBroken ? `${label} Ảnh ${i + 1} (lỗi)` : `Mở ${label} Ảnh ${i + 1}`}
              disabled={isBroken}
            >
              {isBroken ? (
                <span className="cs-thumb__broken">
                  <ImageOff size={16} />
                  <span>Lỗi tải</span>
                </span>
              ) : (
                <img
                  src={url}
                  alt={`${label} ${i + 1}`}
                  onError={() => onBroken(url)}
                  loading="lazy"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
