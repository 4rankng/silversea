import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';
import { useFocusTrap } from '../hooks/useFocusTrap';
// The stylesheet must ride with the component: the overlay portals to
// <body>, so it cannot inherit page-level styles, and consumers live in
// separate lazy route chunks — without this import a fresh session on a
// chunk whose siblings never loaded the css renders the overlay unstyled
// (no fixed positioning, no backdrop; controls hit-test under app chrome).
import './PhotoViewer.css';

interface PhotoViewerProps {
  urls: string[];
  initialIndex?: number;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.5;
const PAN_FRICTION = 1;

export function PhotoViewer({ urls, initialIndex = 0, onClose }: PhotoViewerProps) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, urls.length - 1)));
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const activeIndex = Math.max(0, Math.min(index, urls.length - 1));
  const currentUrl = urls[activeIndex];

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useFocusTrap(containerRef, true);

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    setIndex(prev => {
      const next = Math.min(prev, urls.length - 1) + dir;
      if (next < 0 || next >= urls.length) return prev;
      resetView();
      return next;
    });
  }, [urls.length, resetView]);

  const zoom = useCallback((delta: number) => {
    setScale(prev => Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta)));
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!['Escape', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_', '0'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': go(-1); break;
        case 'ArrowRight': go(1); break;
        case '+': case '=': zoom(ZOOM_STEP); break;
        case '-': case '_': zoom(-ZOOM_STEP); break;
        case '0': resetView(); break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, go, zoom, resetView]);

  // Register as an open overlay so the ESC "go back" shortcut yields while open
  useEffect(() => {
    registerOverlay();
    closeRef.current?.focus();
    return () => unregisterOverlay();
  }, []);

  // Scroll-to-zoom
  useEffect(() => {
    const viewer = containerRef.current;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? ZOOM_STEP * 0.5 : -ZOOM_STEP * 0.5);
    };
    viewer?.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewer?.removeEventListener('wheel', handleWheel);
  }, [zoom]);

  // Drag-to-pan (only when zoomed)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= 1 || (e.target instanceof Element && e.target.closest('button'))) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale, translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = (e.clientX - dragStart.current.x) * PAN_FRICTION;
    const dy = (e.clientY - dragStart.current.y) * PAN_FRICTION;
    setTranslate({
      x: translateStart.current.x + dx,
      y: translateStart.current.y + dy,
    });
  }, [dragging]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Double-click toggle zoom
  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      resetView();
    } else {
      setScale(2.5);
    }
  }, [scale, resetView]);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < urls.length - 1;

  return createPortal(
    <div className="pv-overlay" ref={containerRef} role="dialog" aria-modal="true" aria-label="Xem ảnh chứng từ">
      {/* Backdrop */}
      <div className="pv-backdrop" onClick={onClose} />

      {/* Top bar */}
      <div className="pv-topbar">
        <span className="pv-counter" aria-live="polite">
          {urls.length ? activeIndex + 1 : 0} / {urls.length}
        </span>
        <div className="pv-actions">
          <button type="button" className="pv-btn" aria-label="Thu nhỏ" onClick={() => zoom(-ZOOM_STEP)}
            disabled={scale <= MIN_SCALE} title="Thu nhỏ (-)">
            <ZoomOut size={18} />
          </button>
          <span className="pv-zoom-label">{Math.round(scale * 100)}%</span>
          <button type="button" className="pv-btn" aria-label="Phóng to" onClick={() => zoom(ZOOM_STEP)}
            disabled={scale >= MAX_SCALE} title="Phóng to (+)">
            <ZoomIn size={18} />
          </button>
          <button type="button" className="pv-btn" aria-label="Đặt lại kích thước" onClick={resetView} title="Đặt lại (0)">
            <RotateCcw size={18} />
          </button>
          <div className="pv-divider" />
          <button ref={closeRef} type="button" className="pv-btn pv-btn--close" aria-label="Đóng ảnh" onClick={onClose} title="Đóng (Esc)">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Image */}
      <div className="pv-stage"
        style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {currentUrl && <img
          key={`${currentUrl}-${retry}`}
          className="pv-image"
          src={currentUrl}
          alt={`Ảnh ${activeIndex + 1}`}
          draggable={false}
          onLoad={() => setLoadedUrl(currentUrl)}
          onError={() => setFailedUrl(currentUrl)}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: dragging ? 'none' : undefined,
            visibility: loadedUrl === currentUrl && failedUrl !== currentUrl ? 'visible' : 'hidden',
          }}
        />}
        {(!currentUrl || failedUrl === currentUrl || loadedUrl !== currentUrl) && (
          <div className="pv-feedback" role="status">
            <span>{!currentUrl ? 'Chưa có ảnh để hiển thị.' : failedUrl === currentUrl ? 'Không tải được ảnh.' : 'Đang tải ảnh…'}</span>
            {currentUrl && failedUrl === currentUrl && <button type="button" className="pv-btn pv-retry" onClick={() => { setFailedUrl(null); setLoadedUrl(null); setRetry((value) => value + 1); }}>Thử lại</button>}
          </div>
        )}
      </div>

      {/* Navigation arrows */}
      {canPrev && (
        <button type="button" className="pv-nav pv-nav--prev" aria-label="Ảnh trước" onClick={() => go(-1)} title="Ảnh trước (←)">
          <ChevronLeft size={28} />
        </button>
      )}
      {canNext && (
        <button type="button" className="pv-nav pv-nav--next" aria-label="Ảnh sau" onClick={() => go(1)} title="Ảnh sau (→)">
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    document.body,
  );
}
