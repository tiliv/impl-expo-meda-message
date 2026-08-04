import { planMediaLayout, type LayoutRow } from '../layout';
import { resolveMediaSettings } from '../settings';
import { SPRINT_CAPABILITIES, FUTURE_CAPABILITIES } from '../capabilities';
import { stateEvent } from '../roomState';
import { STATE_MEDIA } from '../settings';
import { RoomStateStore } from '../roomState';
import { audio, file, image, video } from '../../experiment/world';
import { SCENARIOS } from '../../experiment/scenarios';
import { isVisual } from '../types';

const WIDTH = 320;
const GAP = 3;

const settingsFrom = (content?: Record<string, unknown>) => {
  const store = new RoomStateStore();
  if (content) store.send(stateEvent(STATE_MEDIA, content));
  return resolveMediaSettings(store, FUTURE_CAPABILITIES).settings;
};

const plan = (items: Parameters<typeof planMediaLayout>[0], content?: Record<string, unknown>) =>
  planMediaLayout(items, { containerWidth: WIDTH, gap: GAP }, settingsFrom(content));

const rowWidth = (row: LayoutRow) =>
  row.tiles.reduce((s, t) => s + t.width, 0) + GAP * (row.tiles.length - 1);

describe('planMediaLayout', () => {
  it('puts audio and files outside the grid, always', () => {
    const result = plan([image(2000, 1500, 10), audio(30_000), file('contract.pdf', 900_000), video(1920, 1080, 40, 5000)]);
    expect(result.nonVisual).toHaveLength(2);
    expect(result.nonVisual.every((i) => !isVisual(i))).toBe(true);
    if (result.visual.style !== 'rows') throw new Error('expected rows');
    const gridItems = result.visual.rows.flatMap((r) => r.tiles.map((t) => t.item));
    expect(gridItems.every(isVisual)).toBe(true);
  });

  it('makes every row exactly the container width', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 9]) {
      const items = Array.from({ length: count }, (_, i) => image(1600 + i * 100, 1200, i * 20));
      const result = plan(items, { max_items_rendered: 24 });
      if (result.visual.style !== 'rows') throw new Error('expected rows');
      for (const row of result.visual.rows) {
        expect(rowWidth(row)).toBe(WIDTH);
      }
    }
  });

  it('gives every tile in a row the same height', () => {
    const result = plan([image(4000, 2000, 10), image(1000, 2000, 40), image(2000, 2000, 70)], {
      max_items_rendered: 24,
    });
    if (result.visual.style !== 'rows') throw new Error('expected rows');
    for (const row of result.visual.rows) {
      const heights = new Set(row.tiles.map((t) => t.height));
      expect(heights.size).toBe(1);
    }
  });

  it('clamps an extreme aspect ratio instead of honouring it', () => {
    const result = plan([image(1170, 4000, 200)]);
    if (result.visual.style !== 'hero') throw new Error('expected hero');
    // True ratio would be ~1094px tall at this width. The clamp must bite.
    expect(result.visual.tile.height).toBeLessThan(WIDTH * 1.5);
    expect(result.visual.tile.width).toBe(WIDTH);
  });

  it('splits three landscape items differently from three portrait ones', () => {
    const landscape = plan([image(4000, 2250, 10), image(4000, 2250, 40), image(4000, 2250, 70)]);
    const portrait = plan([image(1080, 1920, 10), image(1080, 1920, 40), image(1080, 1920, 70)]);
    if (landscape.visual.style !== 'rows' || portrait.visual.style !== 'rows') throw new Error('expected rows');
    expect(landscape.visual.rows.map((r) => r.tiles.length)).toEqual([1, 2]);
    expect(portrait.visual.rows.map((r) => r.tiles.length)).toEqual([3]);
  });

  it('collapses the tail into a +N badge on the last visible tile', () => {
    const items = Array.from({ length: 12 }, (_, i) => image(1600, 1200, i * 25));
    const result = plan(items, { max_items_rendered: 6 });
    expect(result.overflow).toBe(6);
    if (result.visual.style !== 'rows') throw new Error('expected rows');
    const tiles = result.visual.rows.flatMap((r) => r.tiles);
    expect(tiles).toHaveLength(6);
    expect(tiles[tiles.length - 1].overflowCount).toBe(6);
    expect(tiles.slice(0, -1).every((t) => t.overflowCount === undefined)).toBe(true);
  });

  it('scales rows down to the height budget rather than dropping them', () => {
    const items = Array.from({ length: 9 }, (_, i) => image(1200, 1600, i * 20));
    const result = plan(items, { max_items_rendered: 9, max_inline_height_ratio: 0.9 });
    if (result.visual.style !== 'rows') throw new Error('expected rows');
    expect(result.visual.rows.flatMap((r) => r.tiles)).toHaveLength(9);
    expect(result.visualHeight).toBeLessThanOrEqual(Math.ceil(WIDTH * 0.9));
  });

  it('handles a message with no visual items at all', () => {
    const result = plan([audio(12_000), file('notes.txt', 400)]);
    expect(result.visual.style).toBe('none');
    expect(result.visualHeight).toBe(0);
    expect(result.nonVisual).toHaveLength(2);
  });

  it('is deterministic', () => {
    const items = [image(3000, 2000, 15), video(1920, 1080, 200, 14_000), image(2000, 3000, 300)];
    expect(JSON.stringify(plan(items))).toEqual(JSON.stringify(plan(items)));
  });

  it('never emits a negative or NaN dimension, even at zero width', () => {
    const items = Array.from({ length: 5 }, (_, i) => image(1600, 1200, i));
    const result = planMediaLayout(items, { containerWidth: 0, gap: GAP }, settingsFrom());
    if (result.visual.style !== 'rows') throw new Error('expected rows');
    for (const tile of result.visual.rows.flatMap((r) => r.tiles)) {
      expect(Number.isFinite(tile.width)).toBe(true);
      expect(Number.isFinite(tile.height)).toBe(true);
      expect(tile.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('resolveMediaSettings', () => {
  it('clamps and defaults bad values with warnings instead of throwing', () => {
    const store = new RoomStateStore();
    store.send(
      stateEvent(STATE_MEDIA, {
        max_items_rendered: -3,
        grid_style: 'mosaic',
        max_inline_height_ratio: 'tall',
      }),
    );
    const { settings, warnings } = resolveMediaSettings(store, FUTURE_CAPABILITIES);
    expect(settings.maxItemsRendered.value).toBe(1);
    expect(settings.gridStyle.value).toBe('grid');
    expect(settings.maxInlineHeightRatio.value).toBe(1.4);
    expect(warnings.map((w) => w.setting)).toEqual(
      expect.arrayContaining(['gridStyle', 'maxInlineHeightRatio']),
    );
  });

  it('overrides a room-requested capability the build does not have, loudly', () => {
    const store = new RoomStateStore();
    store.send(stateEvent('app.envelope.single_view', { enabled: true }, { sender: '@admin:example.org' }));

    const sprint = resolveMediaSettings(store, SPRINT_CAPABILITIES);
    expect(sprint.settings.singleViewEnabled.value).toBe(false);
    expect(sprint.settings.singleViewEnabled.source.kind).toBe('capability_override');
    expect(sprint.warnings.some((w) => w.severity === 'danger')).toBe(true);

    const future = resolveMediaSettings(store, FUTURE_CAPABILITIES);
    expect(future.settings.singleViewEnabled.value).toBe(true);
    expect(future.warnings).toHaveLength(0);
  });
});

describe('scenarios', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s lays out without throwing', (_id, scenario) => {
    const { ExperimentWorld } = require('../../experiment/world');
    const world = new ExperimentWorld();
    scenario.arrange(world);
    const settings = resolveMediaSettings(world.stateStore, world.capabilities).settings;
    for (const message of world.messages()) {
      const result = planMediaLayout(message.items, { containerWidth: WIDTH, gap: GAP }, settings);
      expect(result.visualHeight).toBeGreaterThanOrEqual(0);
    }
    expect(scenario.expect.length).toBeGreaterThan(0);
  });
});
