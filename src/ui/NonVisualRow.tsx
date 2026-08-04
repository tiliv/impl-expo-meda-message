/**
 * Audio clips and files.
 *
 * These live below the grid, never inside it. An audio clip's useful shape is
 * a timeline, not a rectangle, so it gets a waveform; a file's useful
 * information is its name and size, so it gets those. Both are full width,
 * which is also what stops a message of six PDFs from looking like a photo
 * album.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatBytes, formatDurationShort, type MediaItem } from '../core/types';
import { theme } from './theme';

export function NonVisualRow({ item, showNote }: { item: MediaItem; showNote?: boolean }) {
  return (
    <View style={styles.row}>
      {item.kind === 'audio' ? <AudioRow item={item} /> : <FileRow item={item} />}
      {showNote && item.note && <Text style={styles.note}>{item.note}</Text>}
    </View>
  );
}

function AudioRow({ item }: { item: Extract<MediaItem, { kind: 'audio' }> }) {
  const bars = item.waveform ?? [];
  return (
    <View style={styles.inner}>
      <View style={styles.playButton}>
        <Text style={styles.playGlyph}>▶</Text>
      </View>
      <View style={styles.waveform}>
        {bars.length > 0 ? (
          bars.map((v, i) => (
            <View key={i} style={[styles.bar, { height: Math.max(2, Math.round(v * 22)) }]} />
          ))
        ) : (
          <View style={styles.flatline} />
        )}
      </View>
      <Text style={styles.duration}>{formatDurationShort(item.durationMs)}</Text>
    </View>
  );
}

function FileRow({ item }: { item: MediaItem }) {
  const name = item.kind === 'file' ? item.filename : item.mimetype;
  const extension = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '?';
  return (
    <View style={styles.inner}>
      <View style={styles.fileIcon}>
        <Text style={styles.fileExt}>{extension.slice(0, 4)}</Text>
      </View>
      <View style={styles.fileMeta}>
        <Text style={styles.fileName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.fileSize}>{item.size ? formatBytes(item.size) : item.mimetype}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 4 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  playButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: theme.text, fontSize: 12, marginLeft: 2 },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  bar: { flex: 1, backgroundColor: theme.accent, borderRadius: 1, opacity: 0.75 },
  flatline: { flex: 1, height: 2, backgroundColor: theme.border },
  duration: { color: theme.textDim, fontSize: 11, fontVariant: ['tabular-nums'] },
  fileIcon: {
    width: 32,
    height: 38,
    borderRadius: 4,
    backgroundColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileExt: { color: theme.textDim, fontSize: 9, fontWeight: '700' },
  fileMeta: { flex: 1 },
  fileName: { color: theme.text, fontSize: 13, fontWeight: '600' },
  fileSize: { color: theme.textFaint, fontSize: 11, marginTop: 1 },
  note: { color: theme.warn, fontSize: 10, marginTop: 3, marginLeft: 4 },
});
