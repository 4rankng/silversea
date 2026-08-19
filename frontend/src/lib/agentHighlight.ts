// agentHighlight — imperative scroll-to + Driver.js spotlight used by the agent
// directive bridge (focus / scrollTo / navigate.highlight) and the `?focus=`
// deep-link flow. Extracted so both call sites share one Driver.js lifecycle.
//
// driver.js (~30KB gz) is dynamically imported on first highlight so it never
// sits in the eager bundle; the highlight path is rare and can afford one
// import round-trip.
import type { AllowedButtons, Driver } from 'driver.js';
import { resolveTourTarget } from './tourTarget';

let activeDriver: Driver | null = null;
let activeTimer: number | null = null;

function clearActiveDriver() {
  if (activeTimer !== null) {
    window.clearTimeout(activeTimer);
    activeTimer = null;
  }
  activeDriver?.destroy();
  activeDriver = null;
}

// Returns true when an element with `targetId` was found (and therefore
// scrolled; the spotlight follows as soon as driver.js loads); false lets the
// caller report an honest ack. Found/not-found stays SYNCHRONOUS — the agent
// chat ack contract depends on it. Resolves via `resolveTourTarget`
// (data-tour-id → id precedence) so both legacy stable ids and data-attr
// targets spotlight correctly.
export function highlightElement(targetId: string, durationMs = 2000): boolean {
  const el = resolveTourTarget(targetId);
  if (!el) return false;

  clearActiveDriver();

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  void Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]).then(([{ driver }]) => {
  activeDriver = driver({
    animate: true,
    duration: 400,
    smoothScroll: true,
    allowClose: true,
    allowScroll: true,
    overlayColor: '#0f172a',
    overlayOpacity: 0.55,
    stagePadding: 8,
    stageRadius: 10,
    popoverClass: 'agent-driver-popover',
    showButtons: ['close'],
    doneBtnText: 'Đã hiểu',
    onDestroyed: () => {
      activeDriver = null;
      if (activeTimer !== null) {
        window.clearTimeout(activeTimer);
        activeTimer = null;
      }
    },
  });

    activeDriver.highlight({
      element: el,
      popover: {
        title: 'Làm nổi bật',
        description: 'Bấm vào vùng đang được tô sáng để tiếp tục.',
        side: 'bottom' as const,
        align: 'center' as const,
        // Annotate so TS infers Driver.js's AllowedButtons[], not string[].
        showButtons: ['close'] as AllowedButtons[],
        doneBtnText: 'Đã hiểu',
      },
    });

    activeTimer = window.setTimeout(() => {
      clearActiveDriver();
    }, durationMs);
  });

  return true;
}
