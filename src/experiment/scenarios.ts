/**
 * Scenarios: arrange a message, state what should happen, then look.
 *
 * Two families here. The first is layout — the arrangements that break naive
 * grids. The second is single view, which is not in the sprint build at all;
 * those scenarios exist so the behaviour is inspectable and arguable now,
 * before anyone writes the version that ships it.
 */

import { stateEvent } from '../core/roomState';
import { STATE_MEDIA, STATE_SINGLE_VIEW } from '../core/settings';
import { audio, file, image, message, video, type ExperimentWorld } from './world';

export interface Scenario {
  id: string;
  title: string;
  question: string;
  group: 'layout' | 'single-view' | 'config';
  arrange(world: ExperimentWorld): void;
  expect: string[];
  tryNext?: string[];
}

const mediaConfig = (content: Record<string, unknown>) =>
  stateEvent(STATE_MEDIA, content, { sender: '@admin:example.org' });

const singleViewConfig = (content: Record<string, unknown>) =>
  stateEvent(STATE_SINGLE_VIEW, content, { sender: '@admin:example.org' });

export const SCENARIOS: Scenario[] = [
  {
    id: 'one-tall',
    title: 'One very tall screenshot',
    group: 'layout',
    question: 'Can a single item push the rest of the conversation off screen?',
    arrange(w) {
      w.add(message([image(1170, 4000, 210)], { caption: 'the whole settings screen' }));
    },
    expect: [
      'The image renders as a hero, clamped — not at its true 1:3.4 ratio.',
      'Aspect clamping happens in the solver, so the cap is testable without a device.',
      'Raise max_inline_height_ratio in the panel and it grows; the clamp still bounds it.',
    ],
  },

  {
    id: 'mixed-orientation',
    title: 'Portrait and landscape together',
    group: 'layout',
    question: 'Do mismatched aspect ratios produce a ransom-note grid?',
    arrange(w) {
      w.add(
        message([
          image(4000, 3000, 30),
          image(1080, 1920, 120),
          image(3000, 2000, 260),
          image(1920, 1080, 340),
        ]),
      );
    },
    expect: [
      'Two justified rows, each exactly the message width.',
      'Tile widths differ within a row; heights do not. That is what keeps it readable.',
      'Rounding is absorbed into the last tile, so there is never a 1px gap at the edge.',
    ],
  },

  {
    id: 'three-landscape',
    title: 'Three landscape vs three portrait',
    group: 'layout',
    question: 'Should three items always lay out the same way?',
    arrange(w) {
      w.add(message([image(4000, 2250, 20), image(4000, 2250, 60), image(4000, 2250, 100)]));
      w.add(message([image(1080, 1920, 180), image(1080, 1920, 220), image(1080, 1920, 260)]));
    },
    expect: [
      'The landscape trio splits 1-over-2; the portrait trio stays a single strip of three.',
      'Same count, different arrangement, chosen from the average aspect ratio.',
      'This is a convention people recognise, not an optimum — see the comment on partition().',
    ],
  },

  {
    id: 'mixed-types',
    title: 'Images, video, audio and a PDF',
    group: 'layout',
    question: 'What happens to media with no intrinsic shape?',
    arrange(w) {
      w.add(
        message(
          [
            image(3000, 2000, 15),
            video(1920, 1080, 200, 14_000),
            audio(48_000),
            file('rider-agreement-v4.pdf', 2_400_000),
            image(2000, 3000, 300),
          ],
          { caption: 'everything from the site visit' },
        ),
      );
    },
    expect: [
      'Three visuals in the grid; the audio clip and the PDF as rows underneath.',
      'Audio and files never get a tile — inventing an aspect ratio for a PDF is what produces grids of grey rectangles.',
      'The video tile carries its duration; the audio row carries a waveform.',
    ],
    tryNext: ['Switch grid_style to carousel and to list, and watch where the non-visual rows stay put.'],
  },

  {
    id: 'overflow',
    title: 'Twelve items, room allows six',
    group: 'layout',
    question: 'How does a message stop growing without hiding that it did?',
    arrange(w) {
      w.stateStore.send(mediaConfig({ max_items_rendered: 6 }));
      w.add(message(Array.from({ length: 12 }, (_, i) => image(1600, 1200, i * 30))));
    },
    expect: [
      'Six tiles, with a +6 badge on the last one.',
      'max_items_rendered is a room setting, so a room can be stricter without a client release.',
      'Set it to 1 and the message collapses to a single tile plus +11.',
    ],
  },

  {
    id: 'height-budget',
    title: 'Nine items against a height budget',
    group: 'layout',
    question: 'What gives when the grid is taller than the room allows?',
    arrange(w) {
      w.stateStore.send(mediaConfig({ max_items_rendered: 9, max_inline_height_ratio: 0.9 }));
      w.add(message(Array.from({ length: 9 }, (_, i) => image(1200, 1600, 40 + i * 20))));
    },
    expect: [
      'Three rows of three, scaled down together to fit the budget.',
      'Rows scale rather than drop: the item count stays honest, they just get smaller.',
      'Dropping rows would need a second +N next to the overflow badge, which reads as a bug.',
    ],
  },

  {
    id: 'notes',
    title: 'Per-item notes, capability off',
    group: 'config',
    question: 'What does a build do when the room asks for something it cannot render?',
    arrange(w) {
      w.stateStore.send(mediaConfig({ show_item_notes: true }));
      w.add(
        message([
          image(3000, 2000, 15, { note: 'client wants this one cropped tighter' }),
          image(2000, 3000, 190, { note: 'colour is wrong, reshoot' }),
          image(2400, 1600, 300),
        ]),
      );
    },
    expect: [
      'The notes do not render: this build has itemNotes capability off.',
      'The resolver records a capability_override rather than pretending the setting was never set.',
      'Turn the capability on in the CLIENT tab and the note slots appear without a settings change.',
    ],
    tryNext: ['Compare the provenance line before and after flipping the capability.'],
  },

  {
    id: 'single-view-item-exit',
    title: 'Single view: destroy as you walk',
    group: 'single-view',
    question: 'Do we know, per item, that we destroyed it?',
    arrange(w) {
      w.setCapabilities({ singleView: true });
      w.stateStore.send(singleViewConfig({ enabled: true, destroy_on: 'item_exit' }));
      w.add(
        message([image(2400, 1600, 10), image(1600, 2400, 130), video(1920, 1080, 250, 9000), image(2000, 2000, 320)], {
          singleView: { requested: true },
        }),
      );
    },
    expect: [
      'Opening starts a walk; each "next" destroys the item you just left.',
      'The audit log names every destroyed item, in order, with the rule that did it.',
      'Back is refused with a reason — there is nothing behind you any more.',
      'After the last item the envelope itself is marked destroyed.',
    ],
    tryNext: ['Switch destroy_on to session_complete mid-walk. The next step obeys the new policy.'],
  },

  {
    id: 'single-view-session-start',
    title: 'Single view: consumed on open',
    group: 'single-view',
    question: 'Can you still see something that no longer exists?',
    arrange(w) {
      w.setCapabilities({ singleView: true });
      w.stateStore.send(singleViewConfig({ enabled: true, destroy_on: 'session_start' }));
      w.add(message([image(2400, 1600, 40), image(2400, 1600, 90), image(2400, 1600, 140)], {
        singleView: { requested: true },
      }));
    },
    expect: [
      'The whole envelope is destroyed the instant it opens — before you look at anything.',
      'You can still walk all three items in this session. Destruction is of the stored copy, not the render.',
      'Close and reopen: nothing is left. That gap is the subtlety renderableNow() exists for.',
    ],
  },

  {
    id: 'single-view-abandoned',
    title: 'Single view: walk away halfway',
    group: 'single-view',
    question: 'What survives when the user does not finish?',
    arrange(w) {
      w.setCapabilities({ singleView: true });
      w.stateStore.send(singleViewConfig({ enabled: true, destroy_on: 'session_complete', allow_back: true }));
      w.add(message([image(2000, 1500, 55), image(2000, 1500, 105), image(2000, 1500, 155), image(2000, 1500, 205)], {
        singleView: { requested: true },
      }));
    },
    expect: [
      'Step through two items, then close: only those two are destroyed.',
      'Sealed items survive — abandoning does not un-see what was seen, but it does not consume what was not.',
      'allow_back works here and is refused under item_exit. backAllowed() reconciles that contradiction.',
    ],
    tryNext: ['Background the app mid-walk with destroy_on_background on, and compare the log.'],
  },

  {
    id: 'capability-gap',
    title: 'Room requires single view, build does not do it',
    group: 'single-view',
    question: 'What does the sprint build do the day a room turns this on?',
    arrange(w) {
      w.setCapabilities({ singleView: false });
      w.stateStore.send(singleViewConfig({ enabled: true, destroy_on: 'item_exit' }));
      w.add(message([image(2400, 1600, 350), image(1600, 2400, 20)], { singleView: { requested: true } }));
    },
    expect: [
      'The message renders as an ordinary media message. Nothing self-destructs.',
      'A danger-level warning says so: the sender believes these items are ephemeral and they are not.',
      'This is the actual sprint-build behaviour, and it is the one worth arguing about before shipping.',
    ],
    tryNext: [
      'Set capability_gap_behavior to withhold and reload: the message refuses to render instead of lying.',
    ],
  },

  {
    id: 'bad-config',
    title: 'Room sends nonsense config',
    group: 'config',
    question: 'Can a bad state event break the message?',
    arrange(w) {
      w.stateStore.send(
        mediaConfig({ max_items_rendered: -3, grid_style: 'mosaic', max_inline_height_ratio: 'tall' }),
      );
      w.add(message([image(2000, 1500, 60), image(1500, 2000, 160), image(2000, 2000, 260)]));
    },
    expect: [
      'The message renders normally: every bad value clamps or falls back.',
      'max_items_rendered clamps to 1; grid_style and the height ratio fall back with warnings.',
      'The panel lists the warnings, so a misconfigured room is diagnosable rather than just broken.',
    ],
  },
];

export const DEFAULT_SCENARIO = SCENARIOS[3];

export function loadScenario(world: ExperimentWorld, scenario: Scenario): void {
  world.reset();
  scenario.arrange(world);
}
