/**
 * Installed-PWA detection that iOS WebKit actually honors.
 *
 * `@media (display-mode: standalone)` alone is not trustworthy on iOS:
 * WebKit evaluates it `false` for a home-screen web app even while it
 * launches standalone, so the CSS-only rule kept showing web chrome (the
 * login © footer) to installed users — user report 2026-10-20. iOS instead
 * exposes the legacy `navigator.standalone === true` flag, but that property
 * can read `undefined` for the first few dozen ms after launch. The check is
 * therefore HYBRID (either signal wins), retried briefly, and published as a
 * `pwa-standalone` class on `<html>` that stylesheets target — with the
 * display-mode media query kept in CSS as belt-and-braces for engines that
 * honor it (desktop Chrome/Edge, Android).
 */

type StandaloneNavigator = Navigator & { standalone?: boolean };

export function isPwaStandalone(win: Window = window): boolean {
  if ((win.navigator as StandaloneNavigator).standalone === true) return true;
  return typeof win.matchMedia === 'function'
    && win.matchMedia('(display-mode: standalone)').matches;
}

/**
 * Mirror the standalone state onto `document.documentElement` as the
 * `pwa-standalone` class and keep it current. Re-checks a few times over the
 * first second (iOS may not have populated `navigator.standalone` yet at
 * effect time) and follows `display-mode` changes, since a desktop installed
 * app can move between a browser window and a standalone launch. Returns a
 * cleanup function that removes the class, timers and listener.
 */
export function watchPwaStandalone(win: Window = window, doc: Document = document): () => void {
  const root = doc.documentElement;
  const apply = () => {
    root.classList.toggle('pwa-standalone', isPwaStandalone(win));
  };

  apply();

  // navigator.standalone may be undefined for a few dozen ms after an iOS
  // home-screen launch; these light retries close that gap at no real cost.
  const retries = [50, 250, 1_000].map((delay) => win.setTimeout(apply, delay));

  const query = typeof win.matchMedia === 'function'
    ? win.matchMedia('(display-mode: standalone)')
    : null;
  query?.addEventListener('change', apply);

  return () => {
    retries.forEach((id) => win.clearTimeout(id));
    query?.removeEventListener('change', apply);
    root.classList.remove('pwa-standalone');
  };
}
