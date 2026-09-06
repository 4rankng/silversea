import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useOpsExpensePhotos, useDeleteOpsExpensePhoto } from '../../hooks/useOpsQueries';
import { getAuthenticatedPhotoUrl } from '../../lib/api';
import { PhotoViewer } from '../../components/PhotoViewer';
import '../../components/PhotoViewer.css';

interface Props {
  expenseId: number;
  /** Author may remove photos while the entry is still editable. */
  canDelete?: boolean;
  onClose: () => void;
}

/** Receipt viewer shared by the Ops wallet and the accountant review tab. */
export function OpsExpensePhotosModal({ expenseId, canDelete = false, onClose }: Props) {
  const { data, isLoading } = useOpsExpensePhotos(expenseId);
  const deletePhoto = useDeleteOpsExpensePhoto();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const photos = data?.items ?? [];
  const urls = photos.map((photo) => getAuthenticatedPhotoUrl(photo.url));

  return (
    <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Ảnh biên lai">
      <div className="ops-modal">
        <header className="ops-modal__head">
          <h2>Ảnh biên lai ({photos.length})</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          {isLoading && <div className="ops-photo-grid__loading"><Loader2 className="spin" size={18} /></div>}
          {!isLoading && photos.length === 0 && (
            <p className="ops-photo-grid__empty">Khoản chi này chưa có ảnh biên lai nào.</p>
          )}
          <div className="ops-photo-grid">
            {photos.map((photo, index) => (
              <figure key={photo.id} className="ops-photo-grid__item">
                <button type="button" onClick={() => setViewerIndex(index)} aria-label={`Xem ảnh ${index + 1}`}>
                  <img src={urls[index]} alt={`Biên lai ${index + 1}`} />
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="ops-photo-grid__remove"
                    aria-label={`Xóa ảnh ${index + 1}`}
                    disabled={deletePhoto.isPending}
                    onClick={() => void deletePhoto.mutateAsync(photo.id).catch(() => undefined)}
                  >
                    <X size={12} />
                  </button>
                )}
              </figure>
            ))}
          </div>
        </div>
      </div>
      {viewerIndex != null && (
        <PhotoViewer
          urls={urls}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
