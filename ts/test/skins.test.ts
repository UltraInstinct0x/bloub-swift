import { describe, expect, it } from 'vitest'
import { BotEngine, type RenderedEye } from '../src/engine.js'
import { eyeOffset, FOR_TESTS } from '../src/eyefit.js'
import { EXPRESSIONS } from '../src/expressions.js'
import { PROFILE_SAMPLES } from '../src/profiles.js'
import { SHAPES } from '../src/skins.js'
import { STATES, type StateId } from '../src/states.js'

/**
 * The identity shapes, measured against the body they replace.
 *
 * Two things are locked here, and the second cost far more than the first:
 *
 * 1. **The capsule does not leave the silhouette.** The eyes live on a sphere and
 *    `radiusAtAngle` glues them to the outline pro rata of the local radius — which divides
 *    their margin by that same pro rata. A shape narrow in the eye's direction pushed the eye
 *    against the edge until the mask opened it: the capsule read as a notch in the body.
 * 2. **The correction does not visibly move.** Seven versions computed it in the render loop
 *    and all trembled. The oscillation tests below are what disqualified them, and they
 *    compare against the CIRCLE, the shape the correction does not touch.
 *
 * Everything is measured on the RENDERED GEOMETRY, not on the computation: the body outline
 * and each capsule are taken as the renderer draws them. That is the only way to check what
 * the eye sees, and it assumes nothing about the method used.
 */

const R = 100

/** A perfect circle, built inline: it is not in the catalogue, so it is not corrected either. */
const CIRCLE = new Array(PROFILE_SAMPLES).fill(1)

/**
 * Body outline, read off `bodyPath`. `closedPath` emits `M x y` then one `C` per point, so the
 * curve's points are the 3rd pair of each `C`.
 */
function bodyOutline(d: string) {
  const pts: Array<{ x: number; y: number }> = []
  for (const seg of d.slice(1).split('C')) {
    const n = seg.match(/-?\d+\.?\d*/g)?.map(Number) ?? []
    if (n.length >= 6) pts.push({ x: n[4]!, y: n[5]! })
    else if (n.length === 2) pts.push({ x: n[0]!, y: n[1]! })
  }
  return pts
}

/** Is the point inside the polygon? Ray casting. */
function inside(poly: Array<{ x: number; y: number }>, x: number, y: number) {
  let on = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) on = !on
  }
  return on
}

/**
 * A capsule's outline in screen space: a stadium, sampled then passed through the rendered
 * matrix. Its dimensions are re-read from the `d` that `capsulePath` produced
 * (`M-hw -hh+r A r r ...`), so the test depends only on the output.
 *
 * Thirty-two points suffice: on a 40-unit capsule they are less than three units apart, where
 * the smallest overflow ever measured is three.
 */
function eyeOutline(eye: RenderedEye, N = 32) {
  const g = eye.d.match(/-?\d+\.?\d*/g)!.map(Number)
  const hw = Math.abs(g[0]!)
  const r = Math.abs(g[2]!)
  const straight = Math.abs(g[1]!)
  const m = eye.matrix.match(/-?\d+\.?\d*/g)!.map(Number)
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < N; i++) {
    const u = (i / N) * 4
    let x: number
    let y: number
    if (u < 1) {
      const t = Math.PI * (u - 0.5)
      x = Math.cos(t) * r
      y = -straight + Math.sin(t) * r
    } else if (u < 2) {
      x = hw
      y = -straight + (u - 1) * 2 * straight
    } else if (u < 3) {
      const t = Math.PI * (u - 2 + 0.5)
      x = Math.cos(t) * r
      y = straight + Math.sin(t) * r
    } else {
      x = -hw
      y = straight - (u - 3) * 2 * straight
    }
    out.push({ x: a * x + c * y + e, y: b * x + d * y + f })
  }
  return out
}

/** Three seconds at twenty frames per second: enough for several blinks. */
const INSTANTS = 60
const STEP = 1 / 20

/**
 * How far the most overflowing capsule leaves the body, in viewBox units.
 *
 * Sweeps TIME and not only the combination. The gaze drift moves the eye by a dozen units, so a
 * single frame proves nothing.
 */
function overflow(state: StateId, radii: number[], expr: (typeof EXPRESSIONS)[number] | null) {
  const e = new BotEngine(R, state, radii, expr)
  let worst = 0
  for (let i = 0; i < INSTANTS; i++) {
    const f = e.sample(i * STEP)
    const body = bodyOutline(f.bodyPath)
    for (const eye of f.eyes) {
      for (const p of eyeOutline(eye)) {
        if (inside(body, p.x, p.y)) continue
        worst = Math.max(worst, Math.min(...body.map((q) => Math.hypot(q.x - p.x, q.y - p.y))))
      }
    }
  }
  return worst
}

/** The states whose body is replaceable by an identity shape. */
const BASE_BODY = STATES.filter((s) => s.baseBody).map((s) => s.id)
/** The others: their silhouette IS the animation, measured off the reference. */
const MEASURED_SILHOUETTE = STATES.filter((s) => !s.baseBody).map((s) => s.id)

describe('identity shapes', () => {
  // 680 combinations x 60 instants x two outlines: the heaviest test of the repo, and the only
  // one that proves what the eye sees.
  it('no shape lets an eye leave the silhouette', () => {
    const faulty: string[] = []
    for (const state of BASE_BODY) {
      for (const shape of SHAPES) {
        for (const expr of [null, ...EXPRESSIONS]) {
          const out = overflow(state, shape.radii, expr)
          if (out > 0.05) {
            faulty.push(`${state}/${shape.id}/${expr?.id ?? 'pose'} ${out.toFixed(1)}`)
          }
        }
      }
    }
    expect(faulty).toEqual([])
  }, 60_000)

  /**
   * A perfect circle is the profile measured on the reference and the default body: passing
   * one must change NOTHING compared with passing nothing. That guarantees the correction is
   * neutral on the reference — including its outer eye, which already grazes the edge and must
   * keep grazing it — and it is what an unknown profile (not in the catalogue) must do too.
   */
  it('a circle profile renders exactly like no shape at all', () => {
    for (const state of BASE_BODY) {
      for (const expr of [null, ...EXPRESSIONS]) {
        const withCircle = new BotEngine(R, state, CIRCLE, expr).sample(1)
        const without = new BotEngine(R, state, null, expr).sample(1)
        expect(withCircle.eyes, `${state}/${expr?.id ?? 'pose'}`).toEqual(without.eyes)
      }
      expect(eyeOffset(CIRCLE, state, null)).toEqual({ x: 0, y: 0 })
    }
  })

  /**
   * The profiles measured off the reference are not replaceable, so the chosen shape must not
   * reach them — neither their body nor their eyes. `orbit` is the case that matters: its eye
   * margin is tighter than the circle's and yet it is right, since it was measured that way. A
   * margin rule applied indiscriminately would move it.
   */
  it('the chosen shape does not touch the states with a measured silhouette', () => {
    for (const state of MEASURED_SILHOUETTE) {
      const bare = new BotEngine(R, state, null, null).sample(1)
      for (const shape of SHAPES) {
        const dressed = new BotEngine(R, state, shape.radii, null).sample(1)
        expect(dressed.eyes, `${state}/${shape.id}`).toEqual(bare.eyes)
        expect(dressed.bodyPath).toBe(bare.bodyPath)
      }
    }
  })

  /**
   * The correction must change NOTHING about the eye's size.
   *
   * A version scaled them along with the position: that preserved every ratio and stayed stable,
   * but the eyes became visibly smaller on a flat body, and changing expression then animated
   * that growth. It read as a defect.
   */
  it('the eye size does not depend on the shape', () => {
    const sizes = new Set(
      SHAPES.map((s) =>
        new BotEngine(R, 'idle', s.radii, null)
          .sample(1)
          .eyes.map((y) => y.d)
          .join('|')
      )
    )
    expect(sizes.size).toBe(1)
  })

  /**
   * The real trap: the correction must be INVISIBLE in motion.
   *
   * What is measured is the OSCILLATION and not the speed. A morph moves the eyes fast anyway —
   * expressions don't look at the same place — and that is wanted motion. Trembling is going and
   * COMING BACK. So direction changes are counted frame by frame and compared against the
   * circle, which the correction does not touch.
   *
   * The measure discriminates well: 0 to 1 round trip on the original engine, 4 to 14 with
   * backtracks up to 26 units on the versions that trembled.
   */
  it('the correction does not make the eyes oscillate', () => {
    const step = 1 / 60

    const trajectory = (build: () => BotEngine, duration = BotEngine.SHAPE_MORPH) => {
      const e = build()
      const out: Array<Array<{ x: number; y: number }>> = []
      for (let t = 0; t <= duration + step; t += step) {
        out.push(
          e.sample(t).eyes.map((eye) => {
            const n = eye.matrix.match(/-?\d+\.?\d*/g)!.map(Number)
            return { x: n[4]!, y: n[5]! }
          })
        )
      }
      return out
    }

    /** How many times an eye starts going back, and by how much at most. */
    const roundTrips = (frames: Array<Array<{ x: number; y: number }>>) => {
      let n = 0
      let amplitude = 0
      const eyes = Math.min(...frames.map((f) => f.length))
      for (let j = 0; j < eyes; j++) {
        let px = 0
        let py = 0
        for (let i = 1; i < frames.length; i++) {
          const dx = frames[i]![j]!.x - frames[i - 1]![j]!.x
          const dy = frames[i]![j]!.y - frames[i - 1]![j]!.y
          const len = Math.hypot(dx, dy)
          if (len <= 0.05) continue
          if ((px || py) && dx * px + dy * py < 0) {
            n++
            amplitude = Math.max(amplitude, len)
          }
          px = dx
          py = dy
        }
      }
      return { n, amplitude }
    }

    const shapeMorph = (radii: number[]) =>
      roundTrips(
        trajectory(() => {
          const e = new BotEngine(R, 'idle', CIRCLE, null)
          e.setShape(radii, 0)
          return e
        })
      )
    const atRest = (radii: number[]) =>
      roundTrips(trajectory(() => new BotEngine(R, 'idle', radii, null), 3))
    const expressionMorphs = (radii: number[]) =>
      EXPRESSIONS.map((expr) =>
        roundTrips(
          trajectory(() => {
            const e = new BotEngine(R, 'idle', radii, EXPRESSIONS[0]!)
            e.setExpression(expr, 0)
            return e
          })
        )
      ).reduce((a, b) => ({ n: a.n + b.n, amplitude: Math.max(a.amplitude, b.amplitude) }), {
        n: 0,
        amplitude: 0
      })

    /*
     * On the CIRCLE, none at all: the correction is zero there, so it can add no motion, and it
     * is the reference for the three comparisons.
     */
    expect(expressionMorphs(CIRCLE).n, 'circle: expression morphs').toBe(0)

    for (const shape of SHAPES) {
      /*
       * At rest the only thing moving is the gaze drift. A correction that followed it would
       * make the eyes tremble permanently: the most visible defect of all, and the first one
       * we had. What matters is the AMPLITUDE of the reversals — a direction change of a
       * twentieth of a unit on a ball of radius 100 is arithmetic, not an image; the versions
       * that trembled backtracked by up to 26 units — so both are bounded, the count with a
       * tolerance because the drift's own reversals land either side of a frame boundary
       * depending on where the shape puts the eye.
       */
      const rest = atRest(shape.radii)
      expect(rest.amplitude, `${shape.id}: drift at rest`).toBeLessThan(0.1)
      expect(rest.n, `${shape.id}: drift at rest`).toBeLessThanOrEqual(atRest(CIRCLE).n + 2)
      // A shape change moves the offset, but on the same curve as the silhouette: no more
      // round trips than the circle.
      expect(shapeMorph(shape.radii).n, `shape morph to ${shape.id}`).toBeLessThanOrEqual(
        shapeMorph(CIRCLE).n + 1
      )
      // An expression change takes the offset from one table entry to another; the bound lets
      // that through and nothing more (the faulty versions were at 26).
      expect(expressionMorphs(shape.radii).amplitude, `${shape.id}: expression morphs`).toBeLessThan(
        14
      )
    }
  }, 60_000)

  /**
   * The table is a module constant. It has to stay quick enough to build without weighing on the
   * first paint: that is the only cost this correction adds to the engine, which afterwards only
   * reads two entries and interpolates them.
   */
  it('the table builds in a few milliseconds', () => {
    const t = performance.now()
    FOR_TESTS.build()
    expect(performance.now() - t).toBeLessThan(1000)
  })
})
