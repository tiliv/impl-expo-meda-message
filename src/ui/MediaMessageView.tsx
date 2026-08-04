/**
 * A whole media message.
 *
 * The layout is solved once, from a width this component is told, and then
 * drawn. No onLayout round-trip, no measure-then-correct — that is what
 * produces the reflow jitter you see when a media message scrolls into view.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { planMediaLayout, type VisualLayout } from '../core/layout';
import type { MediaSettings } from '../core/settings';
import type { CapabilityGapBehavior } from '../core/capabilities';
import { destroyedCount, renderableNow, type WalkState } from '../core/singleView';
import type { MediaMessage } from '../core/types';
import { MediaTile } from './MediaTile';
import { NonVisualRow } from './NonVisualRow';
import { theme } from './theme';

const GAP = 3;

interface Props {
  message: MediaMessage;
  settings: MediaSettings;
  width: number;
  walk: WalkState;
  /** True when the room asked for single view and this build cannot do it. */
  capabilityGap: boolean;
  onOpenSingleView(): void;
}

export function MediaMessageView({
  message,
  settings,
  width,
  walk,
  capabilityGap,
  onOpenSingleView,
}: Props) {
  const gapBehavior: CapabilityGapBehavior = settings.capabilityGapBehavior.value;

  if (capabilityGap && gapBehavior === 'withhold') {
    return (
      <View style={styles.withheld}>
        <Text style={styles.withheldTitle}>Message not shown</Text>
        <Text style={styles.withheldBody}>
          This room requires single-view media. This build cannot honour that, so it refuses to
          render rather than show you something the sender believes will self-destruct.
        </Text>
      </View>
    );
  }

  const singleViewActive = settings.singleViewEnabled.value;
  const destroyed = destroyedCount(walk);
  const allGone = walk.envelopeDestroyed && walk.status !== 'walking';

  if (allGone) {
    return (
      <View style={styles.spent}>
        <Text style={styles.spentGlyph}>◌</Text>
        <Text style={styles.spentText}>
          {message.items.length} item{message.items.length === 1 ? '' : 's'} · viewed once, destroyed
        </Text>
      </View>
    );
  }

  // A single-view message is a sealed envelope until you open it. Showing the
  // grid first would be the whole guarantee leaking through the preview.
  if (singleViewActive && walk.status === 'idle') {
    return (
      <Pressable style={styles.sealed} onPress={onOpenSingleView}>
        <Text style={styles.sealedGlyph}>◼</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.sealedTitle}>Single view · {message.items.length} items</Text>
          <Text style={styles.sealedBody}>
            Tap to open. Items are destroyed on {settings.destroyOn.value.replace('_', ' ')}.
          </Text>
        </View>
      </Pressable>
    );
  }

  const visible = message.items.filter((i) => renderableNow(walk, i.id));
  const plan = planMediaLayout(visible, { containerWidth: width, gap: GAP }, settings);
  const showNotes = settings.showItemNotes.value;

  return (
    <View style={{ width }}>
      {capabilityGap && gapBehavior === 'render_with_warning' && (
        <View style={styles.gapBanner}>
          <Text style={styles.gapText}>
            Sender expects these to self-destruct. This build does not implement single view.
          </Text>
        </View>
      )}

      <Visual layout={plan.visual} showNotes={showNotes} />

      {plan.nonVisual.map((item) => (
        <NonVisualRow key={item.id} item={item} showNote={showNotes} />
      ))}

      {settings.showCaptions.value && message.caption && (
        <Text style={styles.caption}>{message.caption}</Text>
      )}

      {destroyed > 0 && !walk.envelopeDestroyed && (
        <Text style={styles.destroyedNote}>
          {destroyed} of {message.items.length} destroyed
        </Text>
      )}
    </View>
  );
}

function Visual({ layout, showNotes }: { layout: VisualLayout; showNotes: boolean }) {
  switch (layout.style) {
    case 'none':
      return null;
    case 'hero':
      return <MediaTile tile={layout.tile} showNote={showNotes} radius={10} />;
    case 'carousel':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: layout.height }}>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {layout.tiles.map((tile) => (
              <MediaTile key={tile.item.id} tile={tile} showNote={showNotes} radius={8} />
            ))}
          </View>
        </ScrollView>
      );
    case 'rows':
      return (
        <View style={{ gap: GAP }}>
          {layout.rows.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: GAP }}>
              {row.tiles.map((tile) => (
                <MediaTile key={tile.item.id} tile={tile} showNote={showNotes} />
              ))}
            </View>
          ))}
        </View>
      );
    default: {
      const exhaustive: never = layout;
      return exhaustive;
    }
  }
}

const styles = StyleSheet.create({
  caption: { color: theme.text, fontSize: 14, lineHeight: 19, marginTop: 7 },
  destroyedNote: { color: theme.danger, fontSize: 11, marginTop: 5 },
  sealed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.warn,
    backgroundColor: '#2a2318',
  },
  sealedGlyph: { color: theme.warn, fontSize: 22 },
  sealedTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  sealedBody: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  spent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.border,
  },
  spentGlyph: { color: theme.textFaint, fontSize: 20 },
  spentText: { color: theme.textFaint, fontSize: 13, fontStyle: 'italic' },
  withheld: {
    padding: 14,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.danger,
    backgroundColor: '#2a1a1d',
  },
  withheldTitle: { color: theme.danger, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  withheldBody: { color: '#e0a0a6', fontSize: 12, lineHeight: 17 },
  gapBanner: {
    padding: 9,
    borderRadius: 8,
    backgroundColor: '#2a1a1d',
    borderWidth: 1,
    borderColor: '#4a2b30',
    marginBottom: 6,
  },
  gapText: { color: '#e0a0a6', fontSize: 11, lineHeight: 15 },
});
