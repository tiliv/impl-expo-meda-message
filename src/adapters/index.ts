/**
 * The seam.
 *
 * `src/core` is pure TypeScript — no React, no React Native, no Matrix SDK. It
 * needs three things from the outside world, listed here. The experiment
 * implements them in memory; the app implements them against its real stores.
 *
 * Integration should mean writing these three and deleting `src/experiment`.
 */

import type { RoomStateStore } from '../core/roomState';
import type { ClientCapabilities } from '../core/capabilities';
import type { EventId, ItemId, MediaItem, MediaMessage } from '../core/types';

export type { MediaItem, MediaMessage, ItemId, EventId, ClientCapabilities };

/** Room state as the client currently knows it. Resolution stays in core. */
export interface RoomStateSource {
  state(): RoomStateStore;
  subscribe(listener: () => void): () => void;
}

/**
 * Where destruction actually happens.
 *
 * The walk reducer is pure: it decides *that* an item should be destroyed and
 * records why. Something has to then delete the bytes, and that is this. Make
 * it idempotent — the reducer will not ask twice, but a retried sync might.
 *
 * The ordering that matters: delete locally first, then tell the server. A
 * client that reports destruction it has not performed is worse than one that
 * is briefly out of sync.
 */
export interface MediaStore {
  /** Remove the local copy: cache entry, downloaded file, thumbnail. */
  destroyLocal(messageId: EventId, itemId: ItemId): Promise<void>;
  /** Tell the homeserver, if the policy involves server-side removal. */
  reportConsumed(messageId: EventId, itemId: ItemId): Promise<void>;
  /** Resolve an mxc:// reference to something the renderer can load. */
  resolveUri(item: MediaItem): string;
}

/**
 * What this build can honour. Not a room setting — see `core/capabilities.ts`.
 * In the real app this is a constant, compiled in. It is only mutable in the
 * experiment so the future behaviour is inspectable now.
 */
export interface CapabilitySource {
  capabilities(): ClientCapabilities;
}

/**
 * Wiring the walk to a real `MediaStore`:
 *
 *   const next = walkReducer(state, action, settings);
 *   for (const event of next.log.slice(state.log.length)) {
 *     if (event.kind === 'destroy_item' && event.itemId) {
 *       await store.destroyLocal(message.id, event.itemId);
 *       await store.reportConsumed(message.id, event.itemId);
 *     }
 *   }
 *
 * Diffing the log rather than the item states is deliberate: the log is
 * append-only and ordered, so the effects run exactly once and in the order
 * the policy intended.
 */
