/**
 * A multi-item media envelope, packed for the wire and unpacked off it.
 *
 * This is the repo where the wire shape actually constrains the feature, in two
 * ways that were not visible before there was a wire at all.
 *
 * ## 1. Matrix has no "several things in one message"
 *
 * `m.room.message` carries exactly one `msgtype` and one body. Every multi-image
 * message you have seen in a Matrix client is N separate events grouped by the
 * renderer. That is a legitimate design and it is **not** the one this repo is
 * about — "one envelope holding several pieces of mixed media" means one event,
 * because the alternative gives up atomicity: N events can partially fail, be
 * partially revoked, and arrive interleaved with someone else's message.
 *
 * So the content shape here is ours: `msgtype: 'app.envelope.multi'` with an
 * `items` array. Cost: no other client will ever render it, and the fallback
 * `body` is the only thing an unaware reader sees.
 *
 * ## 2. Revocation caps the envelope at ten attachments
 *
 * `RevokeRoomMessageRequest.mediaIds` is `maxItems: 10`. Past ten, unsending the
 * message leaves the extra files downloadable. This is a **hard ceiling on the
 * feature**, it is nowhere in any doc, and it is the single most important thing
 * this file found out. `packMedia` reports it rather than silently truncating —
 * see `MAX_ATOMIC_ITEMS` and the `overflow` field.
 *
 * The honest options, none of them free:
 *
 * - Cap the composer at ten. Simplest, and a visible product limit.
 * - Split past ten into multiple events, losing atomicity for large sets.
 * - Send more than ten and accept unrevocable media. Only defensible if the UI
 *   says so at send time, which means saying it in a way people ignore.
 *
 * This file does not choose. It makes the choice unavoidable.
 */

import {
  asNumber,
  asString,
  decodeWire,
  isRecord,
  makeTxnId,
  MEDIA_IDS_PER_REVOCATION,
  wireTimestampMs,
  type DecodedEnvelope,
  type EncryptedFileRef,
  type OutgoingEnvelope,
  type WireEvent,
} from './envelope';
import type { MediaItem, MediaMessage, UserId } from './types';

export const MESSAGE_EVENT_TYPE = 'm.room.message';
export const MULTI_MSGTYPE = 'app.envelope.multi';

/**
 * The most items one envelope can hold and still be fully revocable.
 *
 * Not a design preference — it is `maxItems: 10` on the revoke request, read off
 * the spec.
 */
export const MAX_ATOMIC_ITEMS = MEDIA_IDS_PER_REVOCATION;

/** One item, paired with the encrypted blob it lives in. */
export interface PackableItem {
  item: MediaItem;
  file: EncryptedFileRef;
}

export interface PackMediaInput {
  items: PackableItem[];
  caption?: string;
  /**
   * Sender is asking for single-view semantics.
   *
   * This is where the sandbox's invented single-view walk meets something real:
   * `MediaUploadInitRequest.viewOnce` makes the *server* 410 the second download.
   * The two are not the same mechanism and both are needed — the server flag
   * stops a second device fetching the bytes, and the client walk is what makes
   * the first view single. Requesting one without the other gives you a
   * "single-view" image that a reinstall can fetch again.
   */
  singleView?: boolean;
  seed: string | number;
}

export interface PackedMedia extends OutgoingEnvelope {
  /**
   * Items beyond the tenth: present in the envelope, absent from any revoke.
   *
   * Empty is the only comfortable value. Non-empty means the composer has to
   * either refuse, split, or warn.
   */
  overflow: string[];
}

export function packMedia(input: PackMediaInput): PackedMedia {
  const items = input.items.map(({ item, file }) => itemToWire(item, file, input.singleView === true));
  const mediaIds = input.items.map(({ file }) => file.mediaId);

  const content: Record<string, unknown> = {
    msgtype: MULTI_MSGTYPE,
    // The fallback body is the only thing an unaware client shows. Deliberately a
    // count rather than a filename list: filenames leak content that the
    // envelope's own retention is supposed to govern.
    body: input.caption && input.caption.trim() !== '' ? input.caption.trim() : describeCount(input.items.length),
    'app.envelope.items': items,
  };
  if (input.caption && input.caption.trim() !== '') content['app.envelope.caption'] = input.caption.trim();
  if (input.singleView === true) content['app.envelope.single_view'] = { requested: true };

  return {
    eventType: MESSAGE_EVENT_TYPE,
    content,
    txnId: makeTxnId(input.seed),
    mediaIds,
    overflow: mediaIds.slice(MAX_ATOMIC_ITEMS),
  };
}

const describeCount = (n: number): string => (n === 1 ? '1 attachment' : `${n} attachments`);

/**
 * One item's wire form.
 *
 * `msgtype` per item, mirroring what a single-item Matrix message would have used
 * — so that if we ever do split a large set into N events, each item already
 * carries the type that event would need. Cheap now, and the alternative is a
 * migration.
 */
function itemToWire(item: MediaItem, file: EncryptedFileRef, singleView: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    msgtype: msgtypeFor(item),
    file: { ...file, ...(singleView ? { viewOnce: true } : {}) },
    info: infoFor(item),
  };
  if (item.alt !== undefined) base['app.envelope.alt'] = item.alt;
  // `note` is gated off in the sprint build but is packed when present, because a
  // room may start sending it before every client renders it — see capabilities.ts.
  if (item.note !== undefined) base['app.envelope.note'] = item.note;
  return base;
}

const msgtypeFor = (item: MediaItem): string =>
  item.kind === 'image' ? 'm.image' : item.kind === 'video' ? 'm.video' : item.kind === 'audio' ? 'm.audio' : 'm.file';

function infoFor(item: MediaItem): Record<string, unknown> {
  const info: Record<string, unknown> = { mimetype: item.mimetype };
  if (item.size !== undefined) info['size'] = item.size;
  if (item.kind === 'image' || item.kind === 'video') {
    info['w'] = item.width;
    info['h'] = item.height;
    if (item.placeholder !== undefined) info['app.envelope.placeholder'] = item.placeholder;
  }
  if (item.kind === 'video' || item.kind === 'audio') info['duration'] = item.durationMs;
  if (item.kind === 'video' && item.thumbnailUri !== undefined) info['thumbnail_media_id'] = item.thumbnailUri;
  if (item.kind === 'audio' && item.waveform !== undefined) info['app.envelope.waveform'] = item.waveform;
  if (item.kind === 'file') info['app.envelope.filename'] = item.filename;
  return info;
}

// ── Unpacking ───────────────────────────────────────────────────────────────

export interface UnpackedMedia {
  message: MediaMessage;
  /** Parallel to `message.items`. Key material, kept out of the render model. */
  files: EncryptedFileRef[];
}

export function unpackMedia(wire: WireEvent): DecodedEnvelope<UnpackedMedia> {
  return decodeWire<UnpackedMedia>(
    wire,
    (_eventType, content) => {
      if (asString(content['msgtype']) !== MULTI_MSGTYPE) return null;
      const raw = content['app.envelope.items'];
      if (!Array.isArray(raw) || raw.length === 0) return null;

      const items: MediaItem[] = [];
      const files: EncryptedFileRef[] = [];
      for (const [index, entry] of raw.entries()) {
        if (!isRecord(entry)) continue;
        const parsed = wireToItem(entry, index);
        // One unreadable item does not discard the envelope. A set of nine photos
        // where the tenth is malformed should show nine, not nothing — and
        // `items.length` vs the wire length is how the UI knows to say so.
        if (parsed === null) continue;
        items.push(parsed.item);
        files.push(parsed.file);
      }
      if (items.length === 0) return null;

      const caption = asString(content['app.envelope.caption']);
      const singleView = isRecord(content['app.envelope.single_view']);

      return {
        message: {
          id: wire.eventId,
          sender: wire.senderUserId as UserId,
          originTs: wireTimestampMs(wire),
          items,
          ...(caption === null ? {} : { caption }),
          ...(singleView ? { singleView: { requested: true as const } } : {}),
        },
        files,
      };
    },
    (eventType) => eventType === MESSAGE_EVENT_TYPE,
  );
}

function wireToItem(entry: Record<string, unknown>, index: number): { item: MediaItem; file: EncryptedFileRef } | null {
  const file = isRecord(entry['file']) ? (entry['file'] as unknown as EncryptedFileRef) : null;
  if (file === null || typeof file.mediaId !== 'string') return null;

  const info = isRecord(entry['info']) ? entry['info'] : {};
  const mimetype = asString(info['mimetype']) ?? 'application/octet-stream';
  const size = asNumber(info['size']);
  const alt = asString(entry['app.envelope.alt']);
  const note = asString(entry['app.envelope.note']);
  const common = {
    // The mediaId is the item id. Anything locally-generated would not survive a
    // reinstall, and the single-view walk keys off these ids.
    id: file.mediaId,
    mimetype,
    ...(size === null ? {} : { size }),
    ...(alt === null ? {} : { alt }),
    ...(note === null ? {} : { note }),
  };

  const msgtype = asString(entry['msgtype']) ?? 'm.file';
  const w = asNumber(info['w']);
  const h = asNumber(info['h']);
  const duration = asNumber(info['duration']);
  const placeholder = asString(info['app.envelope.placeholder']);
  const uri = `media://${file.mediaId}`;

  if (msgtype === 'm.image' && w !== null && h !== null) {
    return {
      item: { ...common, kind: 'image', uri, width: w, height: h, ...(placeholder === null ? {} : { placeholder }) },
      file,
    };
  }
  if (msgtype === 'm.video' && w !== null && h !== null) {
    const thumb = asString(info['thumbnail_media_id']);
    return {
      item: {
        ...common,
        kind: 'video',
        uri,
        width: w,
        height: h,
        durationMs: duration ?? 0,
        ...(thumb === null ? {} : { thumbnailUri: thumb }),
        ...(placeholder === null ? {} : { placeholder }),
      },
      file,
    };
  }
  if (msgtype === 'm.audio') {
    const waveform = Array.isArray(info['app.envelope.waveform'])
      ? (info['app.envelope.waveform'] as unknown[]).filter((n): n is number => typeof n === 'number')
      : undefined;
    return {
      item: { ...common, kind: 'audio', uri, durationMs: duration ?? 0, ...(waveform === undefined ? {} : { waveform }) },
      file,
    };
  }
  // Everything else is a file. A visual item missing its dimensions lands here
  // too, which is right: without w/h the layout solver cannot place it, and a
  // guessed aspect ratio is worse than a row.
  return {
    item: { ...common, kind: 'file', uri, filename: asString(info['app.envelope.filename']) ?? `attachment-${index + 1}` },
    file,
  };
}

/**
 * How many items the wire claimed, versus how many survived decoding.
 *
 * The gap is what the UI has to disclose. Silently rendering eight of ten reads
 * as a complete message.
 */
export function itemLossOf(wire: WireEvent): { claimed: number; decoded: number } | null {
  if (wire.revoked) return null;
  const raw = wire.content['app.envelope.items'];
  if (!Array.isArray(raw)) return null;
  const decoded = unpackMedia(wire);
  return { claimed: raw.length, decoded: decoded.ok ? decoded.value.message.items.length : 0 };
}
