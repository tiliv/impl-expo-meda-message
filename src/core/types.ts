/**
 * A media message: one envelope, several pieces of media, mixed types.
 *
 * The organising distinction is **visual vs non-visual**. An image and a video
 * have an intrinsic aspect ratio and belong in a grid. An audio clip and a PDF
 * do not — giving them a tile means inventing a shape for something that has
 * none, and the result is a grid of grey rectangles with filenames in them.
 * So they render as rows, below, always.
 *
 * Everything downstream keys off `visualKind()`, not off the mimetype string.
 */

export type ItemId = string;
export type EventId = string;
export type UserId = string;

interface BaseItem {
  id: ItemId;
  mimetype: string;
  /** Bytes. Drives the "large file" affordance on non-visual rows. */
  size?: number;
  /**
   * Per-item annotation. Not in the first sprint — the render slot exists and
   * is gated by `media.show_item_notes`, which defaults off. See README, this
   * one is built ahead of a requirement that is not fully pinned down yet.
   */
  note?: string;
  /** Sender-supplied alt text. Distinct from `note`: this one is for a11y. */
  alt?: string;
}

export interface ImageItem extends BaseItem {
  kind: 'image';
  uri: string;
  width: number;
  height: number;
  /** Low-res placeholder, e.g. a blurhash or thumbhash string. */
  placeholder?: string;
}

export interface VideoItem extends BaseItem {
  kind: 'video';
  uri: string;
  width: number;
  height: number;
  durationMs: number;
  thumbnailUri?: string;
  placeholder?: string;
}

export interface AudioItem extends BaseItem {
  kind: 'audio';
  uri: string;
  durationMs: number;
  /** Normalised 0..1 samples for a waveform, if the sender computed one. */
  waveform?: number[];
}

export interface FileItem extends BaseItem {
  kind: 'file';
  uri: string;
  filename: string;
}

export type MediaItem = ImageItem | VideoItem | AudioItem | FileItem;

export type VisualItem = ImageItem | VideoItem;

/** The one predicate the layout solver branches on. */
export const isVisual = (item: MediaItem): item is VisualItem =>
  item.kind === 'image' || item.kind === 'video';

export const aspectOf = (item: VisualItem): number =>
  item.height > 0 ? item.width / item.height : 1;

export interface MediaMessage {
  id: EventId;
  sender: UserId;
  originTs: number;
  /** Order is meaningful and is the order the single-view walk follows. */
  items: MediaItem[];
  caption?: string;
  /**
   * Sender's request for single-view semantics.
   *
   * Present in the model on purpose even though the sprint build will not
   * honour it — see `capabilities.ts`. A room can start sending this before
   * every client understands it, and what a client does in that window is a
   * real decision, not an edge case.
   */
  singleView?: { requested: true };
}

export function totalDuration(items: MediaItem[]): number {
  return items.reduce((sum, i) => sum + ('durationMs' in i ? i.durationMs : 0), 0);
}

export function formatDurationShort(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
