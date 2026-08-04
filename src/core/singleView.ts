/**
 * The single-view walk.
 *
 * The requirement this exists for: when a single-view flag causes us to walk
 * over a set of items and destroy them, we need to *know* that is what
 * happened — per item, in order, with reasons. Not infer it from the fact that
 * the message later looks empty.
 *
 * So the walk is a reducer that emits an append-only log. Every entry says
 * what was destroyed, when, and which rule did it. The experiment renders that
 * log live; in the real app it is what you would send to the audit trail, or
 * assert against in a test that a policy change did not quietly start
 * destroying more than it used to.
 *
 * One subtlety worth keeping: destruction applies to the *stored* copy, not to
 * the in-flight render. Under `session_start` the whole envelope is consumed
 * the instant it opens, and the viewer still shows you the items — you are
 * looking at something that no longer exists anywhere else. `renderableNow()`
 * is what encodes that, and getting it wrong means either showing a black
 * screen or leaking a second view.
 */

import { backAllowed, type MediaSettings } from './settings';
import type { ItemId, MediaItem } from './types';

export type ItemState = 'sealed' | 'viewing' | 'viewed' | 'destroyed';

export type WalkEventKind =
  | 'session_start'
  | 'enter'
  | 'exit'
  | 'destroy_item'
  | 'destroy_envelope'
  | 'blocked'
  | 'session_end';

export interface WalkEvent {
  at: number;
  kind: WalkEventKind;
  itemId?: ItemId;
  /** Human-readable, because the point of the log is being read. */
  reason: string;
}

export interface WalkState {
  status: 'idle' | 'walking' | 'complete' | 'aborted';
  index: number;
  order: ItemId[];
  states: Record<ItemId, ItemState>;
  /** Items entered during *this* session, so they stay renderable in it. */
  seenThisSession: ItemId[];
  log: WalkEvent[];
  envelopeDestroyed: boolean;
}

export type WalkAction =
  | { type: 'open'; at: number }
  | { type: 'next'; at: number }
  | { type: 'back'; at: number }
  | { type: 'close'; at: number }
  | { type: 'background'; at: number };

export function initialWalk(items: MediaItem[]): WalkState {
  const order = items.map((i) => i.id);
  return {
    status: 'idle',
    index: 0,
    order,
    states: Object.fromEntries(order.map((id) => [id, 'sealed' as ItemState])),
    seenThisSession: [],
    log: [],
    envelopeDestroyed: false,
  };
}

const push = (state: WalkState, event: WalkEvent): WalkState => ({
  ...state,
  log: [...state.log, event],
});

function destroyItem(state: WalkState, id: ItemId, at: number, reason: string): WalkState {
  if (state.states[id] === 'destroyed') return state;
  return push(
    { ...state, states: { ...state.states, [id]: 'destroyed' } },
    { at, kind: 'destroy_item', itemId: id, reason },
  );
}

function destroyAll(state: WalkState, at: number, reason: string, only?: ItemState[]): WalkState {
  let next = state;
  for (const id of state.order) {
    if (only && !only.includes(state.states[id])) continue;
    next = destroyItem(next, id, at, reason);
  }
  return next;
}

function sealEnvelopeIfEmpty(state: WalkState, at: number, reason: string): WalkState {
  if (state.envelopeDestroyed) return state;
  if (!state.order.every((id) => state.states[id] === 'destroyed')) return state;
  return push({ ...state, envelopeDestroyed: true }, { at, kind: 'destroy_envelope', reason });
}

export function walkReducer(state: WalkState, action: WalkAction, settings: MediaSettings): WalkState {
  const trigger = settings.destroyOn.value;

  switch (action.type) {
    case 'open': {
      if (state.status === 'walking') return state;
      if (state.envelopeDestroyed) {
        return push(state, {
          at: action.at,
          kind: 'blocked',
          reason: 'Envelope already destroyed; nothing left to open',
        });
      }

      let next = push({ ...state, status: 'walking', index: 0, seenThisSession: [] }, {
        at: action.at,
        kind: 'session_start',
        reason: `Opened under destroy_on = ${trigger}`,
      });

      if (trigger === 'session_start') {
        // Consumed on open: the stored copy is gone before you have looked at
        // anything. This session renders from what it already holds.
        next = destroyAll(next, action.at, 'destroy_on = session_start: consumed on open');
        next = sealEnvelopeIfEmpty(next, action.at, 'All items consumed at session start');
      }

      return enter(next, 0, action.at);
    }

    case 'next': {
      if (state.status !== 'walking') return state;
      const currentId = state.order[state.index];
      let next = exit(state, state.index, action.at);

      if (trigger === 'item_exit') {
        next = destroyItem(next, currentId, action.at, 'destroy_on = item_exit: left the item');
        next = sealEnvelopeIfEmpty(next, action.at, 'Last item destroyed on exit');
      }

      const isLast = state.index >= state.order.length - 1;
      if (!isLast) return enter(next, state.index + 1, action.at);

      if (trigger === 'session_complete') {
        next = destroyAll(next, action.at, 'destroy_on = session_complete: walk finished');
        next = sealEnvelopeIfEmpty(next, action.at, 'All items destroyed on completion');
      }
      return push({ ...next, status: 'complete' }, {
        at: action.at,
        kind: 'session_end',
        reason: 'Walk completed',
      });
    }

    case 'back': {
      if (state.status !== 'walking' || state.index === 0) return state;
      if (!backAllowed(settings)) {
        return push(state, {
          at: action.at,
          kind: 'blocked',
          reason:
            settings.destroyOn.value === 'item_exit'
              ? 'Cannot go back: the previous item was destroyed on exit'
              : 'Cannot go back: allow_back is off',
        });
      }
      const next = exit(state, state.index, action.at);
      return enter(next, state.index - 1, action.at);
    }

    case 'close': {
      if (state.status !== 'walking') return state;
      let next = exit(state, state.index, action.at);
      if (trigger === 'session_complete') {
        // Abandoning does not un-see what was seen. Sealed items survive.
        next = destroyAll(next, action.at, 'Session abandoned: destroying items already viewed', ['viewed']);
        next = sealEnvelopeIfEmpty(next, action.at, 'All items had been viewed before abandoning');
      }
      return push({ ...next, status: 'aborted' }, {
        at: action.at,
        kind: 'session_end',
        reason: 'Closed before the end of the walk',
      });
    }

    case 'background': {
      if (state.status !== 'walking') return state;
      if (!settings.destroyOnBackground.value) {
        return push(state, {
          at: action.at,
          kind: 'blocked',
          reason: 'Backgrounded; destroy_on_background is off, session held',
        });
      }
      let next = exit(state, state.index, action.at);
      next = destroyAll(next, action.at, 'App backgrounded while a single-view session was open');
      next = sealEnvelopeIfEmpty(next, action.at, 'Destroyed on background');
      return push({ ...next, status: 'aborted' }, {
        at: action.at,
        kind: 'session_end',
        reason: 'Backgrounded',
      });
    }
  }
}

function enter(state: WalkState, index: number, at: number): WalkState {
  const id = state.order[index];
  if (id === undefined) return state;
  const seen = state.seenThisSession.includes(id) ? state.seenThisSession : [...state.seenThisSession, id];
  return push(
    {
      ...state,
      index,
      seenThisSession: seen,
      states: {
        ...state.states,
        // An item destroyed at session start stays destroyed; entering it does
        // not resurrect it, it just makes it renderable for this session.
        [id]: state.states[id] === 'destroyed' ? 'destroyed' : 'viewing',
      },
    },
    { at, kind: 'enter', itemId: id, reason: `Entered item ${index + 1} of ${state.order.length}` },
  );
}

function exit(state: WalkState, index: number, at: number): WalkState {
  const id = state.order[index];
  if (id === undefined) return state;
  return push(
    {
      ...state,
      states: { ...state.states, [id]: state.states[id] === 'destroyed' ? 'destroyed' : 'viewed' },
    },
    { at, kind: 'exit', itemId: id, reason: `Left item ${index + 1}` },
  );
}

// --- selectors -----------------------------------------------------------

/**
 * Can this item be drawn right now?
 *
 * Destroyed items remain visible for the rest of the session that destroyed
 * them — that is what "walking over them" means. Outside a session, destroyed
 * is destroyed.
 */
export function renderableNow(state: WalkState, id: ItemId): boolean {
  if (state.states[id] !== 'destroyed') return true;
  return state.status === 'walking' && state.seenThisSession.includes(id);
}

export const remainingCount = (state: WalkState): number =>
  state.order.filter((id) => state.states[id] !== 'destroyed').length;

export const destroyedCount = (state: WalkState): number =>
  state.order.filter((id) => state.states[id] === 'destroyed').length;

/** The log entries that represent actual data loss, for a compact audit view. */
export const destructionLog = (state: WalkState): WalkEvent[] =>
  state.log.filter((e) => e.kind === 'destroy_item' || e.kind === 'destroy_envelope');
