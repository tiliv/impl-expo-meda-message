/**
 * What this build can actually honour.
 *
 * Distinct from room settings, and the distinction is the point. A room can
 * start requiring single-view semantics before every client in it understands
 * them. What a client does during that window is a real decision:
 *
 *   - Silently render the message normally. The sender believes it self-
 *     destructs; it does not. This is the failure mode worth designing against.
 *   - Refuse to render, and say why.
 *   - Render with a visible "this build does not honour single view" marker.
 *
 * The sprint build ships with `singleView: false`. The experiment lets you
 * flip it so the future behaviour is inspectable now, and — more usefully —
 * lets you see what today's build does when a room asks for something it
 * cannot do.
 */

export interface ClientCapabilities {
  /**
   * Honour single-view destruction. Off for the sprint: the flag will not
   * exist in the version being built first.
   */
  singleView: boolean;
  /** Render per-item notes. Also not in the sprint. */
  itemNotes: boolean;
}

/** What ships in the first sprint. */
export const SPRINT_CAPABILITIES: ClientCapabilities = {
  singleView: false,
  itemNotes: false,
};

/** Everything on, for looking at where this is going. */
export const FUTURE_CAPABILITIES: ClientCapabilities = {
  singleView: true,
  itemNotes: true,
};

/**
 * How to behave when the room asks for something this build cannot do.
 *
 * `render_with_warning` is the default because silently ignoring the request
 * is the one option that actively misleads the sender, and refusing outright
 * makes a single unsupported flag able to blank a conversation.
 */
export type CapabilityGapBehavior = 'render_normally' | 'render_with_warning' | 'withhold';
