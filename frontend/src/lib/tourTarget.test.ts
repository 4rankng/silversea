import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTourTarget } from './tourTarget';

/**
 * Target resolver contract. The resolver is the single lookup the agent
 * highlight spotlight uses; precedence (data-tour-id → id) must hold.
 */
describe('resolveTourTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds an element by data-tour-id', () => {
    const el = document.createElement('button');
    el.setAttribute('data-tour-id', 'trip-create-button');
    document.body.appendChild(el);
    expect(resolveTourTarget('trip-create-button')).toBe(el);
  });

  it('finds an element by id (legacy stable ids)', () => {
    const el = document.createElement('button');
    el.id = 'trip-new-submit';
    document.body.appendChild(el);
    expect(resolveTourTarget('trip-new-submit')).toBe(el);
  });

  it('prefers data-tour-id when both attributes are present on different elements', () => {
    const byId = document.createElement('button');
    byId.id = 'shared-id';
    document.body.appendChild(byId);
    const byAttr = document.createElement('button');
    byAttr.setAttribute('data-tour-id', 'shared-id');
    document.body.appendChild(byAttr);
    expect(resolveTourTarget('shared-id')).toBe(byAttr);
  });

  it('returns null when the target is absent', () => {
    expect(resolveTourTarget('does-not-exist')).toBeNull();
  });

  it('returns null for an empty targetId', () => {
    expect(resolveTourTarget('')).toBeNull();
  });

  it('escapes CSS meta-characters in a data-tour-id', () => {
    const el = document.createElement('button');
    // A targetId containing a character that is special in CSS selectors.
    el.setAttribute('data-tour-id', 'item[0]');
    document.body.appendChild(el);
    expect(resolveTourTarget('item[0]')).toBe(el);
  });
});
