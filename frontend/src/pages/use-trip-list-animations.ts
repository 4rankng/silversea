import { useListAnimations, usePageAnimations } from '../hooks/animations';
export function useTripListAnimations() {
    const { rootRef } = usePageAnimations({
      ready: true,
      selectors: ['.hero', '.list-filter-bar', '.table-card', '.table-foot'],
      staggerDelay: 80,
    });
    // Animation hooks called for side effects (attach observers / register
    // animations). Their return values are not needed on this page.
    useListAnimations({
      itemSelector: '.table-row',
      mode: 'rows',
      deps: [],
    });
    useListAnimations({
      itemSelector: '.metric',
      mode: 'cards',
      staggerDelay: 60,
    });
  return rootRef;
}
