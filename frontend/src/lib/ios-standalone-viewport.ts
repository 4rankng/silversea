/**
 * JS fallback for the iOS standalone bottom-gap (consult Gemini+DeepSeek,
 * 23/10/2026).
 *
 * A home-screen WKWebView can report a `visualViewport` shorter than the
 * physical screen (WebKit bug) and `100dvh` can resolve short of the true
 * bottom edge, so CSS viewport units alone cannot size the shell on the one
 * platform that needs it. When the app runs standalone AND the visual
 * viewport actually diverges from `window.innerHeight` by more than a few
 * px, the measured height is published as `--app-height` on <html>; the
 * standalone shell rules (components/layout/app-shell.css) consume it and
 * fall back through the 100vh → 100dvh → 100lvh chain while the variable is
 * unset.
 *
 * Guards (consult DeepSeek):
 * - a ≤4px divergence means the CSS units are trustworthy — the variable
 *   stays unset so the lvh chain owns the shell;
 * - a shrink far past the threshold is the on-screen KEYBOARD, not the bug —
 *   the shell owns scrolling, so the last good value is kept and the
 *   keyboard state never drives it (blur/focus re-measure self-corrects on
 *   dismiss, covering WebKit's stuck-viewport values).
 *
 * Re-measures on visualViewport resize, `pageshow` (bfcache/resume — the
 * stuck-viewport case) and window `focus` (forced re-measure after blur),
 * plus brief retries after install because `navigator.standalone` populates
 * late on iOS (same ladder as lib/pwa-standalone.ts).
 */

import { isPwaStandalone } from './pwa-standalone';

/** Divergence below which CSS viewport units are trusted (--app-height unset). */
const DIVERGENCE_THRESHOLD_PX = 4;
/** Shrinks beyond this are the on-screen keyboard, not the WebKit viewport bug. */
const KEYBOARD_SHRINK_PX = 120;

export function installStandaloneViewportHeight(win: Window = window): () => void {
  const style = win.document.documentElement.style;

  const clear = () => {
    if (style.getPropertyValue('--app-height')) style.removeProperty('--app-height');
  };

  const update = () => {
    const vv = win.visualViewport;
    if (!vv || !isPwaStandalone(win)) {
      clear();
      return;
    }
    const shrink = win.innerHeight - vv.height;
    // Keyboard-open: never let the shell chase the keyboard.
    if (shrink > KEYBOARD_SHRINK_PX) return;
    // Units agree (or the visual viewport is the taller one): CSS owns the shell.
    if (Math.abs(shrink) <= DIVERGENCE_THRESHOLD_PX) {
      clear();
      return;
    }
    style.setProperty('--app-height', `${Math.round(vv.height)}px`);
  };

  update();
  // navigator.standalone can read undefined for the first few dozen ms of an
  // iOS home-screen launch — same retry ladder as watchPwaStandalone.
  const retries = [50, 250, 1_000].map((delay) => win.setTimeout(update, delay));

  win.visualViewport?.addEventListener('resize', update);
  win.addEventListener('pageshow', update);
  win.addEventListener('focus', update);

  return () => {
    retries.forEach((id) => win.clearTimeout(id));
    win.visualViewport?.removeEventListener('resize', update);
    win.removeEventListener('pageshow', update);
    win.removeEventListener('focus', update);
    clear();
  };
}
