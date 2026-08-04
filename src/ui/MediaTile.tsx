/**
 * One tile in the grid.
 *
 * Two sources are supported deliberately: `synthetic://` items paint
 * themselves, so scenarios render offline and identically every run, and real
 * file/remote URIs go through expo-image. Both take the same size from the
 * solver — the tile never measures anything itself.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import type { Tile } from '../core/layout';
import { formatDurationShort } from '../core/types';
import { isSynthetic, syntheticHue } from '../experiment/world';
import { theme } from './theme';

export function MediaTile({
  tile,
  showNote,
  dimmed,
  radius = 4,
}: {
  tile: Tile;
  showNote?: boolean;
  dimmed?: boolean;
  radius?: number;
}) {
  const { item, width, height, overflowCount } = tile;
  const uri = item.kind === 'video' ? (item.thumbnailUri ?? item.uri) : item.uri;

  return (
    <View style={[styles.tile, { width, height, borderRadius: radius }, dimmed && styles.dimmed]}>
      {isSynthetic(uri) ? (
        <SyntheticFill hue={syntheticHue(uri)} width={width} height={height} />
      ) : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      )}

      {item.kind === 'video' && (
        <View style={styles.videoBadge}>
          <Text style={styles.badgeGlyph}>▶</Text>
          <Text style={styles.badgeText}>{formatDurationShort(item.durationMs)}</Text>
        </View>
      )}

      {showNote && item.note && (
        <View style={styles.noteStrip}>
          <Text style={styles.noteText} numberOfLines={2}>
            {item.note}
          </Text>
        </View>
      )}

      {overflowCount !== undefined && overflowCount > 0 && (
        <View style={styles.overflow}>
          <Text style={styles.overflowText}>+{overflowCount}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Deterministic stand-in art. Two bands plus a diagonal so orientation and
 * cropping are visible at a glance — a flat colour makes it impossible to tell
 * whether the solver cropped or stretched.
 */
function SyntheticFill({ hue, width, height }: { hue: number; width: number; height: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: `hsl(${hue}, 42%, 34%)` }]}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: height * 0.55,
          width,
          height: height * 0.45,
          backgroundColor: `hsl(${(hue + 25) % 360}, 40%, 26%)`,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: width * 0.12,
          top: height * 0.12,
          width: Math.min(width, height) * 0.36,
          height: Math.min(width, height) * 0.36,
          borderRadius: 999,
          backgroundColor: `hsl(${(hue + 60) % 360}, 55%, 62%)`,
          opacity: 0.75,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', backgroundColor: theme.surfaceAlt },
  dimmed: { opacity: 0.35 },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#000000aa',
  },
  badgeGlyph: { color: '#fff', fontSize: 9 },
  badgeText: { color: '#fff', fontSize: 11, fontVariant: ['tabular-nums'] },
  overflow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#000000a8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  noteStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#000000aa',
  },
  noteText: { color: theme.warn, fontSize: 10, lineHeight: 13 },
});
