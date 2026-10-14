import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Card 20260926_28 item 9: copy affordance for the driver's long codes
 * (Bill/Booking, container, seal, MST) — drivers shuttle these between apps
 * constantly. House pattern: a small inline icon button on the value row;
 * the icon flips to a check for ~1.6s on success. Clipboard API with a
 * legacy execCommand bridge for insecure contexts (driver phones on http).
 * FB-009 (2026-10-14) reuses the same button for copy-time affordances
 * (giờ hẹn): `onCopied` lets the mounting surface raise its "Đã copy" toast,
 * `className` adapts the geometry to the host surface.
 */
export function CopyCodeButton({ value, label, className, onCopied }: { value: string; label: string; className?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Insecure-context fallback: the legacy bridge still works on http.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* no clipboard channel */ }
      ta.remove();
    }
    setCopied(true);
    onCopied?.();
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      className={className ? `driver-copy-btn ${className}` : 'driver-copy-btn'}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => void copy()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
