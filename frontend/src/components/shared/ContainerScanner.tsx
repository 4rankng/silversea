import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Image as ImageIcon, Zap, CameraOff } from 'lucide-react';

/**
 * ContainerScanner — fullscreen camera + gallery overlay for container/seal photos.
 *
 * Mirrors the vantaiphucloc `ContainerScanner` UX (live preview, iOS-style
 * shutter, dedicated gallery button, optional torch) but is reimplemented on the
 * native `getUserMedia` API so it needs no external camera library and no
 * styled-components. Geolocation is intentionally omitted.
 *
 * Single-step flow: the moment the driver taps the shutter (or picks a gallery
 * image), the photo is downsized client-side and handed back via `onCapture` —
 * which kicks off OCR in the parent. There is no crop/preview step.
 */

interface ContainerScannerProps {
  /** Called with a downsized JPEG data URL once a photo is captured or picked. */
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

const MAX_CAPTURE_WIDTH = 1200;

type CameraStatus = 'loading' | 'ready' | 'error';

/** A MediaTrackConstraintSet that may carry the non-standard `torch` flag. */
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };

/**
 * Downsize an image to MAX_CAPTURE_WIDTH while preserving aspect ratio, so we
 * don't upload multi-megapixel camera frames to the OCR endpoint. Images at or
 * below the threshold pass through untouched.
 */
function downsizeImageToDataUrl(imageSrc: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.width <= MAX_CAPTURE_WIDTH) {
        resolve(imageSrc);
        return;
      }
      const outW = MAX_CAPTURE_WIDTH;
      const outH = Math.round(img.height * (outW / img.width));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d')!.drawImage(img, 0, 0, outW, outH);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

/** Convert a `data:` URL into a `File` for multipart FormData uploads. */
// eslint-disable-next-line react-refresh/only-export-components -- utility helper co-located with the scanner component
export function dataUrlToFile(dataUrl: string, filename = 'capture.jpg'): File {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export function ContainerScanner({ onCapture, onClose }: ContainerScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [status, setStatus] = useState<CameraStatus>('loading');
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // Acquire the rear camera on mount; release it on unmount.
  useEffect(() => {
    let stream: MediaStream | null = null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        // Torch is a non-standard capability (mostly Android Chrome); hide the
        // toggle entirely where it isn't supported (e.g. iOS).
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setFlashSupported(!!caps?.torch);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* autoplay may be deferred */ });
        }
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    };
    void start();

    return () => {
      document.body.style.overflow = prevOverflow;
      stream?.getTracks().forEach(t => t.stop());
      trackRef.current = null;
    };
  }, []);

  const handleFlashToggle = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const next = !flashOn;
    const advanced: TorchConstraint[] = [{ torch: next }];
    track.applyConstraints({ advanced }).then(
      () => setFlashOn(next),
      () => { /* torch not applicable — ignore */ },
    );
  }, [flashOn]);

  /** Common "I have an image, downsize it, fire onCapture" path. */
  const finishWith = useCallback(async (rawDataUrl: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const finalUrl = await downsizeImageToDataUrl(rawDataUrl);
      onCapture(finalUrl);
    } catch {
      // Downsize can fail on a tainted canvas (CORS); fall back to the raw source.
      onCapture(rawDataUrl);
    }
  }, [busy, onCapture]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    void finishWith(dataUrl);
  }, [finishWith]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { void finishWith(reader.result as string); };
    reader.onerror = () => { /* ignore — user can retry */ };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [finishWith]);

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#000', display: 'flex', flexDirection: 'column',
    }}>
      {/* Live camera preview (hidden while errored, but kept mounted for cleanup) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', display: status === 'ready' ? 'block' : 'none',
        }}
      />

      {/* Camera error / loading state — gallery still works */}
      {status !== 'ready' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, padding: 24, textAlign: 'center', color: '#fff',
        }}>
          {status === 'loading' ? (
            <span style={{ fontSize: 14, opacity: 0.8 }}>Đang mở camera…</span>
          ) : (
            <>
              <CameraOff size={32} style={{ opacity: 0.6 }} />
              <span style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5, maxWidth: 280 }}>
                Không truy cập được camera. Hãy cấp quyền hoặc dùng nút chọn ảnh từ thư viện bên dưới.
              </span>
            </>
          )}
        </div>
      )}

      {/* Top bar — close (left) + flash toggle (right, when supported) */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 16px', paddingTop: 'max(16px, env(safe-area-inset-top))',
      }}>
        <button
          onClick={onClose}
          aria-label="Đóng"
          style={roundBtn(40, 'rgba(0,0,0,0.5)')}
        >
          <X size={20} color="#fff" />
        </button>
        {flashSupported && (
          <button
            onClick={handleFlashToggle}
            aria-label={flashOn ? 'Tắt đèn flash' : 'Bật đèn flash'}
            style={roundBtn(40, flashOn ? 'var(--brand)' : 'rgba(0,0,0,0.5)')}
          >
            <Zap size={20} color="#fff" fill={flashOn ? '#fff' : 'none'} />
          </button>
        )}
      </div>

      {/* Bottom bar — gallery (left) + shutter (center) */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2,
        padding: '12px 24px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Gallery picker — the hidden input lives inside the label so tapping
              anywhere on it opens the OS photo picker. */}
          <label
            style={{
              ...roundBtn(44, 'rgba(0,0,0,0.5)'),
              position: 'absolute', left: 0, bottom: 4, cursor: 'pointer',
            }}
            aria-label="Chọn ảnh từ thư viện"
            title="Chọn ảnh từ thư viện"
          >
            <ImageIcon size={20} color="#fff" />
            <input type="file" accept="image/*" hidden onChange={handleFileChange} />
          </label>

          {/* Shutter — dead-center, iOS-style ring. Disabled while busy so a
              double-tap can't fire two captures. */}
          <button
            onClick={handleCapture}
            disabled={busy || status !== 'ready'}
            aria-label="Chụp ảnh"
            style={{
              width: 72, height: 72, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '4px solid rgba(255,255,255,0.95)',
              background: 'var(--brand)',
              opacity: busy || status !== 'ready' ? 0.6 : 1,
              cursor: busy || status !== 'ready' ? 'not-allowed' : 'pointer',
              transition: 'transform 0.1s ease, opacity 0.15s ease',
            }}
          >
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand)' }} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function roundBtn(size: number, background: string): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background,
    cursor: 'pointer',
    touchAction: 'manipulation',
  };
}
