# Wiring this into the real app

Integration should mean writing three adapters and deleting `src/experiment`.
If it means editing `src/core`, the seam is in the wrong place.

## 1. Copy `src/core` and `src/adapters`

Pure TypeScript, no React, no React Native, no Matrix SDK.

| File | What it owns |
| --- | --- |
| `types.ts` | The item union and the visual/non-visual split |
| `capabilities.ts` | What this build can honour, as distinct from what the room wants |
| `roomState.ts` | `RoomStateStore` — state events in, latest-wins |
| `settings.ts` | State events → typed settings, with provenance, warnings and the capability gate |
| `layout.ts` | The solver |
| `singleView.ts` | The destruction walk and its log |

## 2. Set your real capabilities

```ts
export const CAPABILITIES: ClientCapabilities = {
  singleView: false,   // flip when the destruction path is actually implemented
  itemNotes: false,
};
```

This is a compiled-in constant in the app. It is only mutable in the experiment
so the future behaviour stays inspectable. **Do not** let it become a remote
config value — the whole point is that it describes what the code can do, and
code cannot be changed by a state event.

## 3. Feed the solver a width, do not let it measure

```tsx
const plan = planMediaLayout(
  message.items,
  { containerWidth: bubbleWidth, gap: 3 },
  settings,
);
```

`bubbleWidth` should come from a known layout constant, not from `onLayout`. If
you must measure, measure the *bubble* once and cache it per-width — never
per-message. Re-solving on every measure event is how you get the jitter this
design exists to avoid.

The solver is pure and cheap; memoise on `(items, width, settings)` if a long
timeline shows up in a profile, but measure before assuming it needs it.

## 4. Wire the walk to real deletion

The reducer decides *that* an item should be destroyed and records why.
Something else has to delete the bytes:

```ts
const next = walkReducer(state, action, settings);

for (const event of next.log.slice(state.log.length)) {
  if (event.kind === 'destroy_item' && event.itemId) {
    await mediaStore.destroyLocal(message.id, event.itemId);
    await mediaStore.reportConsumed(message.id, event.itemId);
  }
}
setState(next);
```

Diff the **log**, not the item states. The log is append-only and ordered, so
effects run exactly once and in the order the policy intended. Diffing states
loses the ordering and, worse, loses the reason.

Two rules for the store implementation:

- **Idempotent.** The reducer will not ask twice, but a retried sync might.
- **Local first, then the server.** A client that reports destruction it has
  not performed is worse than one that is briefly out of sync.

## 5. Render

`src/ui` is a reference implementation. Take the structure, restyle the rest:

- `MediaMessageView` — sealed state, gap banner, grid, non-visual rows, caption
- `MediaTile` — one tile, told its size, never measuring
- `NonVisualRow` — audio waveform and file rows
- `SingleViewViewer` — the walk, with the log visible

Keep the `never` check at the bottom of `Visual`'s switch. Adding a layout style
should stop the build until someone draws it.

The `AppState` listener in the viewer is not decoration — backgrounding during a
single-view session is a real destruction trigger and needs to survive the port.

## Decisions still to make

1. **What `autoplay_video: wifi` actually means.** The setting resolves; nothing
   reads it. You need a network-type source and a policy for what happens when
   the type changes mid-scroll.
2. **Per-item send state.** Real media messages have items that are uploading,
   failed, or retrying. The item union has no variant for that, and adding one
   touches the solver (does a failed item hold its slot?).
3. **Whether a partially-destroyed envelope is still a reply target.** If the
   other template quotes a media message whose items are gone, the quote's
   `mediaSummary` will claim a count that no longer exists.
4. **Whether `session_start` should really render at all.** It currently shows
   you the items it just destroyed. The alternative — consume and show nothing —
   is defensible and arguably more honest, and is a one-line change to
   `renderableNow()`.
