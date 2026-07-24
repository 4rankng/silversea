/** Shared route-name utilities. */

export function splitRoute(routeName: string | undefined | null): { from: string; to: string } | null {
  if (!routeName) return null;
  const separators = ['→', '⇒', '->', ' - ', ' – ', '>'];
  for (const sep of separators) {
    if (routeName.includes(sep)) {
      const [from, to] = routeName.split(sep).map((s) => s.trim());
      if (from && to) return { from, to };
    }
  }
  return null;
}
