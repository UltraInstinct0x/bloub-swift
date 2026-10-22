/**
 * Where to place the face on a body shape.
 *
 * The eyes live on a sphere, and `radiusAtAngle` glues them to the real outline pro rata
 * of the local radius. That pro rata places their CENTRE correctly, but the eye has a
 * size: the margin it keeps in front of the edge is multiplied by the same factor, so a
 * silhouette narrow in the eye's direction pushes it against the edge until the mask
 * opens it outwards — the capsule read as a notch cut into the body.
 *
 * This module solves the problem ONCE, at load, and yields a table of offsets. That
 * choice is the whole fix, far more than the geometry below it: seven versions solved it
 * inside the render loop, and every one produced a visible motion artefact, because
 * everything the solver reads moves at sixty frames per second (gaze drift, pointer,
 * expression mid-morph, which edge is nearest, which eye is tightest). The names for what
 * went wrong are established ones: an active-set change when the nearest edge switches, a
 * non-smooth objective because `min` is C0 but not C1, and chattering from a per-frame
 * feedback loop.
 *
 * The rest of the engine does not work that way: poses are DECLARED and it only
 * interpolates them along known curves. A tabulated offset fits that mould. It does not
 * move when the gaze drifts or the pointer moves, and on a change of shape or expression
 * it merely travels from one table entry to another, on that morph's curve. Trembling
 * becomes impossible by construction: interpolating between two constants is monotone,
 * whereas re-solving on a gaze that is itself interpolating is not.
 *
 * The table is a module constant, built at import from pure data: same nature as the
 * pre-drawn blink schedule in `face.ts` — deterministic and stateless, so
 * `engine.sample(t)` stays a pure function of time.
 */

import { EXPRESSIONS, type BotExpression } from './expressions.js'
import { eyePoses } from './face.js'
import { radiusAtAngle, toPoints, type Point } from './shape.js'
import { SHAPES } from './skins.js'
import { STATES, type Pose, type StateDef, type StateId } from './states.js'

/** Reference radius of the solver. The rendered offset is in units of this radius. */
const R = 100

/**
 * Maximum amplitudes of the life at rest, read off `liveliness`: `loopNoise` is bounded by
 * 1 in absolute value, so these sums are exact bounds, not estimates.
 *
 * They must be covered, otherwise the correction is right on the nominal pose and wrong a
 * second later: 7 degrees of yaw move the eye by a dozen units on a ball of radius 100.
 */
const DERIVE_YAW = 5.5 + 1.6
const DERIVE_PITCH = 4.2 + 1.3
/** Centre float, in ball-radius units. */
const DERIVE_X = 0.006
const DERIVE_Y = 0.007

/** The face of a pose: what the solver needs to place its capsules. */
interface Face {
  gaze: Pose['gaze']
  split: number
  eyes: Pose['eyes']
}

/**
 * A capsule ready to be measured: the segment of its axis, and what is needed to compute
 * the radius to clear IN A GIVEN DIRECTION.
 *
 * A capsule is exactly a segment thickened by a disc of radius `r`. Its image under the
 * tangent matrix is therefore a segment thickened by an ELLIPSE, and the radius to clear
 * depends on the direction: that is this ellipse's support function, `r * |A^T u|`.
 *
 * Taking its largest singular value instead would be conservative but wrong in the one
 * direction that matters, and it costs dear: the reference margin on the circle came out
 * NEGATIVE, so the requirement lost its teeth and 34 combinations kept overflowing.
 */
interface Footprint {
  /** centre, in viewBox units */
  x: number
  y: number
  /** half-vector of the axis */
  ax: number
  ay: number
  /** local disc radius, before transformation */
  r: number
  /** columns of the tangent matrix, for the support function */
  m: [number, number, number, number]
}

/**
 * Footprints of the two eyes of a face, placed on a profile.
 *
 * The blink is not included: a closed eye doesn't need room made for it.
 */
function footprints(face: Face, sil: Pose['sil'], radii: number[]): Footprint[] {
  const out: Footprint[] = []
  const poses = eyePoses(face.gaze, R, face.split)
  for (let i = 0; i < 2; i++) {
    const e = poses[i]!
    if (e.depth <= 0.02) continue
    const cfg = face.eyes[i]!
    const phi = ((cfg.tilt ?? 0) * Math.PI) / 180
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    const ax = e.a * cp + e.c * sp
    const ay = e.b * cp + e.d * sp
    const cx = -e.a * sp + e.c * cp
    const cy = -e.b * sp + e.d * cp

    const hw = Math.max(cfg.w * R, 0.01) / 2
    const hh = Math.max(cfg.h * R, 0.01) / 2
    const r = Math.min(hw, hh)
    // the axis is the longer dimension's
    const long = hh > hw
    const demi = long ? hh - r : hw - r
    // the local radius pro rata, exactly as the engine does it
    const fit = radiusAtAngle(radii, Math.atan2(e.y, e.x) - sil.rot)
    out.push({
      x: e.x * fit,
      y: e.y * fit,
      ax: (long ? cx : ax) * demi,
      ay: (long ? cy : ay) * demi,
      r,
      m: [ax, ay, cx, cy]
    })
  }
  return out
}

/**
 * Shortest approach between an outline and a segment: the distance, and the vector going
 * from the outline towards the segment — the freeing direction.
 *
 * Both come out of the SAME pass. Computing them separately doubled the only real cost of
 * this module, which is this sweep.
 */
function approach(pts: Point[], x0: number, y0: number, x1: number, y1: number) {
  const sx = x1 - x0
  const sy = y1 - y0
  const len2 = sx * sx + sy * sy
  let best = Infinity
  let vx = 0
  let vy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    let t = len2 > 0 ? ((p.x - x0) * sx + (p.y - y0) * sy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = x0 + t * sx - p.x
    const ey = y0 + t * sy - p.y
    const d2 = ex * ex + ey * ey
    if (d2 < best) {
      best = d2
      vx = ex
      vy = ey
    }
  }
  const d = Math.sqrt(best)
  return { d, ux: d > 1e-9 ? vx / d : 0, uy: d > 1e-9 ? vy / d : 0 }
}

/** One trial: capsules to fit inside an outline, and the reference outline. */
interface Trial {
  prints: Footprint[]
  reference: Footprint[]
  outline: Point[]
  refOutline: Point[]
}

/**
 * Centre float at rest, in viewBox units. Added to the capsule's radius: less than one
 * unit, so absorbing it like this costs less than multiplying the trials by its four
 * corners.
 */
const FLOAT = Math.hypot(DERIVE_X, DERIVE_Y) * R

/** Margin of the tightest capsule, and the direction that frees it. */
function worst(pts: Point[], prints: Footprint[], tx: number, ty: number) {
  let margin = Infinity
  let ux = 0
  let uy = 0
  for (const e of prints) {
    const x = e.x + tx
    const y = e.y + ty
    const a = approach(pts, x - e.ax, y - e.ay, x + e.ax, y + e.ay)
    // the ellipse's support function in the approach direction
    const [m0, m1, m2, m3] = e.m
    const radius = e.r * Math.hypot(m0 * a.ux + m1 * a.uy, m2 * a.ux + m3 * a.uy) + FLOAT
    if (a.d - radius < margin) {
      margin = a.d - radius
      ux = a.ux
      uy = a.uy
    }
  }
  return { margin, ux, uy }
}

/**
 * Directions probed, and bisection steps. Their product is the table's construction cost,
 * the only figure to watch here.
 */
const DIRECTIONS = 12
const BISECTION = 8

/**
 * The offset to apply to both eyes for this shape, this state and this expression.
 *
 * A TRANSLATION common to both eyes, hence an isometry: eye spacing, sizes and tilts are
 * preserved to the pixel. The face is merely placed a little lower on a body with no room
 * up there — the gesture you would make by hand. The variants that bounded each eye
 * separately spread the pair, and the ones that scaled the face shrank the eyes, visibly.
 *
 * The margin aimed for is the one the ORIGINAL profile gave, not strict clearance: on the
 * circle the outer eye already grazes the edge, 17.3 units on a ball of radius 100, and
 * that is deliberate. It is capped by what the shape offers at its centre, otherwise the
 * requirement is untenable on a flat body.
 *
 * DIRECTIONAL SEARCH and not descent. We want the translation of smallest norm that holds,
 * so a crown of directions is probed and the distance is bisected along each. A gradient
 * descent was written first and does not converge: freeing the pair from one edge brings it
 * closer to the other, so it dithers and merely keeps its best attempt — dropping its
 * rounds from 40 to 18 was enough to bring 34 overflows back. Here the result does not
 * depend on convergence: each direction is solved exactly, to the bisection step.
 */
function solve(trials: Trial[]): { x: number; y: number } {
  if (!trials.length) return { x: 0, y: 0 }

  /** The tightest margin over all trials, for a given translation. */
  const margin = (tx: number, ty: number) => {
    let m = Infinity
    for (const tr of trials) m = Math.min(m, worst(tr.outline, tr.prints, tx, ty).margin)
    return m
  }

  // Required margin: the tightest the original profile tolerates, over all trials. Then
  // capped by the most room the shape can offer the pair, at its centre.
  let required = Infinity
  for (const tr of trials) {
    required = Math.min(required, worst(tr.refOutline, tr.reference, 0, 0).margin)
  }
  /*
   * The travel must be able to reach the body's centre: `wide` has 87-unit capsules, and on
   * a triangle they only fit near the middle, some 50 units from their nominal place. A
   * fixed travel left them outside.
   */
  let mx = 0
  let my = 0
  const prints = trials[0]!.prints
  for (const e of prints) {
    mx -= e.x / prints.length
    my -= e.y / prints.length
  }
  const travel = Math.max(0.35 * R, Math.hypot(mx, my) * 1.25)

  // Demand cap: what the shape offers at its centre, always reachable.
  required = Math.min(required, margin(mx, my))

  /*
   * Already good: the circle's case, and any shape wide enough. The capsule must ALSO fit
   * in — without that second condition a shape where nothing fits satisfies the first
   * degenerately and we gave up. On a triangle or a teardrop they overflow whatever you do,
   * so the rule is to aim for the least bad, never to leave a real overflow unimproved.
   */
  const start = margin(0, 0)
  if (start >= required && start >= 0) return { x: 0, y: 0 }
  const target = Math.max(required, 0)

  let bestX = 0
  let bestY = 0
  let bestNorm = Infinity
  // fallback when nothing fits: the translation that frees the most, sampled on the way
  let fallbackX = 0
  let fallbackY = 0
  let fallback = start

  for (let d = 0; d < DIRECTIONS; d++) {
    const a = (d / DIRECTIONS) * Math.PI * 2
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    if (margin(ux * travel, uy * travel) < target) {
      // this direction leads nowhere; keep the best clearance seen anyway
      for (const k of [0.3, 0.6, 1]) {
        const m = margin(ux * travel * k, uy * travel * k)
        if (m > fallback) {
          fallback = m
          fallbackX = ux * travel * k
          fallbackY = uy * travel * k
        }
      }
      continue
    }
    // the shortest distance that holds, along this direction
    let lo = 0
    let hi = travel
    for (let i = 0; i < BISECTION; i++) {
      const mid = (lo + hi) / 2
      if (margin(ux * mid, uy * mid) >= target) hi = mid
      else lo = mid
    }
    if (hi < bestNorm) {
      bestNorm = hi
      bestX = ux * hi
      bestY = uy * hi
    }
  }

  const x = bestNorm === Infinity ? fallbackX : bestX
  const y = bestNorm === Infinity ? fallbackY : bestY
  // emitted in BALL-RADIUS units: the engine puts it back at its own scale
  return { x: +(x / R).toFixed(6), y: +(y / R).toFixed(6) }
}

/**
 * The face to cover: the expression's when the state accepts it, its own otherwise.
 *
 * ONE table entry per expression, not a worst case common to all. A worst case looked
 * safer — a constant offset cannot move when the expression changes — but it is untenable:
 * on a capsule `neutre` has high eyes and asks to go down while `effraye` has them low and
 * asks to go up. No single translation satisfies both.
 *
 * One entry per expression is no less fluid: the engine interpolates between TWO constants,
 * which is monotone by construction.
 */
function faceOf(def: StateDef, pose: Pose, expr: BotExpression | null): Face {
  if (def.baseFace && expr) return { gaze: expr.gaze, split: expr.split, eyes: expr.eyes }
  return { gaze: pose.gaze, split: pose.split, eyes: pose.eyes }
}

/** The dates to sample in a state: one, if its pose does not move. */
function datesOf(def: StateDef): number[] {
  const signature = (p: Pose) =>
    JSON.stringify([p.gaze, p.split, p.eyes, p.sil.rot, p.sil.cx, p.sil.cy, p.sil.sx, p.sil.sy])
  if (signature(def.pose(0)) === signature(def.pose(def.duration))) return [0]
  const n = 3
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * def.duration)
}

/** The offset of one shape on one state and one expression, drift included. */
function offsetFor(def: StateDef, radii: number[], expr: BotExpression | null): { x: number; y: number } {
  const trials: Trial[] = []
  for (const t of datesOf(def)) {
    const pose = def.pose(t)
    const outline = toPoints({ ...pose.sil, radii }, R)
    const refOutline = toPoints(pose.sil, R)
    const v = faceOf(def, pose, expr)
    // The four corners of the drift bound the nominal pose, which is their centre: testing
    // it as well would change no margin and costs one trial in five.
    const corners: Face[] = []
    for (const dy of [-DERIVE_YAW, DERIVE_YAW]) {
      for (const dp of [-DERIVE_PITCH, DERIVE_PITCH]) {
        corners.push({
          ...v,
          gaze: { yaw: v.gaze.yaw + dy, pitch: v.gaze.pitch + dp, roll: v.gaze.roll }
        })
      }
    }
    for (const c of corners) {
      trials.push({
        prints: footprints(c, pose.sil, radii),
        reference: footprints(c, pose.sil, pose.sil.radii),
        outline,
        refOutline
      })
    }
  }
  return solve(trials)
}

/** Zero, the value common to everything with nothing to correct. */
const ZERO = { x: 0, y: 0 } as const

/** Key of an entry: the state, and the expression when the state accepts it. */
const keyOf = (state: StateId, expr: string | null) => `${state}|${expr ?? ''}`

/**
 * Offset table, built at import: one entry per (shape, base-body state, expression). Only
 * `idle` and `swirl` carry the resting face, so only they are declined per expression —
 * the three other base-body states have a face measured off the reference and a single
 * entry.
 *
 * Keyed by REFERENCE of the radii array, which is already the engine's convention: its
 * `radii === this.shape` and `expression === this.expr` guards rest on the same stability.
 * An unknown profile, or `null`, corrects nothing — the API accepts any array and the
 * engine must not depend on its callers being careful.
 */
function build(): Map<number[], Map<string, { x: number; y: number }>> {
  return new Map(
    SHAPES.map((shape) => {
      const per = new Map<string, { x: number; y: number }>()
      for (const def of STATES) {
        if (!def.baseBody) continue
        const expressions = def.baseFace ? [null, ...EXPRESSIONS] : [null]
        for (const expr of expressions) {
          per.set(keyOf(def.id, expr?.id ?? null), offsetFor(def, shape.radii, expr))
        }
      }
      return [shape.radii, per] as const
    })
  )
}

const OFFSETS = build()

/**
 * Offset to apply to both eyes for this shape in this state, in ball-radius units — the
 * engine puts it back at its own scale.
 *
 * Zero as soon as the shape is not in the catalogue, which covers `null` and the circle:
 * on the circle the two profiles are the same, so the margin already is the required one.
 */
export function eyeOffset(
  radii: number[] | null,
  state: StateId,
  expr: string | null
): { x: number; y: number } {
  if (!radii) return ZERO
  const per = OFFSETS.get(radii)
  if (!per) return ZERO
  // a state without a resting face has one entry, whatever the expression
  return per.get(keyOf(state, expr)) ?? per.get(keyOf(state, null)) ?? ZERO
}

/** For the tests: enough to verify the table without redoing the geometry. */
export const FOR_TESTS = { build }
