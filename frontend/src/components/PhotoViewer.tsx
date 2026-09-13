import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';
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
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    setIndex(prev => {
      const next = prev + dir;
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
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': go(-1); break;
        case 'ArrowRight': go(1); break;
        case '+': case '=': zoom(ZOOM_STEP); break;
        case '-': case '_': zoom(-ZOOM_STEP); break;
        case '0': resetView(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, go, zoom, resetView]);

  // Register as an open overlay so the ESC "go back" shortcut yields while open
  useEffect(() => {
    registerOverlay();
    return () => unregisterOverlay();
  }, []);

  // Scroll-to-zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP * 0.5 : -ZOOM_STEP * 0.5;
    zoom(delta);
  }, [zoom]);

  // Drag-to-pan (only when zoomed)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= 1) return;
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

  const canPrev = index > 0;
  const canNext = index < urls.length - 1;

  return createPortal(
    <div className="pv-overlay" ref={containerRef} onWheel={handleWheel}>
      {/* Backdrop */}
      <div className="pv-backdrop" onClick={onClose} />

      {/* Top bar */}
      <div className="pv-topbar">
        <span className="pv-counter">
          {index + 1} / {urls.length}
        </span>
        <div className="pv-actions">
          <button className="pv-btn" onClick={() => zoom(-ZOOM_STEP)}
            disabled={scale <= MIN_SCALE} title="Thu nhỏ (-)">
            <ZoomOut size={18} />
          </button>
          <span className="pv-zoom-label">{Math.round(scale * 100)}%</span>
          <button className="pv-btn" onClick={() => zoom(ZOOM_STEP)}
            disabled={scale >= MAX_SCALE} title="Phóng to (+)">
            <ZoomIn size={18} />
          </button>
          <button className="pv-btn" onClick={resetView} title="Đặt lại (0)">
            <RotateCcw size={18} />
          </button>
          <div className="pv-divider" />
          <button className="pv-btn pv-btn--close" onClick={onClose} title="Đóng (Esc)">
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
        onDoubleClick={handleDoubleClick}
      >
        <img
          className="pv-image"
          src={urls[index]}
          alt={`Ảnh ${index + 1}`}
          draggable={false}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: dragging ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>

      {/* Navigation arrows */}
      {canPrev && (
        <button className="pv-nav pv-nav--prev" onClick={() => go(-1)} title="Ảnh trước (←)">
          <ChevronLeft size={28} />
        </button>
      )}
      {canNext && (
        <button className="pv-nav pv-nav--next" onClick={() => go(1)} title="Ảnh sau (→)">
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    document.body,
  );
}
