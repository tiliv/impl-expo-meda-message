/**
 * The experiment's stand-in for a room holding media messages.
 *
 * Sample items use a `synthetic://` URI scheme so scenarios render instantly,
 * offline, and identically on every run — a layout experiment that depends on
 * a CDN is not an experiment, it is a network test. Real device media can be
 * added on top via the picker, and takes the same path through the solver.
 */

import { RoomStateStore } from '../core/roomState';
import { SPRINT_CAPABILITIES, type ClientCapabilities } from '../core/capabilities';
import { initialWalk, walkReducer, type WalkAction, type WalkState } from '../core/singleView';
import { resolveMediaSettings } from '../core/settings';
import type { EventId, MediaItem, MediaMessage } from '../core/types';

export const EPOCH = Date.UTC(2026, 0, 15, 12, 0, 0);

/** Deterministic pseudo-media. The number is a hue; the tile paints itself. */
export const synthetic = (hue: number): string => `synthetic://${hue}`;

export const isSynthetic = (uri: string): boolean => uri.startsWith('synthetic://');

export const syntheticHue = (uri: string): number => Number(uri.slice('synthetic://'.length)) || 0;

export class ExperimentWorld {
  readonly stateStore = new RoomStateStore();
  capabilities: ClientCapabilities = { ...SPRINT_CAPABILITIES };

  private messageList: MediaMessage[] = [];
  private walks = new Map<EventId, WalkState>();
  private listeners = new Set<() => void>();

  revision = 0;

  constructor() {
    this.stateStore.subscribe(() => this.emit());
  }

  reset(): void {
    this.messageList = [];
    this.walks.clear();
    this.capabilities = { ...SPRINT_CAPABILITIES };
    this.stateStore.reset([]);
    this.emit();
  }

  add(...messages: MediaMessage[]): this {
    this.messageList.push(...messages);
    for (const m of messages) this.walks.set(m.id, initialWalk(m.items));
    this.emit();
    return this;
  }

  messages(): MediaMessage[] {
    return this.messageList;
  }

  /** Appends real device media to the first message, so the picker is useful. */
  appendItems(messageId: EventId, items: MediaItem[]): void {
    const message = this.messageList.find((m) => m.id === messageId);
    if (!message) return;
    message.items = [...message.items, ...items];
    this.walks.set(message.id, initialWalk(message.items));
    this.emit();
  }

  setCapabilities(next: Partial<ClientCapabilities>): void {
    this.capabilities = { ...this.capabilities, ...next };
    this.emit();
  }

  walk(id: EventId): WalkState {
    const existing = this.walks.get(id);
    if (existing) return existing;
    const message = this.messageList.find((m) => m.id === id);
    const fresh = initialWalk(message?.items ?? []);
    this.walks.set(id, fresh);
    return fresh;
  }

  /**
   * Drives the walk through the same reducer the app would use, against the
   * settings resolved from current room state — not a snapshot taken earlier.
   * Change the policy mid-walk in the panel and the next step obeys the new one.
   */
  dispatchWalk(id: EventId, action: WalkAction): void {
    const settings = resolveMediaSettings(this.stateStore, this.capabilities).settings;
    this.walks.set(id, walkReducer(this.walk(id), action, settings));
    this.emit();
  }

  resetWalk(id: EventId): void {
    const message = this.messageList.find((m) => m.id === id);
    this.walks.set(id, initialWalk(message?.items ?? []));
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = (): number => this.revision;

  private emit(): void {
    this.revision += 1;
    this.listeners.forEach((l) => l());
  }
}

// --- fixture helpers -----------------------------------------------------

let itemSeq = 0;

export function image(width: number, height: number, hue: number, extra: Partial<MediaItem> = {}): MediaItem {
  itemSeq += 1;
  return {
    kind: 'image',
    id: `i${itemSeq}`,
    mimetype: 'image/jpeg',
    uri: synthetic(hue),
    width,
    height,
    size: 400_000,
    ...extra,
  } as MediaItem;
}

export function video(
  width: number,
  height: number,
  hue: number,
  durationMs: number,
  extra: Partial<MediaItem> = {},
): MediaItem {
  itemSeq += 1;
  return {
    kind: 'video',
    id: `v${itemSeq}`,
    mimetype: 'video/mp4',
    uri: synthetic(hue),
    thumbnailUri: synthetic(hue),
    width,
    height,
    durationMs,
    size: 8_000_000,
    ...extra,
  } as MediaItem;
}

export function audio(durationMs: number, extra: Partial<MediaItem> = {}): MediaItem {
  itemSeq += 1;
  return {
    kind: 'audio',
    id: `a${itemSeq}`,
    mimetype: 'audio/mp4',
    uri: synthetic(200),
    durationMs,
    size: 300_000,
    // A plausible-looking waveform, generated deterministically.
    waveform: Array.from({ length: 40 }, (_, i) => 0.25 + 0.7 * Math.abs(Math.sin(i * 0.7)) * (1 - i / 90)),
    ...extra,
  } as MediaItem;
}

export function file(filename: string, size: number, extra: Partial<MediaItem> = {}): MediaItem {
  itemSeq += 1;
  return {
    kind: 'file',
    id: `f${itemSeq}`,
    mimetype: 'application/pdf',
    uri: synthetic(0),
    filename,
    size,
    ...extra,
  } as MediaItem;
}

let messageSeq = 0;

export function message(items: MediaItem[], extra: Partial<MediaMessage> = {}): MediaMessage {
  messageSeq += 1;
  return {
    id: `$m${messageSeq}`,
    sender: '@alice:example.org',
    originTs: EPOCH,
    items,
    ...extra,
  };
}
