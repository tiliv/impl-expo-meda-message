/**
 * The layout solver.
 *
 * Given N items of mixed type and a container width, produce an exact
 * arrangement. Pure, deterministic, and measured in one pass — no
 * onLayout round-trips, no "render then correct", which is what produces the
 * reflow jitter you see in chat apps when a media message scrolls into view.
 *
 * The rules, in the order they matter:
 *
 *  1. Non-visual items never enter the grid. Audio and files have no intrinsic
 *     aspect ratio; giving them a tile means inventing one.
 *  2. Aspect ratios are clamped, never honoured absolutely. One 9:32 screenshot
 *     must not push the rest of the conversation off screen.
 *  3. Every row is exactly the container width. Tile heights within a row are
 *     equal, widths are proportional to aspect. This is the standard justified
 *     row layout and it is what stops the grid looking like a ransom note.
 *  4. Beyond `maxItemsRendered` the tail collapses into a "+N" badge rather
 *     than growing the message unboundedly.
 */

import type { MediaSettings } from './settings';
import { aspectOf, isVisual, type MediaItem, type VisualItem } from './types';

export interface Tile {
  item: VisualItem;
  width: number;
  height: number;
  /** Set on the last rendered tile when items were held back. */
  overflowCount?: number;
}

export interface LayoutRow {
  tiles: Tile[];
  height: number;
}

export type VisualLayout =
  | { style: 'none' }
  | { style: 'hero'; tile: Tile }
  | { style: 'rows'; rows: LayoutRow[] }
  | { style: 'carousel'; tiles: Tile[]; height: number };

export interface LayoutPlan {
  visual: VisualLayout;
  /** Audio and files, in original order, rendered as rows beneath the grid. */
  nonVisual: MediaItem[];
  /** Visual items not drawn because of `maxItemsRendered`. */
  overflow: number;
  /** Total height the message will occupy, excluding caption and notes. */
  visualHeight: number;
}

export interface LayoutConstraints {
  containerWidth: number;
  gap?: number;
}

/** A single image this tall relative to the container starts eating the screen. */
const MAX_HERO_HEIGHT_RATIO = 1.1;
const MIN_ASPECT = 0.62; // portrait limit  (about 5:8)
const MAX_ASPECT = 2.4; // panorama limit

const clampAspect = (a: number) => Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a));

/**
 * Lay out one row of tiles at exactly `width`.
 *
 * Common height h satisfies: sum(h * aspect_i) + gaps = width.
 */
function justifyRow(items: VisualItem[], width: number, gap: number): LayoutRow {
  const aspects = items.map((i) => clampAspect(aspectOf(i)));
  const totalAspect = aspects.reduce((s, a) => s + a, 0);
  // Clamped at zero: a container narrower than its own gaps is a real state
  // during first layout, and it must produce an empty row rather than tiles
  // with negative height.
  const available = Math.max(0, width - gap * (items.length - 1));
  const height = totalAspect > 0 ? available / totalAspect : 0;

  const tiles: Tile[] = items.map((item, i) => ({
    item,
    width: Math.floor(height * aspects[i]),
    height: Math.floor(height),
  }));

  // Absorb rounding into the last tile so the row is exactly `width`.
  if (tiles.length > 0 && available > 0) {
    const used = tiles.reduce((s, t) => s + t.width, 0) + gap * (items.length - 1);
    const last = tiles[tiles.length - 1];
    last.width = Math.max(0, last.width + (width - used));
  }
  return { tiles, height: Math.floor(height) };
}

/**
 * How to break N visuals into rows.
 *
 * Hand-tuned rather than solved, because the good arrangements for small N are
 * conventions people already recognise from every other chat app, and a
 * general optimiser produces technically-better layouts that read as wrong.
 * Above six, uniform rows of three is the only thing that stays legible.
 */
function partition(count: number, averageAspect: number): number[] {
  switch (count) {
    case 1:
      return [1];
    case 2:
      return [2];
    case 3:
      // Landscape trio reads better stacked 1-over-2; portrait trio as a strip.
      return averageAspect >= 1 ? [1, 2] : [3];
    case 4:
      return [2, 2];
    case 5:
      return [2, 3];
    case 6:
      return [3, 3];
    default: {
      const rows: number[] = [];
      let left = count;
      while (left > 0) {
        const take = Math.min(3, left);
        rows.push(take);
        left -= take;
      }
      return rows;
    }
  }
}

export function planMediaLayout(
  items: MediaItem[],
  constraints: LayoutConstraints,
  settings: MediaSettings,
): LayoutPlan {
  const gap = constraints.gap ?? 3;
  const width = Math.max(0, constraints.containerWidth);

  const allVisual = items.filter(isVisual);
  const nonVisual = items.filter((i) => !isVisual(i));

  const limit = Math.max(1, settings.maxItemsRendered.value);
  const shown = allVisual.slice(0, limit);
  const overflow = allVisual.length - shown.length;

  if (shown.length === 0) {
    return { visual: { style: 'none' }, nonVisual, overflow: 0, visualHeight: 0 };
  }

  // A room can force a presentation regardless of item count.
  if (settings.gridStyle.value === 'carousel') {
    const height = Math.min(width * 0.62, width / clampAspect(aspectOf(shown[0])));
    const tiles: Tile[] = shown.map((item, i) => ({
      item,
      width: Math.floor(height * clampAspect(aspectOf(item))),
      height: Math.floor(height),
      overflowCount: overflow > 0 && i === shown.length - 1 ? overflow : undefined,
    }));
    return { visual: { style: 'carousel', tiles, height }, nonVisual, overflow, visualHeight: height };
  }

  if (settings.gridStyle.value === 'list') {
    const rows = shown.map((item) => justifyRow([item], width, gap));
    const capped = capRows(rows, width, settings);
    return {
      visual: { style: 'rows', rows: capped },
      nonVisual,
      overflow,
      visualHeight: sumHeights(capped, gap),
    };
  }

  if (shown.length === 1) {
    const item = shown[0];
    const aspect = clampAspect(aspectOf(item));
    const maxHeight = Math.min(
      width * MAX_HERO_HEIGHT_RATIO,
      width * settings.maxInlineHeightRatio.value,
    );
    const height = Math.min(width / aspect, maxHeight);
    return {
      visual: { style: 'hero', tile: { item, width, height: Math.floor(height) } },
      nonVisual,
      overflow,
      visualHeight: Math.floor(height),
    };
  }

  const averageAspect = shown.reduce((s, i) => s + aspectOf(i), 0) / shown.length;
  const sizes = partition(shown.length, averageAspect);

  const rows: LayoutRow[] = [];
  let cursor = 0;
  for (const size of sizes) {
    const slice = shown.slice(cursor, cursor + size);
    cursor += size;
    rows.push(justifyRow(slice, width, gap));
  }

  // The "+N" badge belongs on the last visible tile.
  if (overflow > 0) {
    const lastRow = rows[rows.length - 1];
    lastRow.tiles[lastRow.tiles.length - 1].overflowCount = overflow;
  }

  const capped = capRows(rows, width, settings);
  return {
    visual: { style: 'rows', rows: capped },
    nonVisual,
    overflow,
    visualHeight: sumHeights(capped, gap),
  };
}

/**
 * Stop a tall stack from running past the room's height budget.
 *
 * Scaling rows down rather than dropping them keeps the item count honest:
 * the user sees all N, just smaller. Dropping rows would need a second "+N",
 * which is confusing next to the overflow badge that already exists.
 */
function capRows(rows: LayoutRow[], width: number, settings: MediaSettings): LayoutRow[] {
  const gap = 3;
  const maxHeight = width * settings.maxInlineHeightRatio.value;
  const total = sumHeights(rows, gap);
  if (total <= maxHeight || total === 0) return rows;

  const scale = maxHeight / total;
  return rows.map((row) => ({
    height: Math.floor(row.height * scale),
    tiles: row.tiles.map((t) => ({ ...t, height: Math.floor(t.height * scale) })),
  }));
}

const sumHeights = (rows: LayoutRow[], gap: number): number =>
  rows.reduce((s, r) => s + r.height, 0) + gap * Math.max(0, rows.length - 1);

/** Flattens a plan back to the item order the single-view walk follows. */
export function orderedItems(items: MediaItem[]): MediaItem[] {
  return items;
}
