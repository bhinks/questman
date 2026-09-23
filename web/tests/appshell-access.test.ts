/**
 * Pure nav-visibility tests for the module allowlist (creative-hub brief 2.15).
 *
 * Lives outside src/ so `tsc -b` (which only includes src) never type-checks
 * a vitest import the web tree has no types for. Runs on the backend's vitest:
 *   cd web && ../backend/node_modules/.bin/vitest run --root . --dir tests
 */
import { describe, it, expect } from 'vitest';
import { visibleTabsFor, pinnedTabsFor, quickAddFor } from '../src/components/AppShell';

const ALL_KEYS = ['finance', 'fitness', 'habits', 'chores', 'projects', 'media', 'vitals', 'social', 'steam'];
const ALL_TABS = [
  'today', 'bosses', 'handler',
  'habits', 'operations', 'health', 'media', 'social', 'steam',
  'overview', 'budgets', 'bills', 'savings',
  'progress', 'shop', 'calibration',
];

describe('visibleTabsFor', () => {
  it('a chores-only restricted kid sees exactly today, operations, progress, shop, calibration', () => {
    const ids = visibleTabsFor(['chores'], true);
    expect([...ids].sort()).toEqual(['calibration', 'operations', 'progress', 'shop', 'today']);
    for (const hidden of ['habits', 'bosses', 'handler', 'overview', 'health']) {
      expect(ids.has(hidden), hidden).toBe(false);
    }
  });
  it('adding vitals unlocks the health tab', () => {
    const ids = visibleTabsFor(['chores', 'vitals'], true);
    expect(ids.has('health')).toBe(true);
    expect(ids.has('habits')).toBe(false);
  });
  it('chores maps to operations, habits to habits (they are different tabs)', () => {
    expect(visibleTabsFor(['habits'], true).has('operations')).toBe(false);
    expect(visibleTabsFor(['habits'], true).has('habits')).toBe(true);
    expect(visibleTabsFor(['chores'], true).has('habits')).toBe(false);
  });
  it('an unrestricted member with every key sees every tab', () => {
    const ids = visibleTabsFor(ALL_KEYS, false);
    expect([...ids].sort()).toEqual([...ALL_TABS].sort());
  });
  it('unrestricted keeps bosses and handler even with no module keys yet', () => {
    const ids = visibleTabsFor([], false);
    expect(ids.has('bosses')).toBe(true);
    expect(ids.has('handler')).toBe(true);
  });
  it('an empty allowlist collapses to the restricted always-visible set', () => {
    expect([...visibleTabsFor([], true)].sort()).toEqual(['calibration', 'progress', 'shop', 'today']);
  });
  it('unknown keys are ignored', () => {
    expect([...visibleTabsFor(['bogus'], true)].sort()).toEqual(['calibration', 'progress', 'shop', 'today']);
  });
});

describe('pinnedTabsFor', () => {
  it('backfills the bottom nav for a chores-only kid: today, operations, progress, shop', () => {
    const ids = pinnedTabsFor(visibleTabsFor(['chores'], true)).map(([id]) => id);
    expect(ids).toEqual(['today', 'operations', 'progress', 'shop']);
  });
  it('keeps the classic pinned four for an unrestricted member', () => {
    const ids = pinnedTabsFor(visibleTabsFor(ALL_KEYS, false)).map(([id]) => id);
    expect(ids).toEqual(['today', 'habits', 'operations', 'health']);
  });
  it('never exceeds four cells and never lists a hidden tab', () => {
    const visible = visibleTabsFor(['chores', 'vitals'], true);
    const items = pinnedTabsFor(visible);
    expect(items.length).toBeLessThanOrEqual(4);
    for (const [id] of items) expect(visible.has(id), id).toBe(true);
    expect(items.map(([id]) => id)).toEqual(['today', 'operations', 'health', 'progress']);
  });
  it('uses short labels for the narrow cells', () => {
    const items = pinnedTabsFor(visibleTabsFor(['chores'], true));
    const label = Object.fromEntries(items.map(([id, l]) => [id, l]));
    expect(label.operations).toBe('Ops');
    expect(label.progress).toBe('Cred');
  });
});

describe('pinnedTabsFor before access is ready', () => {
  it('the classic four cells hold their shape until the modules query answers', () => {
    const ids = pinnedTabsFor(new Set(['today', 'habits', 'operations', 'health'])).map(([id]) => id);
    expect(ids).toEqual(['today', 'habits', 'operations', 'health']);
  });
});

describe('quickAddFor', () => {
  it('shows before access is ready (baseline chrome)', () => {
    expect(quickAddFor([], false)).toBe(true);
  });
  it('shows for habits or chores holders', () => {
    expect(quickAddFor(['chores'], true)).toBe(true);
    expect(quickAddFor(['habits'], true)).toBe(true);
    expect(quickAddFor(ALL_KEYS, true)).toBe(true);
  });
  it('hides when the member holds neither (the server would 403 the post)', () => {
    expect(quickAddFor(['vitals'], true)).toBe(false);
    expect(quickAddFor([], true)).toBe(false);
  });
});
