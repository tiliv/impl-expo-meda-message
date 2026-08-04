/**
 * The wire boundary, and the ceiling it puts on this feature.
 *
 * The revocation cap is the reason this file exists. Everything else here is
 * round-tripping; the `MAX_ATOMIC_ITEMS` block is a product constraint discovered
 * by reading the spec.
 */

import { isFullyRevocable, revocationPlan, type EncryptedFileRef, type WireEvent } from '../envelope';
import { itemLossOf, MAX_ATOMIC_ITEMS, packMedia, unpackMedia, type PackableItem } from '../packing';
import type { MediaItem } from '../types';

const file = (mediaId: string): EncryptedFileRef => ({
  mediaId,
  key: { alg: 'A256CTR', ext: true, k: 'k'.repeat(43), key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
  iv: 'aXY=',
  hashes: { sha256: 'c2hh' },
  v: 'v2',
  mimetype: 'image/jpeg',
  sizeBytes: 4096,
});

const image = (id: string): PackableItem => ({
  item: { id, kind: 'image', uri: `x://${id}`, mimetype: 'image/jpeg', width: 1290, height: 2796 },
  file: file(id),
});
const video = (id: string): PackableItem => ({
  item: { id, kind: 'video', uri: `x://${id}`, mimetype: 'video/mp4', width: 1920, height: 1080, durationMs: 14_000 },
  file: { ...file(id), mimetype: 'video/mp4' },
});
const audio = (id: string): PackableItem => ({
  item: { id, kind: 'audio', uri: `x://${id}`, mimetype: 'audio/m4a', durationMs: 3200, waveform: [0.2, 0.9, 0.4] },
  file: { ...file(id), mimetype: 'audio/m4a' },
});
const doc = (id: string): PackableItem => ({
  item: { id, kind: 'file', uri: `x://${id}`, mimetype: 'application/pdf', filename: 'rider.pdf', size: 88_000 },
  file: { ...file(id), mimetype: 'application/pdf' },
});

const wireOf = (content: Record<string, unknown>, over: Partial<WireEvent> = {}): WireEvent => ({
  eventId: '$evt-1',
  txnId: 'n-1',
  senderUserId: '@alice:noodles',
  eventType: 'm.room.message',
  content,
  createdAt: '2026-08-04T12:00:00.000Z',
  revoked: false,
  ...over,
});

describe('one event, several items', () => {
  it('packs a mixed set into a single m.room.message', () => {
    // One event, not N. N events can partially fail, be partially revoked, and
    // arrive interleaved with someone else's message.
    const out = packMedia({ items: [image('m_1'), video('m_2'), audio('m_3'), doc('m_4')], seed: 1 });

    expect(out.eventType).toBe('m.room.message');
    expect(out.content['msgtype']).toBe('app.envelope.multi');
    expect(out.content['app.envelope.items']).toHaveLength(4);
  });

  it('gives each item the msgtype it would have had as its own event', () => {
    const out = packMedia({ items: [image('m_1'), video('m_2'), audio('m_3'), doc('m_4')], seed: 2 });
    const items = out.content['app.envelope.items'] as Record<string, unknown>[];
    expect(items.map((i) => i['msgtype'])).toEqual(['m.image', 'm.video', 'm.audio', 'm.file']);
  });

  it('describes the set in the fallback body without naming files', () => {
    // The fallback is all an unaware client shows. Filenames there would leak
    // content the envelope's retention is supposed to govern.
    const out = packMedia({ items: [image('m_1'), doc('m_2')], seed: 3 });
    expect(out.content['body']).toBe('2 attachments');
    expect(JSON.stringify(out.content['body'])).not.toContain('rider.pdf');
  });

  it('prefers the caption as the fallback body when there is one', () => {
    const out = packMedia({ items: [image('m_1')], caption: '  from the roof  ', seed: 4 });
    expect(out.content['body']).toBe('from the roof');
    expect(out.content['app.envelope.caption']).toBe('from the roof');
  });
});

describe('the revocation ceiling', () => {
  it('is fully revocable at exactly ten', () => {
    const items = Array.from({ length: MAX_ATOMIC_ITEMS }, (_, i) => image(`m_${i}`));
    const out = packMedia({ items, seed: 5 });

    expect(MAX_ATOMIC_ITEMS).toBe(10);
    expect(out.overflow).toEqual([]);
    expect(isFullyRevocable(out)).toBe(true);
  });

  it('reports the eleventh item as unrevocable rather than dropping it', () => {
    // This is the finding. Past ten, unsending the message leaves the extra
    // files downloadable, and nothing outside the OpenAPI spec says so.
    const items = Array.from({ length: 12 }, (_, i) => image(`m_${i}`));
    const out = packMedia({ items, seed: 6 });

    expect(out.overflow).toEqual(['m_10', 'm_11']);
    expect(isFullyRevocable(out)).toBe(false);
    // All twelve still ship — the envelope is honest about what it contains.
    expect(out.content['app.envelope.items']).toHaveLength(12);
    expect(out.mediaIds).toHaveLength(12);
  });

  it('sends only ten ids to the revoke endpoint', () => {
    const items = Array.from({ length: 12 }, (_, i) => image(`m_${i}`));
    const plan = revocationPlan(packMedia({ items, seed: 7 }));

    expect(plan.mediaIds).toHaveLength(10);
    expect(plan.unrevocable).toEqual(['m_10', 'm_11']);
  });
});

describe('single view', () => {
  it('sets viewOnce on every file, not just on the envelope', () => {
    // Two mechanisms, both needed. The envelope flag drives the client walk; the
    // per-file flag makes the *server* 410 a second download. Requesting only the
    // first gives you a "single-view" image a reinstall can fetch again.
    const out = packMedia({ items: [image('m_1'), image('m_2')], singleView: true, seed: 8 });
    const items = out.content['app.envelope.items'] as Record<string, unknown>[];

    expect(out.content['app.envelope.single_view']).toEqual({ requested: true });
    for (const item of items) {
      expect((item['file'] as Record<string, unknown>)['viewOnce']).toBe(true);
    }
  });

  it('leaves viewOnce off when single view was not requested', () => {
    const out = packMedia({ items: [image('m_1')], seed: 9 });
    const items = out.content['app.envelope.items'] as Record<string, unknown>[];
    expect((items[0]!['file'] as Record<string, unknown>)['viewOnce']).toBeUndefined();
    expect('app.envelope.single_view' in out.content).toBe(false);
  });
});

describe('unpacking', () => {
  it('round-trips a mixed set, preserving order', () => {
    const out = packMedia({ items: [image('m_1'), audio('m_2'), doc('m_3')], caption: 'three', seed: 10 });
    const decoded = unpackMedia(wireOf(out.content));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.message.items.map((i: MediaItem) => i.kind)).toEqual(['image', 'audio', 'file']);
    expect(decoded.value.message.caption).toBe('three');
    expect(decoded.value.message.items.map((i) => i.id)).toEqual(['m_1', 'm_2', 'm_3']);
  });

  it('preserves the details each kind needs to render', () => {
    const decoded = unpackMedia(wireOf(packMedia({ items: [video('m_v'), audio('m_a')], seed: 11 }).content));
    if (!decoded.ok) throw new Error('expected ok');

    const [v, a] = decoded.value.message.items;
    expect(v).toMatchObject({ kind: 'video', width: 1920, height: 1080, durationMs: 14_000 });
    expect(a).toMatchObject({ kind: 'audio', durationMs: 3200, waveform: [0.2, 0.9, 0.4] });
  });

  it('keeps key material out of the render model but returns it alongside', () => {
    const decoded = unpackMedia(wireOf(packMedia({ items: [image('m_1')], seed: 12 }).content));
    if (!decoded.ok) throw new Error('expected ok');

    expect(JSON.stringify(decoded.value.message)).not.toContain('A256CTR');
    expect(decoded.value.files[0]!.key.alg).toBe('A256CTR');
    expect(decoded.value.files).toHaveLength(decoded.value.message.items.length);
  });

  it('uses the mediaId as the item id, so ids survive a reinstall', () => {
    // The single-view walk keys off item ids. Locally-generated ones would make
    // "already viewed" forget itself on every fresh install.
    const decoded = unpackMedia(wireOf(packMedia({ items: [image('m_abc')], seed: 13 }).content));
    if (decoded.ok) expect(decoded.value.message.items[0]!.id).toBe('m_abc');
  });

  it('renders the items it can when one is malformed', () => {
    // Nine photos plus a broken tenth should show nine, not nothing.
    const out = packMedia({ items: [image('m_1'), image('m_2')], seed: 14 });
    const items = out.content['app.envelope.items'] as unknown[];
    items.push({ msgtype: 'm.image', info: {} }); // no file, so no mediaId

    const decoded = unpackMedia(wireOf(out.content));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.message.items).toHaveLength(2);

    // And the gap is discoverable, so the UI can disclose it.
    expect(itemLossOf(wireOf(out.content))).toEqual({ claimed: 3, decoded: 2 });
  });

  it('demotes a visual item with no dimensions to a file row', () => {
    // The layout solver cannot place something without an aspect ratio, and a
    // guessed one is worse than a row.
    const out = packMedia({ items: [image('m_1')], seed: 15 });
    const items = out.content['app.envelope.items'] as Record<string, unknown>[];
    items[0]!['info'] = { mimetype: 'image/jpeg' };

    const decoded = unpackMedia(wireOf(out.content));
    if (decoded.ok) expect(decoded.value.message.items[0]!.kind).toBe('file');
  });

  it('refuses a revoked envelope before reading any item', () => {
    const out = packMedia({ items: [image('m_1')], seed: 16 });
    const decoded = unpackMedia(wireOf(out.content, { revoked: true }));

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toBe('revoked');
    expect(itemLossOf(wireOf(out.content, { revoked: true }))).toBeNull();
  });

  it('rejects an envelope with no usable items at all', () => {
    expect(unpackMedia(wireOf({ msgtype: 'app.envelope.multi', 'app.envelope.items': [] })).ok).toBe(false);
    expect(unpackMedia(wireOf({ msgtype: 'app.envelope.multi' })).ok).toBe(false);
    expect(unpackMedia(wireOf({ msgtype: 'm.text', body: 'hi' })).ok).toBe(false);
  });
});
