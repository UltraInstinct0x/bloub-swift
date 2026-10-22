import { PROFILE_SAMPLES } from './profiles.js'
import {
  profileFromPolygon,
  regularPolygonProfile,
  superellipseProfile,
  unionOfCirclesProfile
} from './shape.js'

/**
 * The identity silhouettes: the body shapes a Hermes bot can be born with.
 *
 * These are OURS, not bloub's. bloub's customiser catalogue (circle, pebble, squircle,
 * capsule, triangle, hexagon, cloud, teardrop) is deliberately not reused: our avatar has
 * to be recognisable as ours on the desktop, in the app and on iOS, and the reference
 * silhouette of the original is not what we want to inherit. See README, "Design rights".
 *
 * All of them are built analytically, at import, and sampled at the shared angular
 * resolution (`PROFILE_SAMPLES`), so any two of them morph by interpolating radii. A shape
 * has to go through a radial profile, or through `profileFromPolygon`.
 *
 * `radii` is the engine's contract: it hands the array straight to the silhouette, so
 * these arrays are module constants and their identity is what the eye-offset table is
 * keyed by (`eyefit.ts`). Never copy one before passing it to `BotEngine`.
 */

export type ShapeId =
  | 'orb'
  | 'lozenge'
  | 'wedge'
  | 'trefoil'
  | 'quatrefoil'
  | 'bean'
  | 'blob'
  | 'pentagon'

export interface BotShape {
  id: ShapeId
  radii: number[]
}

const ANGLES = Array.from({ length: PROFILE_SAMPLES }, (_, i) => (i / PROFILE_SAMPLES) * Math.PI * 2)

/** Brings the largest radius to `max`, so every shape carries the same visual weight. */
function normalize(radii: number[], max = 1): number[] {
  const peak = Math.max(...radii)
  if (peak <= 0) return radii
  const k = max / peak
  return radii.map((r) => r * k)
}

/**
 * r(theta) = 1 + sum of a_k * cos(k*theta + phi_k), then normalised.
 *
 * Low harmonics only: the corpus stays smooth and monotone between samples, which is what
 * `closedPath` (Catmull-Rom, 64 points) needs to stay clean at display size.
 */
function harmonicProfile(terms: Array<[amplitude: number, frequency: number, phase: number]>, max = 1) {
  return normalize(
    ANGLES.map((a) => 1 + terms.reduce((sum, [amp, freq, phase]) => sum + amp * Math.cos(freq * a + phase), 0)),
    max
  )
}

/** A near-circle: the calmest shape, still not a perfect ball. */
const orb = harmonicProfile([
  [0.018, 2, 0.4],
  [0.009, 3, 1.9]
])

/** Three lobes, one pointing up: a rounded trefoil. */
const trefoil = harmonicProfile([[0.085, 3, -Math.PI / 2]])

/** Four lobes on the diagonals: a rounded quatrefoil. */
const quatrefoil = harmonicProfile([[0.07, 4, 0.6]])

/** Irregular but smooth: two low harmonics with unrelated periods. */
const blob = harmonicProfile(
  [
    [0.06, 2, 2.3],
    [0.035, 5, 0.7]
  ],
  1.02
)

/** A kidney: union of two offset discs, fat at the bottom left. */
const bean = normalize(
  unionOfCirclesProfile([
    { x: -0.24, y: -0.16, r: 0.68 },
    { x: 0.22, y: 0.2, r: 0.6 }
  ]),
  1
)

export const SHAPES: BotShape[] = [
  { id: 'orb', radii: orb },
  // 1.45 and not 2: below 2 the superellipse's sides bow inwards, which reads as a cut
  // gemstone rather than as a rounded square.
  { id: 'lozenge', radii: normalize(superellipseProfile(1.45), 1) },
  // 1.12 and not 1: on a superellipse the largest radius is on the diagonal, so
  // normalising on it yields a shape that looks smaller than the ball.
  { id: 'wedge', radii: normalize(superellipseProfile(3.2, 1.06, 0.82), 1.12) },
  { id: 'trefoil', radii: trefoil },
  { id: 'quatrefoil', radii: quatrefoil },
  { id: 'bean', radii: bean },
  { id: 'blob', radii: blob },
  // -90deg: one vertex towards the top of the screen (y points down)
  { id: 'pentagon', radii: normalize(regularPolygonProfile(5, 1.1, 0.3, -90), 1) }
]

// Keyed by `string`, not by `ShapeId`: callers look up a value read back from storage or
// coming from a golden file, hence unvalidated.
export const SHAPE_BY_ID = new Map<string, BotShape>(SHAPES.map((s) => [s.id, s]))
export const DEFAULT_SHAPE: ShapeId = 'orb'

/** The shared radii array for a shape id, or null when the id is unknown. */
export function shapeRadii(id: string): number[] | null {
  return SHAPE_BY_ID.get(id)?.radii ?? null
}

/** Blends two hex colours. Used for the particles' depth haze. */
export function mixHex(from: string, to: string, t: number): string {
  const parse = (h: string) => {
    const v = parseInt(h.slice(1), 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  const a = parse(from)
  const b = parse(to)
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * t))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
