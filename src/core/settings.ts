/**
 * Room state -> typed media settings.
 *
 * Same shape as the other templates in this set: state events in, typed values
 * with provenance out, bad input clamped or defaulted with a warning rather
 * than thrown. The control panel can only change a setting by sending the
 * state event that carries it.
 *
 * The one addition here is the capability gate. A resolved setting is the
 * intersection of what the room asked for and what this build can do, and when
 * those disagree the resolver says so out loud.
 */

import type { RoomStateStore } from './roomState';
import type { CapabilityGapBehavior, ClientCapabilities } from './capabilities';
import type { UserId } from './types';

export const STATE_MEDIA = 'app.envelope.media';
export const STATE_SINGLE_VIEW = 'app.envelope.single_view';

export type SettingSource =
  | { kind: 'default' }
  | { kind: 'state_event'; type: string; eventId: string; sender: UserId; originTs: number }
  /** The room asked for this, and the build overrode it. */
  | { kind: 'capability_override'; requestedBy: string };

export interface Resolved<T> {
  value: T;
  source: SettingSource;
}

export type GridStyle = 'grid' | 'carousel' | 'list';
export type AutoplayPolicy = 'never' | 'wifi' | 'always';

/** When, during the walk, an item is actually destroyed. */
export type DestroyTrigger =
  /** Destroyed as you leave it. You can never see item 1 again from item 2. */
  | 'item_exit'
  /** Destroyed together when the walk finishes. Back-navigation is possible. */
  | 'session_complete'
  /** The whole envelope dies the moment it is opened, viewed or not. */
  | 'session_start';

export interface MediaSettings {
  maxItemsRendered: Resolved<number>;
  gridStyle: Resolved<GridStyle>;
  /** Cap on visual height, as a multiple of the message's width. */
  maxInlineHeightRatio: Resolved<number>;
  autoplayVideo: Resolved<AutoplayPolicy>;
  showCaptions: Resolved<boolean>;
  /** Per-item notes. Off by default and capability-gated. */
  showItemNotes: Resolved<boolean>;

  singleViewEnabled: Resolved<boolean>;
  destroyOn: Resolved<DestroyTrigger>;
  allowBack: Resolved<boolean>;
  destroyOnBackground: Resolved<boolean>;
  capabilityGapBehavior: Resolved<CapabilityGapBehavior>;
}

export interface SettingsWarning {
  setting: keyof MediaSettings;
  severity: 'info' | 'warn' | 'danger';
  message: string;
}

export interface ResolvedMediaSettings {
  settings: MediaSettings;
  warnings: SettingsWarning[];
}

const DEFAULTS = {
  maxItemsRendered: 6,
  gridStyle: 'grid' as GridStyle,
  maxInlineHeightRatio: 1.4,
  autoplayVideo: 'wifi' as AutoplayPolicy,
  showCaptions: true,
  showItemNotes: false,
  singleViewEnabled: false,
  destroyOn: 'item_exit' as DestroyTrigger,
  allowBack: false,
  destroyOnBackground: true,
  capabilityGapBehavior: 'render_with_warning' as CapabilityGapBehavior,
};

const GRID_STYLES: GridStyle[] = ['grid', 'carousel', 'list'];
const AUTOPLAY: AutoplayPolicy[] = ['never', 'wifi', 'always'];
const TRIGGERS: DestroyTrigger[] = ['item_exit', 'session_complete', 'session_start'];
const GAP_BEHAVIORS: CapabilityGapBehavior[] = ['render_normally', 'render_with_warning', 'withhold'];

export const DEFAULT_SOURCE: SettingSource = { kind: 'default' };

export function resolveMediaSettings(
  store: RoomStateStore,
  capabilities: ClientCapabilities,
): ResolvedMediaSettings {
  const warnings: SettingsWarning[] = [];
  const mediaEvent = store.get(STATE_MEDIA);
  const singleViewEvent = store.get(STATE_SINGLE_VIEW);

  const sourceOf = (e: typeof mediaEvent): SettingSource =>
    e
      ? { kind: 'state_event', type: e.type, eventId: e.eventId, sender: e.sender, originTs: e.originTs }
      : DEFAULT_SOURCE;

  function read<T>(
    setting: keyof MediaSettings,
    event: typeof mediaEvent,
    field: string,
    fallback: T,
    validate: (raw: unknown) => T | null,
  ): Resolved<T> {
    if (!event || !(field in event.content)) return { value: fallback, source: DEFAULT_SOURCE };
    const raw = event.content[field];
    if (raw === null || raw === undefined) return { value: fallback, source: DEFAULT_SOURCE };
    const ok = validate(raw);
    if (ok === null) {
      warnings.push({
        setting,
        severity: 'warn',
        message: `${event.type}.${field} = ${JSON.stringify(raw)} is not usable; using default`,
      });
      return { value: fallback, source: DEFAULT_SOURCE };
    }
    return { value: ok, source: sourceOf(event) };
  }

  const int = (min: number, max: number) => (raw: unknown): number | null =>
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(max, Math.max(min, Math.round(raw)))
      : null;

  const num = (min: number, max: number) => (raw: unknown): number | null =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : null;

  const bool = (raw: unknown): boolean | null => (typeof raw === 'boolean' ? raw : null);

  const oneOf = <T extends string>(allowed: T[]) => (raw: unknown): T | null =>
    allowed.includes(raw as T) ? (raw as T) : null;

  // --- capability-gated settings -----------------------------------------

  const requestedSingleView = read(
    'singleViewEnabled',
    singleViewEvent,
    'enabled',
    DEFAULTS.singleViewEnabled,
    bool,
  );

  let singleViewEnabled = requestedSingleView;
  if (requestedSingleView.value && !capabilities.singleView) {
    singleViewEnabled = {
      value: false,
      source: { kind: 'capability_override', requestedBy: singleViewEvent?.sender ?? 'room' },
    };
    warnings.push({
      setting: 'singleViewEnabled',
      severity: 'danger',
      message:
        'Room requires single-view, this build does not implement it. ' +
        'Senders will believe these items self-destruct. They will not.',
    });
  }

  const requestedNotes = read('showItemNotes', mediaEvent, 'show_item_notes', DEFAULTS.showItemNotes, bool);
  let showItemNotes = requestedNotes;
  if (requestedNotes.value && !capabilities.itemNotes) {
    showItemNotes = {
      value: false,
      source: { kind: 'capability_override', requestedBy: mediaEvent?.sender ?? 'room' },
    };
    warnings.push({
      setting: 'showItemNotes',
      severity: 'info',
      message: 'Room asked for per-item notes; this build does not render them yet.',
    });
  }

  return {
    settings: {
      maxItemsRendered: read('maxItemsRendered', mediaEvent, 'max_items_rendered', DEFAULTS.maxItemsRendered, int(1, 24)),
      gridStyle: read('gridStyle', mediaEvent, 'grid_style', DEFAULTS.gridStyle, oneOf(GRID_STYLES)),
      maxInlineHeightRatio: read(
        'maxInlineHeightRatio',
        mediaEvent,
        'max_inline_height_ratio',
        DEFAULTS.maxInlineHeightRatio,
        num(0.4, 3),
      ),
      autoplayVideo: read('autoplayVideo', mediaEvent, 'autoplay_video', DEFAULTS.autoplayVideo, oneOf(AUTOPLAY)),
      showCaptions: read('showCaptions', mediaEvent, 'show_captions', DEFAULTS.showCaptions, bool),
      showItemNotes,
      singleViewEnabled,
      destroyOn: read('destroyOn', singleViewEvent, 'destroy_on', DEFAULTS.destroyOn, oneOf(TRIGGERS)),
      allowBack: read('allowBack', singleViewEvent, 'allow_back', DEFAULTS.allowBack, bool),
      destroyOnBackground: read(
        'destroyOnBackground',
        singleViewEvent,
        'destroy_on_background',
        DEFAULTS.destroyOnBackground,
        bool,
      ),
      capabilityGapBehavior: read(
        'capabilityGapBehavior',
        singleViewEvent,
        'capability_gap_behavior',
        DEFAULTS.capabilityGapBehavior,
        oneOf(GAP_BEHAVIORS),
      ),
    },
    warnings,
  };
}

export function describeSource(source: SettingSource): string {
  switch (source.kind) {
    case 'default':
      return 'default';
    case 'state_event':
      return `${source.type} by ${source.sender}`;
    case 'capability_override':
      return `requested by ${source.requestedBy}, overridden — build lacks the capability`;
  }
}

/**
 * `allow_back` is meaningless under `item_exit`, because the item behind you
 * no longer exists. Rather than let the room hold a contradictory config, the
 * walk reducer reads this instead of `allowBack` directly.
 */
export function backAllowed(settings: MediaSettings): boolean {
  return settings.allowBack.value && settings.destroyOn.value !== 'item_exit';
}
