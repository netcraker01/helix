import { describe, expect, it, vi } from 'vitest';
import { createResponsiveCollapseOwner } from './viewport';

describe('responsive panel owner', () => {
  it('collapses once initially and on every repeated wide-to-narrow crossing', () => {
    const collapse = vi.fn();
    const resize = createResponsiveCollapseOwner(collapse);
    resize(1100);
    resize(1000);
    resize(1300);
    resize(1199);
    resize(1250);
    resize(800);
    expect(collapse).toHaveBeenCalledTimes(3);
  });

  it('does not mutate panel state when widening', () => {
    const collapse = vi.fn();
    const resize = createResponsiveCollapseOwner(collapse);
    resize(1400);
    resize(1500);
    expect(collapse).not.toHaveBeenCalled();
  });
});
