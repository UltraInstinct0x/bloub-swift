import { BotEngine } from './engine.js'
import { avatarFor, restExpression } from './identity.js'
import { RADIUS } from './repere.js'
import { shapeRadii } from './skins.js'
import type { StateId } from './states.js'

/**
 * Bot status -> engine state.
 *
 * The bot has six statuses of its own (design note, "Status mapping"); the engine has
 * fourteen measured states. This module is the only place that decides which one a status
 * plays, and it decides once, from the measurements in the reference project's
 * `docs/measurements.md`, not per caller.
 *
 * | status   | state      | why                                                                 |
 * |----------|------------|---------------------------------------------------------------------|
 * | idle     | idle       | rest pose, sparse gaze drift and blinks: literally the rest case      |
 * | working  | thinking   | a periodic three-dot pulse, seamless as a loop, body recognised      |
 * | waiting  | wide       | the attention pose; wide eyes and no gesture that would read as done |
 * | error    | burst      | the only "something broke" state; the body collapses, then recovers  |
 * | speaking | orbit      | the only remaining continuous loop that keeps the body and reads live|
 * | sleeping | sleep      | the dot that bounces slowly                                           |
 *
 * Rejected candidates, and why they are not used:
 *
 * - `alert` for `waiting` is the most literal attention-grabber, but it replaces the
 *   silhouette with the "!" glyph (`baseBody: false`). The whole point of the identity look
 *   is that every bot keeps its own body, so a status must never take it away.
 * - `notify` also keeps the body, but its blue pastille reads as "you have a notification",
 *   which is a different claim from "this bot needs your answer".
 * - `exclaim` has the same problem as `alert`, in a stronger form: a static "!" with no face.
 * - `comet` for `speaking` collapses the body to a dot and keeps it there for most of the
 *   loop; on a call the avatar has to stay recognisable.
 * - `egg`/`hexagon`/`play` change the silhouette into a measured shape of the reference, so
 *   they are catalogue animations, not statuses.
 */

export const BOT_STATUSES = ['idle', 'working', 'waiting', 'error', 'speaking', 'sleeping'] as const

export type BotStatus = (typeof BOT_STATUSES)[number]

export interface StatusLook {
  /** engine state to play */
  state: StateId
  /** true = the state is periodic and can be held indefinitely */
  loop: boolean
  /**
   * Frame rate this status is worth, when it is on screen. Idle and sleeping are cheap
   * because nothing moves fast; working, waiting and speaking earn the full rate.
   * PROVISIONAL: the design note fixes idle (4 fps) and working (30 fps); the others are
   * filled in with the same reasoning and can be re-measured without touching the look.
   */
  fps: number
  /**
   * Automatic return to another status after this many seconds. Only `error` has one: the
   * design note asks for a sad pose that goes back to idle after 10 s, and the engine has no
   * clock, so the caller schedules it.
   */
  revert?: { to: BotStatus; afterSeconds: number }
}

export const STATUS_LOOKS: Record<BotStatus, StatusLook> = {
  idle: { state: 'idle', loop: true, fps: 4 },
  working: { state: 'thinking', loop: true, fps: 30 },
  waiting: { state: 'wide', loop: false, fps: 12 },
  error: { state: 'burst', loop: false, fps: 30, revert: { to: 'idle', afterSeconds: 10 } },
  speaking: { state: 'orbit', loop: true, fps: 30 },
  sleeping: { state: 'sleep', loop: true, fps: 4 }
}

export function isBotStatus(value: unknown): value is BotStatus {
  return typeof value === 'string' && (BOT_STATUSES as readonly string[]).includes(value)
}

/** The engine state a status plays. Unknown statuses fall back to `idle`. */
export function stateForStatus(status: string): StateId {
  return isBotStatus(status) ? STATUS_LOOKS[status].state : STATUS_LOOKS.idle.state
}

/** The whole look of a status. Unknown statuses fall back to `idle`. */
export function lookForStatus(status: string): StatusLook {
  return isBotStatus(status) ? STATUS_LOOKS[status] : STATUS_LOOKS.idle
}

/**
 * An engine wired to one bot's identity, already on the right state for `status`.
 *
 * The radii come from `identity.ts` (our silhouettes), the expression from the bot's
 * resting mood, and the state from this module: that composition is the whole integration
 * surface of stage 1, and it is what the golden frames pin down.
 */
export function engineForAvatar(
  profileId: string,
  status: BotStatus | string = 'idle',
  opts: { scale?: number; now?: number } = {}
): BotEngine {
  const avatar = avatarFor(profileId)
  const engine = new BotEngine(
    opts.scale ?? RADIUS,
    'idle',
    shapeRadii(avatar.shape),
    restExpression(profileId)
  )
  // `reset` and not the constructor: it is the dated form of "a fresh engine on this
  // state", with no leftover history whatever the first status is.
  engine.reset(stateForStatus(status), opts.now ?? 0)
  return engine
}

/**
 * Moves an engine to the state of `status`, dated.
 *
 * Returns the look so the caller can schedule the revert: the engine deliberately knows
 * nothing about wall time, so `revert.afterSeconds` is honoured with a `setState(revert.to)`
 * at `now + afterSeconds`, drawn by whatever timer the host already has.
 */
export function applyStatus(engine: BotEngine, status: string, now: number): StatusLook {
  const look = lookForStatus(status)
  engine.setState(look.state, now)
  return look
}
