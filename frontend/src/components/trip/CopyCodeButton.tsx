import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Card 20260926_28 item 9: copy affordance for the driver's long codes
 * (Bill/Booking, container, seal, MST) — drivers shuttle these between apps
 * constantly. House pattern: a small inline icon button on the value row;
 * the icon flips to a check for ~1.6s on success. Clipboard API with a
 * legacy execCommand bridge for insecure contexts (driver phones on http).
 */
export function CopyCodeButton({ value, label }: { value: string; label: string }) {
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
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      className="driver-copy-btn"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => void copy()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
