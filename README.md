# impl-expo-meda-message

> The repo name is a typo for **media-message**. Kept as-is because renaming a
> repo breaks every clone and remote already pointing at it; the app, bundle id
> and everything inside say `media-message`.

A contained, runnable experiment for **one envelope holding several pieces of
mixed media**, and displaying that sanely.

Expo SDK 57, dev client.

```bash
npm install
npx expo run:ios      # or run:android — dev client, not Expo Go
npm test              # 40 tests, no device needed
npm run typecheck
```

## The two problems this template holds

### 1. Laying out N items of mixed type without it looking like a ransom note

`src/core/layout.ts` is a pure solver: items plus a container width in, exact
tile rectangles out. One pass, no `onLayout` round-trip, no measure-then-
correct — that round-trip is what produces the reflow jitter you see when a
media message scrolls into view.

The rules, in the order they matter:

1. **Non-visual items never enter the grid.** Audio and files have no intrinsic
   aspect ratio. Giving a PDF a tile means inventing a shape for it, and the
   result is a grid of grey rectangles with filenames in them. They render as
   full-width rows underneath, always.
2. **Aspect ratios are clamped, not honoured.** One 9:32 screenshot must not
   push the rest of the conversation off screen.
3. **Every row is exactly the container width**, tiles in a row share a height,
   widths are proportional to aspect. Standard justified-row layout; rounding
   error is absorbed into the last tile so there is never a 1px seam.
4. **Overflow collapses into `+N`** rather than growing unboundedly, and when
   the stack exceeds the room's height budget the rows *scale* rather than
   drop — the item count stays honest.

Three items lay out differently depending on whether they are landscape or
portrait. That is a convention people already recognise from every other chat
app, not an optimum; `partition()` says so in a comment, because a general
optimiser produces technically-better layouts that read as wrong.

### 2. Single view — the flag that is not in the sprint

You said you would need to know that you were walking over items and destroying
them, and that the flag will not exist in the version you sprint for. So it is
here, off by default, behind a **capability** rather than a setting.

`src/core/singleView.ts` is a reducer that emits an **append-only log**. Every
entry says what was destroyed, when, and which rule did it:

```
session_start   Opened under destroy_on = item_exit
enter           i1 · Entered item 1 of 4
exit            i1 · Left item 1
destroy_item    i1 · destroy_on = item_exit: left the item
enter           i2 · Entered item 2 of 4
blocked         Cannot go back: the previous item was destroyed on exit
```

The viewer renders that log live underneath the item. In the real app it is
what you would feed to an audit trail, or assert against in a test proving a
policy change did not quietly start destroying more than it used to.

Three destruction triggers, all room-configurable:

| `destroy_on` | Destroys | Back allowed |
| --- | --- | --- |
| `item_exit` | Each item as you leave it | Never — there is nothing behind you |
| `session_complete` | All items when the walk ends | Yes |
| `session_start` | The whole envelope the instant it opens | Yes |

One subtlety that is easy to get wrong and is tested: **destruction applies to
the stored copy, not the in-flight render.** Under `session_start` the envelope
is consumed before you have looked at anything, and you can still walk all of
it in that session — you are looking at something that no longer exists
anywhere else. `renderableNow()` encodes that. Get it wrong and you either show
a black screen or leak a second view.

Abandoning a walk half way destroys what was *viewed* and leaves what was
sealed. Backgrounding the app destroys everything, if the room says so — that
is the most likely way a real user loses items they never looked at, so it is
as easy to trigger in the experiment as it is in life.

## Capabilities vs settings

These are kept visibly separate, and that separation is the most useful thing
in this repo.

- A **setting** is what the room asked for. It arrives as a state event.
- A **capability** is what this build can actually do. It is compiled in. The
  sprint build ships `{ singleView: false, itemNotes: false }`.

When a room requires single view and the build cannot do it, the resolver
overrides the setting and records a **danger-level warning**, because the
default failure mode — rendering normally and saying nothing — means the sender
believes those items self-destruct and they do not. `capability_gap_behavior`
lets a room pick `render_normally`, `render_with_warning` (default) or
`withhold` instead.

The *Room requires single view, build does not do it* scenario is the sprint
build's actual behaviour on the day someone turns this on. It is worth arguing
about before shipping.

## Per-item notes

`MediaItem.note` exists, the render slots exist, `show_item_notes` gates them,
and the `itemNotes` capability gates that. All off by default.

**One thing to confirm:** you mentioned notes "about what the client wants",
per item. This is built as a *per-item annotation carried on the item* — a
string the sender or a reviewer attaches to one piece of media. If you actually
meant per-item metadata the client app requests at render time, the slot is in
the right place but the plumbing would come from a different direction. Worth
correcting before anything is built on it.

## Room settings

| Type | Fields |
| --- | --- |
| `app.envelope.media` | `grid_style`, `max_items_rendered`, `max_inline_height_ratio`, `autoplay_video`, `show_captions`, `show_item_notes` |
| `app.envelope.single_view` | `enabled`, `destroy_on`, `allow_back`, `destroy_on_background`, `capability_gap_behavior` |

Same discipline as the rest of this set: the control panel can only change a
setting by sending the state event that carries it, every resolved value
carries provenance, and hostile input clamps or defaults with a warning rather
than throwing.

`allow_back` under `destroy_on: item_exit` is a contradiction the room is
allowed to hold; `backAllowed()` reconciles it in one place instead of letting
each call site guess.

## Fixtures

Sample items use a `synthetic://` URI scheme and paint themselves — scenarios
render offline and identically on every run, because a layout experiment that
depends on a CDN is a network test. The panel's **+ add real media from
library** button pushes real device photos and videos through the same solver,
which is worth doing at least once per layout change: real libraries contain
aspect ratios no fixture author thinks to write down.

## Layout

```
src/core/        pure TS solver, settings, walk reducer. This is what you lift.
src/adapters/    RoomStateSource, MediaStore, CapabilitySource
src/ui/          reference renderer + the walk viewer
src/experiment/  in-memory world, scenarios, control panel — deleted on integration
```

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

## Known edges

- Video *playback* only happens in the single-view viewer, and only for real
  file URIs. Inline autoplay is resolved as a setting but not implemented —
  `autoplay_video` currently changes nothing on screen.
- `MediaStore` is defined but not wired: the experiment destroys state, not
  bytes. The log-diffing pattern for hooking up real deletion is in
  `src/adapters/index.ts`.
- No upload, no progress, no failed-item state. A real media message needs a
  per-item send state and this does not model one.

---

## The wire boundary, and the ceiling it puts on this feature

`src/core/envelope.ts` (byte-identical across the `impl-expo-*` repos) and
`src/core/packing.ts` connect this experiment to the shape the Noodles API actually
moves. Derived from `noodles-model/openapi`, not invented.

### Matrix has no "several things in one message"

`m.room.message` carries exactly one `msgtype` and one body. Every multi-image
message you have seen in a Matrix client is N separate events grouped by the
renderer. That is a legitimate design and it is **not** this one: "one envelope
holding several pieces of mixed media" means one event, because N events can
partially fail, be partially revoked, and arrive interleaved with someone else's
message.

So the content shape is ours — `msgtype: 'app.envelope.multi'` with an `items`
array, each item carrying the `msgtype` it would have had as its own event. Cost:
no other client will render it, and the fallback `body` is all an unaware reader
sees. It is a count, not a filename list, because filenames leak content the
envelope's retention is supposed to govern.

### Ten attachments is a hard ceiling

`RevokeRoomMessageRequest.mediaIds` is **`maxItems: 10`**. Past ten, unsending the
message takes the text and leaves the extra files downloadable. This is not
mentioned in any doc outside the OpenAPI spec, and it is a limit on the feature
this repo exists to explore.

`packMedia` reports it via `overflow` rather than truncating. The honest options,
none of them free:

- **Cap the composer at ten** — simplest, a visible product limit.
- **Split past ten into multiple events** — loses the atomicity that motivated a
  single envelope in the first place.
- **Send more and accept unrevocable media** — only defensible if the UI says so at
  send time, which means saying it in a way people ignore.

This repo does not choose. It makes the choice unavoidable.

### Single view needs both halves

The sandbox's single-view walk is a client mechanism. `MediaUploadInitRequest`
also has **`viewOnce`**, which makes the *server* 410 the second download. Both are
needed: the flag stops another device fetching the bytes, the walk is what makes
the first view single. Requesting only the envelope flag gives you a "single-view"
image that a reinstall can fetch again. `packMedia` sets `viewOnce` on every file
when single view is requested.
