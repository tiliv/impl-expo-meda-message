/**
 * The single-view walk, on screen.
 *
 * Deliberately unglamorous: the interesting half of this screen is the audit
 * log down the bottom, which shows destruction happening entry by entry as you
 * advance. That is the thing worth having before anyone builds the real
 * version — you can argue about a policy you can watch.
 *
 * The AppState listener is not decoration. Backgrounding the app during a
 * single-view session is the most likely way a real user loses items they had
 * not looked at, and it should be as easy to trigger here as it is in life.
 */

import React, { useEffect } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from 'expo-image';

import { backAllowed, type MediaSettings } from '../core/settings';
import { renderableNow, type WalkAction, type WalkState } from '../core/singleView';
import { formatDurationShort, type MediaItem, type MediaMessage } from '../core/types';
import { isSynthetic, syntheticHue } from '../experiment/world';
import { theme } from './theme';

interface Props {
  visible: boolean;
  message: MediaMessage;
  walk: WalkState;
  settings: MediaSettings;
  now: number;
  dispatch(action: WalkAction): void;
  onClose(): void;
}

export function SingleViewViewer({ visible, message, walk, settings, now, dispatch, onClose }: Props) {
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') dispatch({ type: 'background', at: Date.now() });
    });
    return () => sub.remove();
  }, [visible, dispatch]);

  const item = message.items[walk.index];
  const canGoBack = walk.index > 0 && backAllowed(settings);
  const isLast = walk.index >= message.items.length - 1;
  const finished = walk.status === 'complete' || walk.status === 'aborted';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.progress}>
            {Math.min(walk.index + 1, message.items.length)} / {message.items.length}
          </Text>
          <View style={styles.pips}>
            {message.items.map((i, index) => (
              <View
                key={i.id}
                style={[
                  styles.pip,
                  walk.states[i.id] === 'destroyed' && styles.pipDestroyed,
                  index === walk.index && styles.pipCurrent,
                ]}
              />
            ))}
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.stage}>
          {finished ? (
            <Text style={styles.finished}>
              {walk.status === 'complete' ? 'Walk complete.' : 'Session ended early.'}
            </Text>
          ) : item ? (
            <ItemStage item={item} width={width} renderable={renderableNow(walk, item.id)} />
          ) : null}
        </View>

        {!finished && (
          <View style={styles.controls}>
            <Pressable
              onPress={() => dispatch({ type: 'back', at: now })}
              style={[styles.control, !canGoBack && styles.controlDisabled]}
            >
              <Text style={styles.controlText}>{canGoBack ? '← Back' : '← Back (blocked)'}</Text>
            </Pressable>
            <Pressable
              onPress={() => dispatch({ type: 'next', at: now })}
              style={[styles.control, styles.controlPrimary]}
            >
              <Text style={styles.controlText}>{isLast ? 'Finish' : 'Next →'}</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.logPanel}>
          <Text style={styles.logTitle}>WALK LOG</Text>
          <ScrollView style={styles.log}>
            {walk.log.map((event, i) => (
              <View key={i} style={styles.logRow}>
                <Text style={[styles.logKind, kindStyle(event.kind)]}>{event.kind}</Text>
                <Text style={styles.logReason}>
                  {event.itemId ? `${event.itemId} · ` : ''}
                  {event.reason}
                </Text>
              </View>
            ))}
            {walk.log.length === 0 && <Text style={styles.logEmpty}>Nothing yet.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function kindStyle(kind: string) {
  if (kind.startsWith('destroy')) return styles.logDestroy;
  if (kind === 'blocked') return styles.logBlocked;
  if (kind.startsWith('session')) return styles.logSession;
  return styles.logNeutral;
}

function ItemStage({ item, width, renderable }: { item: MediaItem; width: number; renderable: boolean }) {
  if (!renderable) {
    return <Text style={styles.finished}>This item has been destroyed.</Text>;
  }

  if (item.kind === 'video' && !isSynthetic(item.uri)) {
    return <VideoStage uri={item.uri} width={width} />;
  }

  if (item.kind === 'image' && !isSynthetic(item.uri)) {
    return <Image source={{ uri: item.uri }} style={styles.media} contentFit="contain" />;
  }

  if (item.kind === 'audio' || item.kind === 'file') {
    return (
      <View style={styles.nonVisualStage}>
        <Text style={styles.nonVisualGlyph}>{item.kind === 'audio' ? '♪' : '▤'}</Text>
        <Text style={styles.nonVisualLabel}>
          {item.kind === 'audio' ? formatDurationShort(item.durationMs) : item.filename}
        </Text>
      </View>
    );
  }

  const hue = syntheticHue(item.uri);
  return (
    <View style={[styles.media, { backgroundColor: `hsl(${hue}, 42%, 34%)` }]}>
      <View style={[styles.syntheticDot, { backgroundColor: `hsl(${(hue + 60) % 360}, 55%, 62%)` }]} />
      {item.kind === 'video' && (
        <Text style={styles.syntheticLabel}>{formatDurationShort(item.durationMs)}</Text>
      )}
    </View>
  );
}

/**
 * Its own component so `useVideoPlayer` is called unconditionally. Hooks
 * cannot sit behind the item-kind branch above.
 */
function VideoStage({ uri, width }: { uri: string; width: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView player={player} style={[styles.media, { width }]} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  progress: { color: theme.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  pips: { flex: 1, flexDirection: 'row', gap: 4 },
  pip: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#ffffff33' },
  pipCurrent: { backgroundColor: theme.accent },
  pipDestroyed: { backgroundColor: theme.danger },
  close: { color: theme.text, fontSize: 20 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  syntheticDot: { width: 120, height: 120, borderRadius: 60, opacity: 0.8 },
  syntheticLabel: { color: '#fff', marginTop: 14, fontSize: 13 },
  nonVisualStage: { alignItems: 'center', gap: 12 },
  nonVisualGlyph: { color: theme.textDim, fontSize: 56 },
  nonVisualLabel: { color: theme.text, fontSize: 15 },
  finished: { color: theme.textDim, fontSize: 15, fontStyle: 'italic' },
  controls: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  control: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: theme.surfaceAlt,
  },
  controlPrimary: { backgroundColor: theme.accentDim },
  controlDisabled: { opacity: 0.4 },
  controlText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  logPanel: {
    maxHeight: 190,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 18,
  },
  logTitle: { color: theme.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  log: { flexGrow: 0 },
  logRow: { flexDirection: 'row', gap: 8, marginBottom: 3 },
  logKind: { fontSize: 10, fontWeight: '700', width: 106 },
  logReason: { color: theme.textDim, fontSize: 10, flex: 1, lineHeight: 14 },
  logDestroy: { color: theme.danger },
  logBlocked: { color: theme.warn },
  logSession: { color: theme.accent },
  logNeutral: { color: theme.textFaint },
  logEmpty: { color: theme.textFaint, fontSize: 11, fontStyle: 'italic' },
});
