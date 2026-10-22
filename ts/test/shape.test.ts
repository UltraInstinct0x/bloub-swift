import { describe, expect, it } from 'vitest'
import { TAU } from '../src/math.js'
import { PROFILE_SAMPLES } from '../src/profiles.js'
import { radiusAtAngle, silhouette } from '../src/shape.js'
import { SHAPES } from '../src/skins.js'

/**
 * `radiusAtAngle`, the function that re-anchors everything placed "on" the body — the eyes
 * and the notification pastille.
 *
 * It has no business being simplified: the engine calls it as `atan2(y, x) - pose.sil.rot`
 * and `orbit` pushes `rot` to about -30 rad, so its argument leaves `[0, 2*PI)` by a long
 * way. Any simplification of its double modulo would detach the eyes from the silhouette
 * during the orbit, which is exactly the failure this function exists to avoid.
 */

/** A frankly non-circular profile: on a circle every angle would give 1. */
const TRIANGLE = silhouette('triangle').radii

describe('radiusAtAngle', () => {
  it('returns the profile radius, not a constant', () => {
    const seen = new Set(Array.from({ length: 16 }, (_, i) => radiusAtAngle(TRIANGLE, (i / 16) * TAU)))
    expect(seen.size).toBeGreaterThan(8)
  })

  it('wraps negative angles', () => {
    expect(radiusAtAngle(TRIANGLE, -0.1)).toBeCloseTo(radiusAtAngle(TRIANGLE, TAU - 0.1), 12)
    expect(radiusAtAngle(TRIANGLE, -1)).toBeCloseTo(radiusAtAngle(TRIANGLE, TAU - 1), 12)
  })

  /** The `orbit` case: several turns in the negative. That is what the double modulo is for. */
  it('wraps over several turns, both ways', () => {
    for (const base of [-30, -12.5, 7.3]) {
      for (const turns of [-3, -1, 1, 5]) {
        expect(radiusAtAngle(TRIANGLE, base), `base=${base} turns=${turns}`).toBeCloseTo(
          radiusAtAngle(TRIANGLE, base + turns * TAU),
          10
        )
      }
    }
  })

  it('is continuous through zero', () => {
    expect(radiusAtAngle(TRIANGLE, -1e-9)).toBeCloseTo(radiusAtAngle(TRIANGLE, 1e-9), 8)
    expect(radiusAtAngle(TRIANGLE, 0)).toBeCloseTo(TRIANGLE[0]!, 12)
  })
})

/**
 * The identity silhouettes are built analytically, never through the generator that produced
 * `profiles.ts`. Nothing would otherwise check their sampling.
 *
 * `blend` interpolates by INDEX and falls back to `?? 1` when an index is missing, so a shape
 * built with a different sample count morphs silently towards a unit circle instead of
 * failing. It would be right at rest and wrong in every transition — the worst of both
 * worlds, because nobody thinks to look at a morph.
 */
describe('identity silhouettes', () => {
  it('all share the same angular sampling, finite and positive', () => {
    for (const shape of SHAPES) {
      expect(shape.radii, shape.id).toHaveLength(PROFILE_SAMPLES)
      for (const [i, r] of shape.radii.entries()) {
        expect(Number.isFinite(r), `${shape.id}[${i}] = ${r}`).toBe(true)
        expect(r, `${shape.id}[${i}]`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * Wide bounds, only there to catch an aberrant shape: a radius under 0.3 would push the
   * eyes out, one beyond 1.6 would leave the viewBox. They are not measurements, they are the
   * domain in which the rest of the package makes sense.
   */
  it('stay inside the domain where the rest of the engine holds', () => {
    for (const shape of SHAPES) {
      const min = Math.min(...shape.radii)
      const max = Math.max(...shape.radii)
      expect(min, `${shape.id} min`).toBeGreaterThan(0.3)
      expect(max, `${shape.id} max`).toBeLessThan(1.6)
    }
  })

  it('are eight distinct silhouettes', () => {
    expect(SHAPES).toHaveLength(8)
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(8)
    const signatures = new Set(SHAPES.map((s) => s.radii.map((r) => r.toFixed(4)).join(',')))
    expect(signatures.size).toBe(8)
  })
})
