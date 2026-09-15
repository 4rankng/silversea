/** Keep operational records readable: animate only visible, independent surfaces. */
export function visibleEntranceTargets(elements: Iterable<Element>): HTMLElement[] {
  const candidates = new Set([...elements].filter((element): element is HTMLElement => element instanceof HTMLElement));
  return [...candidates].filter(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (candidates.has(parent)) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < window.innerHeight && rect.left < window.innerWidth;
  });
}

/** The final record starts within 80ms, independent of the list length. */
export function entranceDelay(index: number, step: number, start = 0): number {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.min(80, finite(start) + finite(index) * finite(step));
}
