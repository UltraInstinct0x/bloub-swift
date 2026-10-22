import { describe, expect, it } from 'vitest'
import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, eyePoses, type HeadGaze } from '../src/face.js'

/**
 * Values measured frame by frame on the reference (units: ball radius = 1, y down). The
 * sphere model must reproduce them: that is what guarantees the eye near the edge is
 * compressed exactly as in the original.
 */
const MEASUREMENTS: Array<{
  name: string
  gaze: HeadGaze
  split: number
  w: number
  h: number
  eyes: Array<{ x: number; y: number; short: number; long: number }>
}> = [
  {
    name: 'rest',
    gaze: REST_GAZE,
    split: EYE_SPLIT,
    w: EYE_W,
    h: EYE_H,
    eyes: [
      { x: 0.189, y: -0.412, short: 0.178, long: 0.39 },
      { x: 0.614, y: -0.51, short: 0.12, long: 0.395 }
    ]
  },
  {
    name: 'wide eyes',
    gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
    split: 18.43,
    w: 0.356,
    h: 0.875,
    eyes: [
      { x: -0.198, y: 0.295, short: 0.353, long: 0.82 },
      { x: 0.412, y: 0.415, short: 0.315, long: 0.826 }
    ]
  },
  {
    name: 'notification',
    gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
    split: 18.89,
    w: 0.505,
    h: 0.498,
    eyes: [
      { x: -0.675, y: 0.172, short: 0.39, long: 0.495 },
      { x: -0.059, y: 0.027, short: 0.495, long: 0.5 }
    ]
  }
]

const short = (e: ReturnType<typeof eyePoses>[number], w: number) => Math.hypot(e.a, e.b) * w
const long = (e: ReturnType<typeof eyePoses>[number], h: number) => Math.hypot(e.c, e.d) * h

describe('eyes placed on a sphere', () => {
  for (const m of MEASUREMENTS) {
    it(`reproduces the "${m.name}" pose measured on the reference`, () => {
      const poses = eyePoses(m.gaze, 1, m.split)
      for (let i = 0; i < 2; i++) {
        const p = poses[i]!
        const want = m.eyes[i]!
        // 0.04 radius = ~7 px on the 190 px ball of the reference
        expect(p.x).toBeCloseTo(want.x, 1)
        expect(p.y).toBeCloseTo(want.y, 1)
        expect(Math.abs(short(p, m.w) - want.short)).toBeLessThan(0.04)
        expect(Math.abs(long(p, m.h) - want.long)).toBeLessThan(0.04)
      }
    })
  }

  it('compresses the eye exactly by the sphere depth factor', () => {
    // Exact invariant: the determinant of the projected tangent frame equals z. That is what
    // makes the eye's area follow the curvature (measured: 0.663).
    for (const e of eyePoses(REST_GAZE, 1)) {
      expect(e.a * e.d - e.b * e.c).toBeCloseTo(e.depth, 6)
    }
    const [near, far] = eyePoses(REST_GAZE, 1)
    expect(far.depth / near.depth).toBeCloseTo(0.663, 1)
    // measured width on the reference: 0.120 / 0.178 = 0.674
    expect(short(far, EYE_W) / short(near, EYE_W)).toBeCloseTo(0.674, 1)
  })

  it('keeps the same length for both eyes (tangential axis undeformed)', () => {
    const [a, b] = eyePoses(REST_GAZE, 1)
    expect(long(a, EYE_H)).toBeCloseTo(long(b, EYE_H), 3)
  })

  it('preserves the 31 degree angular separation whatever the gaze', () => {
    for (const gaze of [REST_GAZE, { yaw: -40, pitch: 10, roll: 5 }, { yaw: 0, pitch: 0, roll: 0 }]) {
      const [a, b] = eyePoses(gaze, 1)
      const dot = a.x * b.x + a.y * b.y + a.depth * b.depth
      expect((Math.acos(dot) * 180) / Math.PI).toBeCloseTo(EYE_SPLIT * 2, 4)
    }
  })

  it('sends an eye behind the sphere when the head turns hard', () => {
    const [, far] = eyePoses({ yaw: 80, pitch: 0, roll: 0 }, 1)
    expect(far.depth).toBeLessThan(0)
  })
})
