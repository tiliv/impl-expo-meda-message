/**
 * Control panel.
 *
 * Same constraint as the rest of this set: every room control sends a state
 * event, never a settings object. The CLIENT tab is the exception and is
 * meant to be — capabilities are a property of the build, not of the room, and
 * keeping them visibly separate is the point of the capability-gap scenarios.
 */

import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { stateEvent } from '../core/roomState';
import {
  describeSource,
  STATE_MEDIA,
  STATE_SINGLE_VIEW,
  type AutoplayPolicy,
  type DestroyTrigger,
  type GridStyle,
  type Resolved,
} from '../core/settings';
import type { CapabilityGapBehavior } from '../core/capabilities';
import type { MediaItem } from '../core/types';
import { theme } from '../ui/theme';
import { SCENARIOS } from './scenarios';
import { useExperiment } from './ExperimentContext';

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, source, children }: { label: string; source?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowControls}>{children}</View>
      {source && <Text style={styles.provenance}>← {source}</Text>}
    </View>
  );
}

const src = <T,>(r: Resolved<T>) => describeSource(r.source);

export function ControlPanel() {
  const { world, settings, warnings, scenario, setScenario, capabilities } = useExperiment();
  const [tab, setTab] = useState<'scenario' | 'room' | 'client'>('scenario');

  const sendMedia = (patch: Record<string, unknown>) => {
    const current = world.stateStore.get(STATE_MEDIA)?.content ?? {};
    world.stateStore.send(stateEvent(STATE_MEDIA, { ...current, ...patch }));
  };
  const sendSingleView = (patch: Record<string, unknown>) => {
    const current = world.stateStore.get(STATE_SINGLE_VIEW)?.content ?? {};
    world.stateStore.send(stateEvent(STATE_SINGLE_VIEW, { ...current, ...patch }));
  };

  /**
   * Real device media, through the same solver as the synthetic fixtures.
   * Worth doing at least once per layout change: real photo libraries contain
   * aspect ratios no fixture author thinks to write down.
   */
  const addFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Library access needed', 'Grant photo access to add real media to the experiment.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.8,
    });
    if (result.canceled) return;

    const target = world.messages()[0];
    if (!target) return;

    const items: MediaItem[] = result.assets.map((asset, i) => {
      const base = {
        id: `picked-${Date.now()}-${i}`,
        uri: asset.uri,
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      };
      return asset.type === 'video'
        ? {
            ...base,
            kind: 'video' as const,
            mimetype: asset.mimeType ?? 'video/mp4',
            durationMs: asset.duration ?? 0,
          }
        : { ...base, kind: 'image' as const, mimetype: asset.mimeType ?? 'image/jpeg' };
    });

    world.appendItems(target.id, items);
  };

  return (
    <View style={styles.panel}>
      <View style={styles.tabs}>
        {(['scenario', 'room', 'client'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {tab === 'scenario' && (
          <>
            <Text style={styles.question}>{scenario.question}</Text>
            {(['layout', 'single-view', 'config'] as const).map((group) => (
              <View key={group}>
                <Text style={styles.sectionLabel}>{group}</Text>
                <View style={styles.chipWrap}>
                  {SCENARIOS.filter((s) => s.group === group).map((s) => (
                    <Chip key={s.id} label={s.title} active={s.id === scenario.id} onPress={() => setScenario(s)} />
                  ))}
                </View>
              </View>
            ))}
            <Text style={styles.sectionLabel}>Expected</Text>
            {scenario.expect.map((line, i) => (
              <Text key={i} style={styles.expectLine}>
                • {line}
              </Text>
            ))}
            {scenario.tryNext?.map((line, i) => (
              <Text key={i} style={styles.tryLine}>
                → {line}
              </Text>
            ))}
            <View style={{ marginTop: 12 }}>
              <Chip label="+ add real media from library" onPress={addFromLibrary} />
            </View>
          </>
        )}

        {tab === 'room' && (
          <>
            <Text style={styles.hint}>Every control here sends a room state event.</Text>

            <Row label="grid_style" source={src(settings.gridStyle)}>
              {(['grid', 'carousel', 'list'] as GridStyle[]).map((v) => (
                <Chip key={v} label={v} active={settings.gridStyle.value === v} onPress={() => sendMedia({ grid_style: v })} />
              ))}
            </Row>

            <Row label="max_items_rendered" source={src(settings.maxItemsRendered)}>
              {[1, 3, 4, 6, 9, 12].map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  active={settings.maxItemsRendered.value === n}
                  onPress={() => sendMedia({ max_items_rendered: n })}
                />
              ))}
            </Row>

            <Row label="max_inline_height_ratio" source={src(settings.maxInlineHeightRatio)}>
              {[0.6, 0.9, 1.4, 2.2].map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  active={settings.maxInlineHeightRatio.value === n}
                  onPress={() => sendMedia({ max_inline_height_ratio: n })}
                />
              ))}
            </Row>

            <Row label="autoplay_video" source={src(settings.autoplayVideo)}>
              {(['never', 'wifi', 'always'] as AutoplayPolicy[]).map((v) => (
                <Chip
                  key={v}
                  label={v}
                  active={settings.autoplayVideo.value === v}
                  onPress={() => sendMedia({ autoplay_video: v })}
                />
              ))}
            </Row>

            <Row label="show_captions / show_item_notes">
              <Chip
                label={`captions ${settings.showCaptions.value ? 'on' : 'off'}`}
                active={settings.showCaptions.value}
                onPress={() => sendMedia({ show_captions: !settings.showCaptions.value })}
              />
              <Chip
                label={`notes ${settings.showItemNotes.value ? 'on' : 'off'}`}
                active={settings.showItemNotes.value}
                onPress={() => sendMedia({ show_item_notes: !settings.showItemNotes.value })}
              />
            </Row>

            <Text style={styles.sectionLabel}>app.envelope.single_view</Text>

            <Row label="enabled" source={src(settings.singleViewEnabled)}>
              {[true, false].map((v) => (
                <Chip
                  key={String(v)}
                  label={v ? 'on' : 'off'}
                  active={settings.singleViewEnabled.value === v}
                  onPress={() => sendSingleView({ enabled: v })}
                />
              ))}
            </Row>

            <Row label="destroy_on" source={src(settings.destroyOn)}>
              {(['item_exit', 'session_complete', 'session_start'] as DestroyTrigger[]).map((v) => (
                <Chip
                  key={v}
                  label={v.replace('_', ' ')}
                  active={settings.destroyOn.value === v}
                  onPress={() => sendSingleView({ destroy_on: v })}
                />
              ))}
            </Row>

            <Row label="allow_back / destroy_on_background">
              <Chip
                label={`back ${settings.allowBack.value ? 'on' : 'off'}`}
                active={settings.allowBack.value}
                onPress={() => sendSingleView({ allow_back: !settings.allowBack.value })}
              />
              <Chip
                label={`bg destroy ${settings.destroyOnBackground.value ? 'on' : 'off'}`}
                active={settings.destroyOnBackground.value}
                onPress={() => sendSingleView({ destroy_on_background: !settings.destroyOnBackground.value })}
              />
            </Row>

            <Row label="capability_gap_behavior" source={src(settings.capabilityGapBehavior)}>
              {(['render_normally', 'render_with_warning', 'withhold'] as CapabilityGapBehavior[]).map((v) => (
                <Chip
                  key={v}
                  label={v.replace(/_/g, ' ')}
                  active={settings.capabilityGapBehavior.value === v}
                  onPress={() => sendSingleView({ capability_gap_behavior: v })}
                />
              ))}
            </Row>

            <Text style={styles.sectionLabel}>Send a bad value</Text>
            <View style={styles.chipWrap}>
              <Chip label="grid_style: mosaic" onPress={() => sendMedia({ grid_style: 'mosaic' })} />
              <Chip label="max_items: -3" onPress={() => sendMedia({ max_items_rendered: -3 })} />
            </View>
          </>
        )}

        {tab === 'client' && (
          <>
            <Text style={styles.hint}>
              Capabilities belong to the build, not the room. The sprint build ships with both off.
            </Text>
            <Row label="singleView capability">
              {[true, false].map((v) => (
                <Chip
                  key={String(v)}
                  label={v ? 'implemented' : 'not in this build'}
                  active={capabilities.singleView === v}
                  onPress={() => world.setCapabilities({ singleView: v })}
                />
              ))}
            </Row>
            <Row label="itemNotes capability">
              {[true, false].map((v) => (
                <Chip
                  key={String(v)}
                  label={v ? 'implemented' : 'not in this build'}
                  active={capabilities.itemNotes === v}
                  onPress={() => world.setCapabilities({ itemNotes: v })}
                />
              ))}
            </Row>
            <Row label="walk state">
              <Chip
                label="↺ reset walks"
                onPress={() => world.messages().forEach((m) => world.resetWalk(m.id))}
              />
            </Row>
          </>
        )}

        {warnings.length > 0 && (
          <View style={styles.warnings}>
            <Text style={styles.warningTitle}>Resolver warnings</Text>
            {warnings.map((w, i) => (
              <Text key={i} style={[styles.warningLine, w.severity === 'danger' && styles.warningDanger]}>
                {w.setting}: {w.message}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border, maxHeight: '50%' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.accent },
  tabText: { color: theme.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tabTextActive: { color: theme.accent },
  body: { flexGrow: 0 },
  bodyContent: { padding: 12, paddingBottom: 24 },
  question: { color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 10, lineHeight: 19 },
  hint: { color: theme.textDim, fontSize: 11, marginBottom: 10, lineHeight: 15, fontStyle: 'italic' },
  sectionLabel: {
    color: theme.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 5,
  },
  expectLine: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginBottom: 3 },
  tryLine: { color: theme.accent, fontSize: 12, lineHeight: 17, marginTop: 3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { backgroundColor: theme.accentDim, borderColor: theme.accent },
  chipPressed: { opacity: 0.6 },
  chipText: { color: theme.textDim, fontSize: 11 },
  chipTextActive: { color: theme.text, fontWeight: '700' },
  row: { marginBottom: 10 },
  rowLabel: { color: theme.text, fontSize: 11, fontWeight: '600', marginBottom: 5 },
  rowControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  provenance: { color: theme.textFaint, fontSize: 10, marginTop: 4, fontStyle: 'italic' },
  warnings: {
    marginTop: 12,
    padding: 9,
    borderRadius: theme.radiusSm,
    backgroundColor: '#2a1a1d',
    borderWidth: 1,
    borderColor: '#4a2b30',
  },
  warningTitle: { color: theme.danger, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  warningLine: { color: '#e0a0a6', fontSize: 11, lineHeight: 15 },
  warningDanger: { color: theme.danger, fontWeight: '700' },
});
