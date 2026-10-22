import { describe, expect, it } from 'vitest'
import { BotEngine } from '../src/engine.js'
import { EXPRESSIONS, EXPRESSION_BY_ID, blendExpression } from '../src/expressions.js'
import { radiusAtAngle } from '../src/shape.js'
import { shapeRadii } from '../src/skins.js'

const orb = () => shapeRadii('orb')!

/** Rendered eye matrix -> position, screen dimensions and major-axis angle. */
function rendered(matrix: string, w: number, h: number) {
  const [a, b, c, d, e, f] = /matrix\(([^)]+)\)/.exec(matrix)![1]!.split(',').map(Number) as number[]
  return {
    x: e!,
    y: f!,
    width: Math.hypot(a!, b!) * w,
    height: Math.hypot(c!, d!) * h,
    axis: (Math.atan2(d!, c!) * 180) / Math.PI - 90
  }
}

describe('expression catalogue', () => {
  it('exposes 16 expressions with unique ids', () => {
    expect(EXPRESSIONS).toHaveLength(16)
    expect(new Set(EXPRESSIONS.map((e) => e.id)).size).toBe(16)
    expect(EXPRESSION_BY_ID.size).toBe(16)
  })

  /**
   * The trap fallen into once: an eye whose width/height ratio approaches 1 is a circle, it
   * looks the same at any angle and its tilt is invisible. Any expression relying on a tilt
   * must therefore have frankly elongated eyes.
   */
  it('only tilts eyes elongated enough for the tilt to show', () => {
    for (const e of EXPRESSIONS) {
      for (const eye of e.eyes) {
        const tilt = Math.abs(eye.tilt ?? 0)
        if (tilt < 1) continue
        const ratio = eye.w / eye.h
        const threshold = tilt >= 20 ? [0.6, 1.7] : [0.8, 1.25]
        expect(
          ratio < threshold[0]! || ratio > threshold[1]!,
          `${e.id}: ratio ${ratio.toFixed(2)} too close to 1 for a ${tilt}deg tilt`
        ).toBe(true)
      }
    }
  })

  it('tilts anger and sadness in mirror, and in opposite senses', () => {
    const angles = (id: string) => {
      const expr = EXPRESSION_BY_ID.get(id)!
      const f = new BotEngine(100, 'idle', orb(), expr).sample(1)
      return f.eyes.map((eye, i) => rendered(eye.matrix, expr.eyes[i]!.w, expr.eyes[i]!.h).axis)
    }
    const anger = angles('colere')
    const sad = angles('triste')
    // mirrored: the two eyes lean opposite ways
    expect(Math.sign(anger[0]!)).toBe(-Math.sign(anger[1]!))
    expect(Math.sign(sad[0]!)).toBe(-Math.sign(sad[1]!))
    // and the two emotions are inverted relative to each other
    expect(Math.sign(anger[0]!)).toBe(-Math.sign(sad[0]!))
  })

  it('keeps both eyes inside the silhouette, across the 16 expressions', () => {
    for (const e of EXPRESSIONS) {
      const f = new BotEngine(100, 'idle', orb(), e).sample(1)
      expect(f.eyes, e.id).toHaveLength(2)
      for (let i = 0; i < 2; i++) {
        const r = rendered(f.eyes[i]!.matrix, e.eyes[i]!.w, e.eyes[i]!.h)
        // half-diagonal of the eye: the farthest corner must stay inside
        const half = Math.hypot(r.width, r.height) / 2
        const edge = radiusAtAngle(orb(), Math.atan2(r.y, r.x)) * 100
        expect(Math.hypot(r.x, r.y) + half, `${e.id} eye ${i}`).toBeLessThan(edge * 1.02)
      }
    }
  })
})

describe('changing expression', () => {
  it('interpolates the geometry monotonically', () => {
    // Measured on blendExpression, not on the render: the resting gaze drift makes the
    // projection vary, so the on-screen height would not be monotone even when the
    // interpolation is.
    const from = EXPRESSION_BY_ID.get('neutre')!
    const to = EXPRESSION_BY_ID.get('effraye')!
    const heights = [0, 0.25, 0.5, 0.75, 1].map((t) => blendExpression(from, to, t).eyes[0]!.h)
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!)
    }
    expect(heights[0]!).toBeCloseTo(from.eyes[0]!.h, 5)
    expect(heights[4]!).toBeCloseTo(to.eyes[0]!.h, 5)
  })

  it('slides to the new expression instead of jumping', () => {
    const target = EXPRESSION_BY_ID.get('effraye')!
    const e = new BotEngine(100, 'idle', orb(), EXPRESSION_BY_ID.get('neutre')!)
    e.setExpression(target, 1)

    // just after the change, the eye does not yet have the target's shape...
    const early = e.sample(1.02).eyes[0]!.d
    const arrived = new BotEngine(100, 'idle', orb(), target).sample(1).eyes[0]!.d
    expect(early).not.toBe(arrived)
    // ...and it has it once the morph is over
    expect(e.sample(1 + BotEngine.SHAPE_MORPH + 0.05).eyes[0]!.d).toBe(arrived)
  })

  it('stays a pure function of time during the morph', () => {
    const e = new BotEngine(100, 'idle', orb(), EXPRESSION_BY_ID.get('neutre')!)
    e.setExpression(EXPRESSION_BY_ID.get('colere')!, 1)
    const middle = e.sample(1.12).eyes[0]!.matrix
    e.sample(3)
    expect(e.sample(1.12).eyes[0]!.matrix).toBe(middle)
  })

  it('only applies the expression to the resting state', () => {
    const expr = EXPRESSION_BY_ID.get('effraye')!
    // wink has its own face, measured off the reference: it must survive
    const bare = new BotEngine(100, 'wink', orb()).sample(1)
    const dressed = new BotEngine(100, 'wink', orb(), expr).sample(1)
    expect(dressed.eyes[0]!.d).toBe(bare.eyes[0]!.d)

    const rest = new BotEngine(100, 'idle', orb(), expr).sample(1)
    const restBare = new BotEngine(100, 'idle', orb()).sample(1)
    expect(rest.eyes[0]!.d).not.toBe(restBare.eyes[0]!.d)
  })

  it('interpolates every component, tilt included', () => {
    const a = EXPRESSION_BY_ID.get('colere')!
    const b = EXPRESSION_BY_ID.get('triste')!
    const m = blendExpression(a, b, 0.5)
    expect(m.eyes[0]!.tilt).toBeCloseTo(((a.eyes[0]!.tilt ?? 0) + (b.eyes[0]!.tilt ?? 0)) / 2, 5)
    expect(m.split).toBeCloseTo((a.split + b.split) / 2, 5)
    expect(m.gaze.pitch).toBeCloseTo((a.gaze.pitch + b.gaze.pitch) / 2, 5)
  })
})
