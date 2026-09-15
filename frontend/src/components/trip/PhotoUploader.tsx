import React, { useRef } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { useTripFormContext } from "../../hooks/useTripFormContext";
import { getAuthenticatedPhotoUrl } from "../../lib/api";

/**
 * Trip-level "other" photo uploader for the edit page's "Ảnh & Ghi chú" card.
 *
 * Container & seal photos are managed per-container in `ContainerInstancesCard`
 * (and surfaced on the detail page by the "Container & Seal" card), so this
 * uploader only handles general (`type='OTHER'`) photos. The backend's
 * `GET /trips/:id` already narrows `photoUrls` to `type='OTHER'`, so every URL
 * here is a general photo — no client-side type classification needed.
 */
interface PhotoUploaderProps {
  tripId?: number;
}

export function PhotoUploader({ tripId }: PhotoUploaderProps) {
  const form = useTripFormContext();
  const { photoUrls, uploadPhotos, removePhoto, uploading } = form;

  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await uploadPhotos(e.target.files, tripId, "OTHER");
      e.target.value = "";
    }
  };

  return (
    <div style={{ marginBottom: 0 }}>
      <div style={{
        border: "1px solid var(--border-2)",
        borderRadius: "var(--app-radius-md)",
        padding: 14,
        background: "var(--bg-1)",
      }}>
        <div style={{ fontSize: 'var(--text-body-size)', fontWeight: 700, color: "var(--fg-1)", marginBottom: 8 }}>
          Ảnh đính kèm
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          {photoUrls.map((url, i) => (
            <div key={url} style={{ width: 64, height: 64, borderRadius: "var(--app-radius-sm)", border: "1px solid var(--border-1)", position: "relative", overflow: "hidden" }}>
              <img src={getAuthenticatedPhotoUrl(url)} alt={`Ảnh ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button type="button" onClick={() => removePhoto(i)} style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, background: "rgba(0,0,0,0.6)", color: "white", border: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <X size={8} />
              </button>
            </div>
          ))}
        </div>

        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 44, border: "1px dashed var(--fg-3)", borderRadius: "var(--app-radius-sm)", background: "var(--bg-2)", cursor: uploading.OTHER ? "wait" : "pointer", color: "var(--fg-2)", fontSize: 'var(--text-label-size)' }}>
          {uploading.OTHER ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Upload size={14} /> Tải ảnh đính kèm lên</span>
          )}
          <input type="file" ref={inputRef} multiple style={{ display: "none" }} onChange={handleFileChange} disabled={uploading.OTHER} accept="image/*" />
        </label>
      </div>
    </div>
  );
}
