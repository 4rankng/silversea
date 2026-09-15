export const APP_NAVIGATION_EVENT = 'tingting:before-app-navigation';
export type AppNavigationDetail = { path: string; proceed: () => void };

/** Route buttons and links share the same draft-discard boundary. */
export function requestAppNavigation(path: string, proceed: () => void) {
  const event = new CustomEvent<AppNavigationDetail>(APP_NAVIGATION_EVENT, {
    cancelable: true,
    detail: { path, proceed },
  });
  if (window.dispatchEvent(event)) proceed();
}
