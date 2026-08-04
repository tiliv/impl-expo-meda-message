# Follow-up

Reviewed while planning `impl-expo-message-composer`. No change of direction —
one relationship to formalise.

## This repo is one half of a pair

`impl-expo-meda-message` renders a multi-part envelope.
`impl-expo-message-composer` produces one. They are the receive and send sides
of the same wire format, and right now only one side exists, which means the
format is currently defined by whatever this repo happens to unpack.

That is fine until the composer is written, at which point the two `packing.ts`
files can drift silently — the composer emits a field this repo ignores, or
this repo tolerates a shape the composer never produces, and neither test suite
notices because each tests its own half.

**The fix, when the composer is built: shared fixtures, both directions.**

```
fixtures/envelopes/*.json     the same files, copied into both repos
```

- This repo's suite asserts: every fixture unpacks to the expected view model.
- The composer's suite asserts: the expected draft packs to exactly that JSON.

Copied, not shared as a package — same rule as `clock.ts` and `envelope.ts`.
Three identical files is not enough duplication to justify coupling the
sandboxes; a drift that shows up as a failing test in both repos is the point.

The fixtures should cover, at minimum: a single image; ten mixed items; a
caption with no attachments; a voice memo among photos; an eleven-item envelope
(the unrevocable case); and one envelope with a field this repo does not
understand, to pin down the forward-compatibility behaviour.

## The name

The repo is `meda-message`; everything inside says `media-message`. Leave it.
Renaming a repo breaks every existing clone and link for a typo that costs
nothing, and `ECOSYSTEM.md` already documents it.

## Not changing

The ceiling this repo found on the feature stands and the composer inherits it,
rather than rediscovering it: an envelope carrying more than ten attachments
cannot be fully unsent, because `RevokeRoomMessageRequest.mediaIds` is
`maxItems: 10`. The composer treats that as its attachment cap and offers
`split` as the interesting alternative.

---

## Open, as of the composer being built

`impl-expo-message-composer` now exists and defines the format this repo
renders. Concretely, `src/core/packing.ts` there emits:

| Attachments | msgtype |
| --- | --- |
| 0 | `m.text` |
| 1 | `m.file` + `app.envelope.media_id` |
| 2+ | `app.envelope.multi` + `app.envelope.items[]` with explicit `order`, plus a named `app.envelope.cover` |

**The shared fixtures are now the outstanding work, and they got more urgent
rather than less.** Until both repos read the same files, the format is defined
by whichever side was written last — which is currently the composer, by
accident rather than by agreement.

Minimum coverage: no attachments; one; ten mixed; a caption with no
attachments; a voice memo among photos; eleven (the unrevocable case); and one
envelope carrying a field this repo does not understand, to pin down
forward-compatibility.

Copied into both repos, not extracted into a package.
