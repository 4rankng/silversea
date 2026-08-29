import React from 'react';
import './ImagesNotesCard.css';
import { Upload, Loader2, X } from 'lucide-react';
import { CardSection } from './CardSection';
import { getAuthenticatedPhotoUrl } from '../../lib/api';
import { useTripFormContext } from '../../hooks/useTripFormContext';

interface ImagesNotesCardProps {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function ImagesNotesCard({ collapsible, defaultCollapsed }: ImagesNotesCardProps) {
  const form = useTripFormContext();
  const { notes, setNotes, photoUrls, uploading, uploadPhotos, removePhoto } = form;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadPhotos(e.target.files, undefined, 'OTHER');
      e.target.value = '';
    }
  };

  return (
    <CardSection
      number={5}
      title="Hình ảnh & ghi chú"
      subtitle="Ảnh đính kèm và lưu ý chuyến đi"
      badge="optional"
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="field">
          <label>Ghi chú chuyến đi</label>
          <textarea
            className="input"
            style={{ minHeight: 90, resize: 'vertical' }}
            rows={4}
            placeholder="Ghi chú chi tiết chuyến đi, các lưu ý đặc biệt, yêu cầu của khách hàng…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Ảnh đính kèm</label>
          {photoUrls.length > 0 && (
            <div className="photo-grid">
              {photoUrls.map((url, i) => (
                <div key={i} className="photo-thumb">
                  <img src={getAuthenticatedPhotoUrl(url)} alt={`Preview ${i + 1}`} />
                  <button
                    type="button"
                    className="photo-thumb__remove"
                    aria-label={`Xóa ảnh ${i + 1}`}
                    onClick={() => removePhoto(i)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="tc-upload-zone" style={{ cursor: uploading.OTHER ? 'wait' : 'pointer' }}>
            {uploading.OTHER ? (
              <div style={{ padding: '20px 0' }}>
                <Loader2 size={24} className="spin" style={{ color: 'var(--accent)' }} />
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-2)' }}>Đang tải lên…</div>
              </div>
            ) : (
              <>
                <div className="tc-upload-zone__ico">
                  <Upload size={22} />
                </div>
                <div className="tc-upload-zone__main">Kéo & thả ảnh vào đây</div>
                <div className="tc-upload-zone__sub">hoặc bấm để chọn từ máy</div>
                <div className="tc-upload-zone__formats">PNG, JPG, HEIC · tối đa 10 ảnh</div>
              </>
            )}
            <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} disabled={uploading.OTHER} />
          </label>
        </div>
      </div>
    </CardSection>
  );
}
