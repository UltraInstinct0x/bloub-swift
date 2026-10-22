import { createRng, fnv1a32 } from './math.js'
import { EXPRESSION_BY_ID, type BotExpression, type ExpressionId } from './expressions.js'
import { SHAPES, type ShapeId } from './skins.js'

/**
 * The look of a bot, derived from its identity.
 *
 * The whole point: the same profile id gives the same shape, the same palette and the same
 * resting expression on every device, with no storage and no server. The name shown in the
 * interface is NOT part of it — renaming a bot must not restyle it.
 *
 * `seed` is `fnv1a32('hermes-avatar/v1:' + profileId)`, where `profileId` is the profile
 * part of the bot key (`splitBotKey(key).id`), never the display name.
 *
 * ## The draw order is part of the contract
 *
 * `mulberry32(seed)` is consumed in ONE fixed order, each parameter taking one draw, even
 * where a value could be derived from another. Inserting, removing or reordering a draw
 * restyles every bot in the fleet at once and breaks the golden set, so a new parameter is
 * APPENDED, never inserted. `DRAW_ORDER` records the sequence and `identity.test.ts` locks
 * its length, so an accidental insertion fails a test instead of silently repainting every
 * avatar.
 */

/** Prefix of the identity hash. Change it only with a new visual generation. */
export const SEED_PREFIX = 'hermes-avatar/v1:'

/** The engine's rest-expression change cadence, in seconds (design note: at most every 45 s). */
export const REST_SETTLE_SECONDS = 45

/** The three resting moods a bot can be born with. */
export type RestMoodId = 'calm' | 'bright' | 'amused'

export interface RestMood {
  id: RestMoodId
  /** the engine expression id this mood carries */
  expression: ExpressionId
}

/** Order matters: it is the index the PRNG draws. Append only. */
export const REST_MOODS: RestMood[] = [
  // the measured neutral face: even, level, the calmest of the three
  { id: 'calm', expression: 'neutre' },
  // eyes slightly narrower and lifted, head tipped forward a touch: reads as engaged
  { id: 'bright', expression: 'attentif' },
  // squeezed arcs, a head tilt: the friendly one
  { id: 'amused', expression: 'heureux' }
]

export const REST_MOOD_BY_ID = new Map<RestMoodId, RestMood>(REST_MOODS.map((m) => [m.id, m]))

/**
 * OKLCH coordinates and the hex each was rasterised to.
 *
 * OKLCH because the hue is a plain angle: two bots with seeds a few units apart get
 * neighbouring hues and therefore recognisably related colours, which HSL at equal
 * lightness does not give. Lightness and chroma stay inside fixed ranges so every bot
 * remains readable — a dark eye on a mid-light body — whatever the seed says.
 */
export interface AvatarPalette {
  /** body hue, degrees in [0, 360) */
  hue: number
  /** body fill */
  body: string
  /** shadow / underside of the body */
  shadow: string
  /** eye fill: the eyes are holes in a mask, this is what shows through them */
  eye: string
  /** the OKLCH triplets the hexes were built from: [L, C, h] */
  oklch: {
    body: [number, number, number]
    shadow: [number, number, number]
    eye: [number, number, number]
  }
}

export interface AvatarRest {
  mood: RestMoodId
  /** engine expression id of that mood */
  expression: ExpressionId
  /**
   * Probability distribution over the three moods for the next rest window, summing to 1.
   * The engine has no clock: the caller re-draws at most every `REST_SETTLE_SECONDS`.
   */
  transition: Record<RestMoodId, number>
}

export interface Avatar {
  profileId: string
  seed: number
  shape: ShapeId
  palette: AvatarPalette
  rest: AvatarRest
}

/** The identity seed of a profile. Hex string in, 32-bit unsigned integer out. */
export function seedFor(profileId: string): number {
  return fnv1a32(SEED_PREFIX + profileId)
}

/* --------------------------------------------------------------- OKLCH -> hex */

/** Linear sRGB channels of an OKLCH triple, unclamped. */
function linearSrgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b

  const L = l_ * l_ * l_
  const M = m_ * m_ * m_
  const S = s_ * s_ * s_

  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
  ]
}

/**
 * OKLCH to sRGB hex.
 *
 * Out-of-gamut colours are handled by REDUCING CHROMA until they fit, keeping lightness and
 * hue exactly — not by clamping the channels, which would shift both and made a green body
 * come out with a zero red channel. The reduction is a 16-step bisection on the same
 * conversion, so it is deterministic and identical on every platform.
 */
export function oklchToHex(l: number, c: number, hDeg: number): string {
  const fits = (chroma: number) =>
    linearSrgb(l, chroma, hDeg).every((v) => v >= -1e-6 && v <= 1 + 1e-6)

  let chroma = c
  if (!fits(c)) {
    let lo = 0
    let hi = c
    if (fits(0)) {
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      chroma = lo
    } else {
      chroma = 0
    }
  }

  const channel = (v: number) => {
    const enc = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, enc)) * 255)
      .toString(16)
      .padStart(2, '0')
  }

  const [r, g, b] = linearSrgb(l, chroma, hDeg)
  return `#${channel(r!)}${channel(g!)}${channel(b!)}`
}

/* --------------------------------------------------------------------- draws */

/**
 * The draw order, in code order. Twelve draws, one per parameter. Read this before touching
 * `avatarFor`: a reordering is a fleet-wide restyle.
 */
export const DRAW_ORDER = [
  'shape',
  'hue',
  'bodyLightness',
  'bodyChroma',
  'shadowLightness',
  'shadowChroma',
  'eyeLightness',
  'eyeChroma',
  'eyeHueOffset',
  'mood',
  'driftChance',
  'driftSplit'
] as const

/** Fixed ranges, wide enough to tell bots apart, narrow enough to stay readable. */
export const PALETTE_RANGES = {
  bodyLightness: [0.62, 0.72] as const,
  bodyChroma: [0.1, 0.16] as const,
  shadowLightness: [0.44, 0.52] as const,
  shadowChroma: [0.07, 0.12] as const,
  eyeLightness: [0.13, 0.2] as const,
  eyeChroma: [0.02, 0.05] as const,
  eyeHueOffset: [150, 210] as const,
  driftChance: [0.06, 0.16] as const,
  driftSplit: [0.35, 0.65] as const
} as const

const span = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u

/**
 * The avatar of a profile. Pure, total, and independent of anything but the id: an unknown
 * or empty id still gets a look, and the same id always gets the same one.
 */
export function avatarFor(profileId: string): Avatar {
  const seed = seedFor(profileId)
  const rnd = createRng(seed)

  // 1. shape
  const shapeIndex = Math.min(SHAPES.length - 1, Math.floor(rnd() * SHAPES.length))
  const shape = SHAPES[shapeIndex]!

  // 2. hue (full wheel: neighbouring bots must be able to be far apart)
  const hue = rnd() * 360

  // 3-4. body lightness and chroma
  const bodyL = span(PALETTE_RANGES.bodyLightness, rnd())
  const bodyC = span(PALETTE_RANGES.bodyChroma, rnd())

  // 5-6. shadow lightness and chroma
  const shadowL = span(PALETTE_RANGES.shadowLightness, rnd())
  const shadowC = span(PALETTE_RANGES.shadowChroma, rnd())

  // 7-9. eye lightness, chroma and hue offset (near-complementary, for contrast)
  const eyeL = span(PALETTE_RANGES.eyeLightness, rnd())
  const eyeC = span(PALETTE_RANGES.eyeChroma, rnd())
  const eyeHue = (hue + span(PALETTE_RANGES.eyeHueOffset, rnd())) % 360

  // 10. resting mood
  const mood = REST_MOODS[Math.min(REST_MOODS.length - 1, Math.floor(rnd() * REST_MOODS.length))]!

  // 11-12. how often it drifts to another mood, and how that chance splits between the two
  const driftChance = span(PALETTE_RANGES.driftChance, rnd())
  const driftSplit = span(PALETTE_RANGES.driftSplit, rnd())

  const others = REST_MOODS.filter((m) => m.id !== mood.id).map((m) => m.id)
  const transition: Record<RestMoodId, number> = { calm: 0, bright: 0, amused: 0 }
  transition[mood.id] = 1 - driftChance
  transition[others[0]!] = driftChance * driftSplit
  transition[others[1]!] = driftChance * (1 - driftSplit)

  return {
    profileId,
    seed,
    shape: shape.id,
    palette: {
      hue,
      body: oklchToHex(bodyL, bodyC, hue),
      shadow: oklchToHex(shadowL, shadowC, hue),
      eye: oklchToHex(eyeL, eyeC, eyeHue),
      oklch: { body: [bodyL, bodyC, hue], shadow: [shadowL, shadowC, hue], eye: [eyeL, eyeC, eyeHue] }
    },
    rest: {
      mood: mood.id,
      expression: mood.expression,
      transition
    }
  }
}

/** The engine expression object of a bot's resting mood. */
export function restExpression(profileId: string): BotExpression {
  const avatar = avatarFor(profileId)
  const expr = EXPRESSION_BY_ID.get(avatar.rest.expression)
  if (!expr) throw new Error(`unknown expression id: ${avatar.rest.expression}`)
  return expr
}
