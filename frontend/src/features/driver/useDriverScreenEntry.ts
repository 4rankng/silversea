import { useLayoutEffect } from 'react';

/** The app keeps its scrollport mounted while driver screens change. */
export function useDriverScreenEntry(screenKey: string | undefined) {
  useLayoutEffect(() => {
    const scrollport = document.querySelector<HTMLElement>('.app.is-driver .app-body');
    // Instant positioning avoids animating from the previous screen's footer.
    scrollport?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [screenKey]);
}
