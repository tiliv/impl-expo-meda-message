/**
 * The walk is the part that destroys user data, so it gets the pickiest tests
 * in this repo. Every assertion here is really the same question: did we
 * destroy exactly what the policy said, no more, and did we say so?
 */

import { RoomStateStore, stateEvent } from '../roomState';
import { FUTURE_CAPABILITIES } from '../capabilities';
import { resolveMediaSettings, STATE_SINGLE_VIEW, type DestroyTrigger } from '../settings';
import {
  destroyedCount,
  destructionLog,
  initialWalk,
  remainingCount,
  renderableNow,
  walkReducer,
  type WalkAction,
  type WalkState,
} from '../singleView';
import { image } from '../../experiment/world';

const ITEMS = [image(100, 100, 0), image(100, 100, 60), image(100, 100, 120), image(100, 100, 180)];

const settingsFor = (content: Record<string, unknown>) => {
  const store = new RoomStateStore();
  store.send(stateEvent(STATE_SINGLE_VIEW, { enabled: true, ...content }));
  return resolveMediaSettings(store, FUTURE_CAPABILITIES).settings;
};

const run = (trigger: DestroyTrigger, actions: WalkAction[], extra: Record<string, unknown> = {}): WalkState => {
  const settings = settingsFor({ destroy_on: trigger, ...extra });
  return actions.reduce((state, action) => walkReducer(state, action, settings), initialWalk(ITEMS));
};

const at = (n: number): number => 1_000 + n;

describe('destroy_on = item_exit', () => {
  it('destroys each item as you leave it, and only that item', () => {
    const state = run('item_exit', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'next', at: at(2) },
    ]);
    expect(state.states[ITEMS[0].id]).toBe('destroyed');
    expect(state.states[ITEMS[1].id]).toBe('destroyed');
    expect(state.states[ITEMS[2].id]).toBe('viewing');
    expect(state.states[ITEMS[3].id]).toBe('sealed');
    expect(remainingCount(state)).toBe(2);
  });

  it('names every destroyed item in the log, in order, with a reason', () => {
    const state = run('item_exit', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'next', at: at(2) },
    ]);
    const destroyed = destructionLog(state).filter((e) => e.kind === 'destroy_item');
    expect(destroyed.map((e) => e.itemId)).toEqual([ITEMS[0].id, ITEMS[1].id]);
    expect(destroyed.every((e) => e.reason.includes('item_exit'))).toBe(true);
  });

  it('refuses to go back, and says why', () => {
    const state = run('item_exit', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'back', at: at(2) },
    ], { allow_back: true });
    expect(state.index).toBe(1);
    const blocked = state.log.filter((e) => e.kind === 'blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toContain('destroyed on exit');
  });

  it('marks the envelope destroyed once the walk finishes', () => {
    const state = run('item_exit', [
      { type: 'open', at: at(0) },
      ...ITEMS.map((_, i) => ({ type: 'next' as const, at: at(i + 1) })),
    ]);
    expect(state.envelopeDestroyed).toBe(true);
    expect(state.status).toBe('complete');
    expect(destroyedCount(state)).toBe(ITEMS.length);
    expect(state.log.filter((e) => e.kind === 'destroy_envelope')).toHaveLength(1);
  });
});

describe('destroy_on = session_start', () => {
  it('consumes the whole envelope on open, before anything is viewed', () => {
    const state = run('session_start', [{ type: 'open', at: at(0) }]);
    expect(destroyedCount(state)).toBe(ITEMS.length);
    expect(state.envelopeDestroyed).toBe(true);
  });

  it('still renders items for the session that destroyed them', () => {
    const state = run('session_start', [{ type: 'open', at: at(0) }, { type: 'next', at: at(1) }]);
    expect(renderableNow(state, ITEMS[0].id)).toBe(true);
    expect(renderableNow(state, ITEMS[1].id)).toBe(true);
    // Not yet reached in this session, and already destroyed on disk.
    expect(renderableNow(state, ITEMS[3].id)).toBe(false);
  });

  it('leaves nothing renderable once the session ends', () => {
    const state = run('session_start', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'close', at: at(2) },
    ]);
    expect(ITEMS.every((i) => !renderableNow(state, i.id))).toBe(true);
  });

  it('refuses to reopen a destroyed envelope', () => {
    const settings = settingsFor({ destroy_on: 'session_start' });
    let state = walkReducer(initialWalk(ITEMS), { type: 'open', at: at(0) }, settings);
    state = walkReducer(state, { type: 'close', at: at(1) }, settings);
    state = walkReducer(state, { type: 'open', at: at(2) }, settings);
    expect(state.status).toBe('aborted');
    expect(state.log.some((e) => e.kind === 'blocked' && e.reason.includes('already destroyed'))).toBe(true);
  });
});

describe('destroy_on = session_complete', () => {
  it('destroys nothing until the walk finishes', () => {
    const state = run('session_complete', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'next', at: at(2) },
    ]);
    expect(destroyedCount(state)).toBe(0);
  });

  it('destroys only what was viewed when the user walks away', () => {
    const state = run('session_complete', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'close', at: at(2) },
    ]);
    expect(state.states[ITEMS[0].id]).toBe('destroyed');
    expect(state.states[ITEMS[1].id]).toBe('destroyed');
    expect(state.states[ITEMS[2].id]).toBe('sealed');
    expect(state.envelopeDestroyed).toBe(false);
  });

  it('allows back-navigation, because the items behind still exist', () => {
    const state = run('session_complete', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'back', at: at(2) },
    ], { allow_back: true });
    expect(state.index).toBe(0);
    expect(state.log.some((e) => e.kind === 'blocked')).toBe(false);
  });
});

describe('backgrounding', () => {
  it('destroys everything when destroy_on_background is on', () => {
    const state = run('session_complete', [
      { type: 'open', at: at(0) },
      { type: 'background', at: at(1) },
    ], { destroy_on_background: true });
    expect(destroyedCount(state)).toBe(ITEMS.length);
    expect(state.status).toBe('aborted');
    expect(destructionLog(state).some((e) => e.reason.includes('backgrounded'))).toBe(true);
  });

  it('holds the session when it is off', () => {
    const state = run('session_complete', [
      { type: 'open', at: at(0) },
      { type: 'background', at: at(1) },
    ], { destroy_on_background: false });
    expect(destroyedCount(state)).toBe(0);
    expect(state.status).toBe('walking');
  });
});

describe('policy changed mid-walk', () => {
  it('applies the new policy from the next step, not retroactively', () => {
    const lenient = settingsFor({ destroy_on: 'session_complete' });
    const strict = settingsFor({ destroy_on: 'item_exit' });

    let state = walkReducer(initialWalk(ITEMS), { type: 'open', at: at(0) }, lenient);
    state = walkReducer(state, { type: 'next', at: at(1) }, lenient);
    expect(destroyedCount(state)).toBe(0);

    state = walkReducer(state, { type: 'next', at: at(2) }, strict);
    expect(state.states[ITEMS[1].id]).toBe('destroyed');
    expect(state.states[ITEMS[0].id]).toBe('viewed'); // not retroactively destroyed
  });
});

describe('log integrity', () => {
  it('is append-only and never destroys the same item twice', () => {
    const state = run('item_exit', [
      { type: 'open', at: at(0) },
      { type: 'next', at: at(1) },
      { type: 'next', at: at(2) },
      { type: 'next', at: at(3) },
      { type: 'next', at: at(4) },
      { type: 'close', at: at(5) },
    ]);
    const ids = destructionLog(state)
      .filter((e) => e.kind === 'destroy_item')
      .map((e) => e.itemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.log.every((e) => typeof e.reason === 'string' && e.reason.length > 0)).toBe(true);
  });

  it('does nothing at all when the walk was never opened', () => {
    const settings = settingsFor({ destroy_on: 'item_exit' });
    const state = walkReducer(initialWalk(ITEMS), { type: 'next', at: at(0) }, settings);
    expect(state.log).toHaveLength(0);
    expect(destroyedCount(state)).toBe(0);
  });
});
