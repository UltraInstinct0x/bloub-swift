import { describe, expect, it } from 'vitest'
import {
  DRAW_ORDER,
  PALETTE_RANGES,
  REST_MOODS,
  REST_SETTLE_SECONDS,
  SEED_PREFIX,
  avatarFor,
  oklchToHex,
  restExpression,
  seedFor
} from '../src/identity.js'
import { EXPRESSION_BY_ID } from '../src/expressions.js'
import { fnv1a32 } from '../src/math.js'
import { capsulePath } from '../src/shape.js'
import { SHAPE_BY_ID } from '../src/skins.js'
import { BotEngine } from '../src/engine.js'
import { RADIUS } from '../src/repere.js'

const IDS = ['hermesbot', 'appdev', 'health', 'scout', 'goku', 'retro', 'cron', 'paperclip']

/** Relative luminance of a `#rrggbb` colour, sRGB, 0..1. */
function luminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16)
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

describe('seed', () => {
  it('is fnv1a32 of the versioned profile id', () => {
    expect(SEED_PREFIX).toBe('hermes-avatar/v1:')
    expect(seedFor('appdev')).toBe(fnv1a32('hermes-avatar/v1:appdev'))
  })

  it('is pinned for the profiles we ship', () => {
    // Hard-coded on purpose: these numbers ARE the contract. If they move, every bot in the
    // fleet changes face, and that must be a reviewed change and not an accident.
    const expected: Record<string, number> = {
      hermesbot: 816786720,
      appdev: 3886084835,
      health: 3670824079,
      scout: 2191395333,
      goku: 1538979087,
      retro: 2884969487,
      cron: 4240992393,
      paperclip: 991856919
    }
    for (const [id, seed] of Object.entries(expected)) {
      expect(seedFor(id), id).toBe(seed)
    }
  })

  it('does not depend on anything but the profile id', () => {
    // a display name, a key prefix or a path must not restyle a bot
    expect(seedFor('appdev')).not.toBe(seedFor('App Dev'))
    expect(seedFor('appdev')).not.toBe(seedFor('hermesbot'))
  })
})

describe('avatarFor', () => {
  it('is deterministic: the same id gives the same avatar', () => {
    for (const id of IDS) {
      expect(avatarFor(id)).toEqual(avatarFor(id))
    }
  })

  it('is total: even an empty or unknown id gets a usable look', () => {
    for (const id of ['', ' ', 'a'.repeat(300), '\u0000weird']) {
      const a = avatarFor(id)
      expect(SHAPE_BY_ID.has(a.shape)).toBe(true)
      expect(EXPRESSION_BY_ID.has(a.rest.expression)).toBe(true)
    }
  })

  it('spreads the fleet over shapes, hues and moods', () => {
    const shapes = new Set(IDS.map((id) => avatarFor(id).shape))
    const moods = new Set(IDS.map((id) => avatarFor(id).rest.mood))
    const hues = IDS.map((id) => avatarFor(id).palette.hue)
    expect(shapes.size).toBeGreaterThanOrEqual(4)
    expect(moods.size).toBeGreaterThanOrEqual(2)
    // no two bots land on the same hue by accident
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(Math.abs(hues[i]! - hues[j]!)).toBeGreaterThan(1)
      }
    }
  })

  it('only names shapes of our own catalogue', () => {
    for (const id of IDS) {
      expect(['orb', 'lozenge', 'wedge', 'trefoil', 'quatrefoil', 'bean', 'blob', 'pentagon']).toContain(
        avatarFor(id).shape
      )
    }
  })

  it('keeps the palette inside the declared readability ranges', () => {
    for (const id of IDS) {
      const { oklch, body, shadow, eye } = avatarFor(id).palette
      const inRange = (v: number, r: readonly [number, number]) => v >= r[0] - 1e-9 && v <= r[1] + 1e-9
      expect(inRange(oklch.body[0], PALETTE_RANGES.bodyLightness), `${id} body L`).toBe(true)
      expect(inRange(oklch.body[1], PALETTE_RANGES.bodyChroma), `${id} body C`).toBe(true)
      expect(inRange(oklch.shadow[0], PALETTE_RANGES.shadowLightness), `${id} shadow L`).toBe(true)
      expect(inRange(oklch.shadow[1], PALETTE_RANGES.shadowChroma), `${id} shadow C`).toBe(true)
      expect(inRange(oklch.eye[0], PALETTE_RANGES.eyeLightness), `${id} eye L`).toBe(true)
      expect(inRange(oklch.eye[1], PALETTE_RANGES.eyeChroma), `${id} eye C`).toBe(true)
      for (const hex of [body, shadow, eye]) expect(hex, `${id} hex`).toMatch(/^#[0-9a-f]{6}$/)
      expect(oklch.body[2]).toBeGreaterThanOrEqual(0)
      expect(oklch.body[2]).toBeLessThan(360)
    }
  })

  /**
   * The one readability rule the palette must never break: the eyes are holes in the body, so
   * they must read as a face at a glance — a dark eye on a mid-light body.
   *
   * Measured as relative luminance, not as a WCAG contrast ratio: the ratio's `+0.05` term is
   * punishing on dark colours and says nothing about a 40-unit eye on a 200-unit body. What
   * matters is that the eye is far darker in absolute terms, which the ranges guarantee.
   */
  it('keeps the eyes clearly darker than the body, and the shadow darker than the body', () => {
    for (const id of IDS) {
      const { body, eye, shadow } = avatarFor(id).palette
      const bodyY = luminance(body)
      const eyeY = luminance(eye)
      expect(bodyY - eyeY, `${id} body/eye luminance gap`).toBeGreaterThan(0.08)
      expect(eyeY / bodyY, `${id} eye relative luminance`).toBeLessThan(0.35)
      expect(luminance(shadow), `${id} shadow`).toBeLessThan(bodyY)
    }
  })

  it('keeps the body hues apart from the eye hues (no camouflage)', () => {
    for (const id of IDS) {
      const { oklch } = avatarFor(id).palette
      const gap = Math.abs(((oklch.eye[2] - oklch.body[2] + 540) % 360) - 180)
      expect(gap, `${id} hue gap`).toBeGreaterThan(30)
    }
  })

  it('gives a three-mood transition distribution that sums to one', () => {
    for (const id of IDS) {
      const { mood, transition } = avatarFor(id).rest
      const total = Object.values(transition).reduce((a, b) => a + b, 0)
      expect(total, id).toBeCloseTo(1, 12)
      for (const p of Object.values(transition)) expect(p).toBeGreaterThanOrEqual(0)
      // the bot stays itself most of the time: at most 16 % drift per window
      expect(transition[mood]).toBeGreaterThanOrEqual(1 - PALETTE_RANGES.driftChance[1])
      for (const other of REST_MOODS) {
        if (other.id === mood) continue
        expect(transition[other.id]).toBeGreaterThan(0)
      }
    }
  })

  it('only ever rests on one of the three moods, each with a real expression', () => {
    const expressions = new Set<string>()
    for (const id of IDS) {
      const rest = avatarFor(id).rest
      expect(REST_MOODS.map((m) => m.id)).toContain(rest.mood)
      expect(EXPRESSION_BY_ID.has(rest.expression)).toBe(true)
      expect(REST_MOODS.find((m) => m.id === rest.mood)!.expression).toBe(rest.expression)
      expressions.add(rest.expression)
    }
    expect(expressions.size).toBeGreaterThanOrEqual(2)
  })

  it('changes mood at most every 45 s', () => {
    expect(REST_SETTLE_SECONDS).toBe(45)
  })

  it('keeps the draw order frozen', () => {
    // Twelve draws, one per parameter. A new parameter is APPENDED; inserting one here
    // restyles the whole fleet and breaks every golden identity case.
    expect(DRAW_ORDER).toHaveLength(12)
    expect(DRAW_ORDER[0]).toBe('shape')
    expect(DRAW_ORDER[DRAW_ORDER.length - 1]).toBe('driftSplit')
  })
})

describe('restExpression', () => {
  it('hands the engine the object of the resting mood', () => {
    for (const id of IDS) {
      const expr = restExpression(id)
      expect(expr).toBe(EXPRESSION_BY_ID.get(avatarFor(id).rest.expression))
    }
  })
})

describe('oklchToHex', () => {
  it('hits the sRGB primaries the way CSS oklch() does', () => {
    // CSS: red is oklch(62.796% 0.25768 29.234), white is oklch(100% 0 0), black is 0% 0 0
    const red = oklchToHex(0.62796, 0.25768, 29.234)
    const rgb = [0, 2, 4].map((i) => parseInt(red.slice(1 + i, 3 + i), 16))
    expect(rgb[0]).toBeGreaterThanOrEqual(250)
    expect(rgb[1]).toBeLessThanOrEqual(24)
    expect(rgb[2]).toBeLessThanOrEqual(24)
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff')
    expect(oklchToHex(0, 0, 0)).toBe('#000000')
  })

  it('keeps lightness monotone: darker L, darker colour', () => {
    const l = [0.2, 0.4, 0.6, 0.8].map((v) => luminance(oklchToHex(v, 0.05, 200)))
    for (let i = 1; i < l.length; i++) expect(l[i]!).toBeGreaterThan(l[i - 1]!)
  })

  it('handles an impossible chroma without producing an invalid colour', () => {
    // far outside the sRGB gamut: chroma is reduced, lightness and hue are kept
    const hex = oklchToHex(0.62, 0.9, 140)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(luminance(hex)).toBeGreaterThan(0)
    expect(luminance(hex)).toBeLessThan(1)
  })
})

/**
 * The identity look, actually drawn: the composition in `engineForAvatar` must produce a
 * frame whose body is the bot's own shape and whose eyes are the bot's own expression — and
 * it must stay inside the silhouette, which is the only thing a viewer would notice.
 */
describe('identity look through the engine', () => {
  it('draws the bot own shape and rest expression', () => {
    for (const id of IDS) {
      const avatar = avatarFor(id)
      const engine = new BotEngine(RADIUS, 'idle', SHAPE_BY_ID.get(avatar.shape)!.radii, restExpression(id))
      const frame = engine.sample(1)
      expect(frame.bodyPath.length).toBeGreaterThan(0)
      expect(frame.eyes).toHaveLength(2)
      // the eye path carries the expression's eye size, not the default one
      const expr = restExpression(id)
      expect(frame.eyes[0]!.d).toBe(capsulePath(expr.eyes[0]!.w * RADIUS, expr.eyes[0]!.h * RADIUS))
    }
  })

  it('differs between bots: no two identities render the same body', () => {
    const bodies = new Set(
      IDS.map((id) => {
        const avatar = avatarFor(id)
        const engine = new BotEngine(RADIUS, 'idle', SHAPE_BY_ID.get(avatar.shape)!.radii, restExpression(id))
        return engine.sample(1).bodyPath
      })
    )
    expect(bodies.size).toBeGreaterThanOrEqual(4)
  })
})
