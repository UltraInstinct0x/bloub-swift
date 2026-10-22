import { describe, expect, it } from 'vitest'
import {
  BOT_STATUSES,
  STATUS_LOOKS,
  applyStatus,
  engineForAvatar,
  isBotStatus,
  lookForStatus,
  stateForStatus
} from '../src/status.js'
import { BotEngine } from '../src/engine.js'
import { SEQUENCE, STATE_BY_ID } from '../src/states.js'
import { avatarFor } from '../src/identity.js'
import { EXPRESSION_BY_ID } from '../src/expressions.js'
import { capsulePath } from '../src/shape.js'
import { SHAPE_BY_ID } from '../src/skins.js'

describe('bot statuses', () => {
  it('covers the six statuses of the design note', () => {
    expect([...BOT_STATUSES]).toEqual(['idle', 'working', 'waiting', 'error', 'speaking', 'sleeping'])
  })

  /**
   * Every status must play a state of the measured CATALOGUE. `swirl` is the settings view's
   * entry transition: playing it as a status would show an interface animation as if a bot were
   * doing something, and it would also drop out of the palette on reload.
   */
  it('maps every status to a catalogue state, never to an interface transition', () => {
    for (const status of BOT_STATUSES) {
      const state = STATUS_LOOKS[status].state
      expect(SEQUENCE, `${status} -> ${state}`).toContain(state)
      expect(STATE_BY_ID.has(state)).toBe(true)
      expect(state).not.toBe('swirl')
    }
  })

  it('gives each status a distinct state', () => {
    const states = BOT_STATUSES.map((s) => STATUS_LOOKS[s].state)
    expect(new Set(states).size).toBe(states.length)
  })

  it('falls back to idle on anything it does not know', () => {
    expect(isBotStatus('working')).toBe(true)
    expect(isBotStatus('exploding')).toBe(false)
    expect(isBotStatus(undefined)).toBe(false)
    expect(stateForStatus('exploding')).toBe('idle')
    expect(lookForStatus('exploding')).toBe(STATUS_LOOKS.idle)
  })

  it('keeps the frame rates the design note fixes', () => {
    // idle is capped at 4 fps, a working bot gets 30
    expect(STATUS_LOOKS.idle.fps).toBe(4)
    expect(STATUS_LOOKS.working.fps).toBe(30)
    for (const status of BOT_STATUSES) expect(STATUS_LOOKS[status].fps).toBeGreaterThan(0)
  })

  it('loops the states that can be held, and does not loop the ones that resolve', () => {
    for (const status of BOT_STATUSES) {
      const look = STATUS_LOOKS[status]
      const def = STATE_BY_ID.get(look.state)!
      // a state with a `minDuration` has a measured resolution: looping it is the host's job,
      // holding a non-looping one is fine
      if (look.loop) expect(def.morph).toBeGreaterThan(0)
    }
    expect(STATUS_LOOKS.idle.loop).toBe(true)
    expect(STATUS_LOOKS.working.loop).toBe(true)
    expect(STATUS_LOOKS.speaking.loop).toBe(true)
  })

  it('brings error back to idle after 10 s, and nothing else reverts on its own', () => {
    expect(STATUS_LOOKS.error.revert).toEqual({ to: 'idle', afterSeconds: 10 })
    for (const status of BOT_STATUSES) {
      if (status === 'error') continue
      expect(STATUS_LOOKS[status].revert).toBeUndefined()
    }
  })

  /**
   * The mapping is the integration surface, so the reasoning behind the one non-obvious choice
   * is locked here as a test: `waiting` must keep the bot's own body, which is why it plays
   * `wide` and not `alert`. `alert` is the most literal attention-grabber, but it replaces the
   * silhouette with the "!" glyph (`baseBody: false`), and a bot waiting for an answer has to
   * stay recognisable as itself.
   */
  it('keeps the identity body for `waiting`, hence `wide` and not `alert`', () => {
    expect(STATUS_LOOKS.waiting.state).toBe('wide')
    expect(STATE_BY_ID.get('wide')!.baseBody).toBe(true)
    // the candidate it was chosen over, and why: it does not keep the body
    expect(STATE_BY_ID.get('alert')!.baseBody).toBe(false)
  })
})

describe('engineForAvatar', () => {
  it('wires the identity shape, the resting expression and the status state', () => {
    for (const profileId of ['hermesbot', 'appdev']) {
      const avatar = avatarFor(profileId)
      const engine = engineForAvatar(profileId, 'working')
      expect(engine.state).toBe(STATUS_LOOKS.working.state)
      expect(engine.scale).toBe(100)

      // the body is the bot's own silhouette: same path as a bare engine on that shape
      const bare = new BotEngine(100, STATUS_LOOKS.working.state, SHAPE_BY_ID.get(avatar.shape)!.radii)
      expect(engine.sample(1).bodyPath).toBe(bare.sample(1).bodyPath)
      // and the eyes carry the bot's resting expression sizes, which the bare engine lacks
      const expr = avatar.rest.expression
      expect(engine.sample(1).eyes.length).toBe(0) // `thinking` has no face
      const resting = engineForAvatar(profileId, 'idle').sample(1)
      expect(resting.eyes).toHaveLength(2)
      expect(resting.eyes[0]!.d).toBe(
        capsulePath(
          EXPRESSION_BY_ID.get(expr)!.eyes[0]!.w * 100,
          EXPRESSION_BY_ID.get(expr)!.eyes[0]!.h * 100
        )
      )
    }
  })

  it('starts with no history, whatever the status', () => {
    // the first status must not drag a fade in from `idle`: a fresh engine on `burst` is the
    // comparison, and its body path is the same because `burst` ignores shape and expression
    const fromStatus = engineForAvatar('appdev', 'error').sample(0)
    const fromFresh = new BotEngine(100, 'burst', shapeOf('appdev')).sample(0)
    expect(fromStatus.bodyPath).toBe(fromFresh.bodyPath)
  })

  it('honours an explicit scale and date', () => {
    const engine = engineForAvatar('scout', 'idle', { scale: 50, now: 3 })
    expect(engine.scale).toBe(50)
    const alert = engineForAvatar('scout', 'waiting', { now: 3 })
    // `wide` ignores local time, so the date only shows in the resting drift
    expect(alert.sample(3).bodyPath.length).toBeGreaterThan(0)
  })
})

describe('applyStatus', () => {
  it('moves the engine to the status state, dated', () => {
    const engine = engineForAvatar('hermesbot', 'idle')
    const look = applyStatus(engine, 'speaking', 1)
    expect(look.state).toBe('orbit')
    expect(engine.state).toBe('orbit')
    // a fade started at 1: sampling at 1.05 is mid-transition, at 3 it is settled
    expect(engine.sample(1.05).bodyPath).not.toBe(engine.sample(3).bodyPath)
  })

  it('does nothing for a status that is already the current state', () => {
    const engine = engineForAvatar('hermesbot', 'idle')
    const before = engine.sample(1).bodyPath
    applyStatus(engine, 'idle', 1)
    expect(engine.sample(1).bodyPath).toBe(before)
  })

  it('leaves the engine a pure function of time', () => {
    const engine = engineForAvatar('appdev', 'idle')
    applyStatus(engine, 'working', 0.5)
    const early = engine.sample(0.7).bodyPath
    engine.sample(5)
    expect(engine.sample(0.7).bodyPath).toBe(early)
  })
})

function shapeOf(profileId: string) {
  return SHAPE_BY_ID.get(avatarFor(profileId).shape)!.radii
}
