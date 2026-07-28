export const RESPONSIVE_COLLAPSE_THRESHOLD = 1200;

/** Emit once on initial narrow load and once per later wide-to-narrow crossing. */
export function createResponsiveCollapseOwner(collapse: () => void): (width: number) => void {
  let wasNarrow = false;
  return (width) => {
    const narrow = width < RESPONSIVE_COLLAPSE_THRESHOLD;
    if (narrow && !wasNarrow) collapse();
    wasNarrow = narrow;
  };
}
