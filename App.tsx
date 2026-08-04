import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ControlPanel } from './src/experiment/ControlPanel';
import { ExperimentProvider, useExperiment } from './src/experiment/ExperimentContext';
import { MediaMessageView } from './src/ui/MediaMessageView';
import { SingleViewViewer } from './src/ui/SingleViewViewer';
import { theme } from './src/ui/theme';
import type { WalkAction } from './src/core/singleView';

/** Bubble padding + row inset. The solver is told a width; it never measures. */
const MESSAGE_INSET = 24 + 20;

function Room() {
  const { world, settings, capabilities } = useExperiment();
  const { width } = useWindowDimensions();
  const [openId, setOpenId] = useState<string | null>(null);

  const messages = world.messages();
  const contentWidth = Math.min(width - MESSAGE_INSET, 520);

  const capabilityGap =
    settings.singleViewEnabled.source.kind === 'capability_override' ||
    (!capabilities.singleView && messages.some((m) => m.singleView?.requested));

  const dispatchFor = useCallback(
    (id: string) => (action: WalkAction) => world.dispatchWalk(id, action),
    [world],
  );

  const openMessage = messages.find((m) => m.id === openId);

  return (
    <>
      <ScrollView style={styles.room} contentContainerStyle={styles.roomContent}>
        {messages.map((message) => (
          <View key={message.id} style={styles.bubble}>
            <Text style={styles.sender}>{message.sender.replace(/^@/, '').split(':')[0]}</Text>
            <MediaMessageView
              message={message}
              settings={settings}
              width={contentWidth}
              walk={world.walk(message.id)}
              capabilityGap={capabilityGap}
              onOpenSingleView={() => {
                world.dispatchWalk(message.id, { type: 'open', at: Date.now() });
                setOpenId(message.id);
              }}
            />
          </View>
        ))}
        {messages.length === 0 && <Text style={styles.empty}>No messages in this arrangement.</Text>}
      </ScrollView>

      {openMessage && (
        <SingleViewViewer
          visible
          message={openMessage}
          walk={world.walk(openMessage.id)}
          settings={settings}
          now={Date.now()}
          dispatch={dispatchFor(openMessage.id)}
          onClose={() => {
            world.dispatchWalk(openMessage.id, { type: 'close', at: Date.now() });
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function Screen() {
  const insets = useSafeAreaInsets();
  const { scenario } = useExperiment();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{scenario.title}</Text>
        <Text style={styles.subtitle}>{scenario.group}</Text>
      </View>
      <Room />
      <View style={{ paddingBottom: insets.bottom }}>
        <ControlPanel />
      </View>
      <StatusBar style="light" />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ExperimentProvider>
        <Screen />
      </ExperimentProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  title: { color: theme.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: theme.textFaint, fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  room: { flex: 1 },
  roomContent: { padding: 10, gap: 10 },
  bubble: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 10,
  },
  sender: { color: theme.accent, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  empty: { color: theme.textFaint, textAlign: 'center', marginTop: 40, fontSize: 13 },
});
