import { describe, expect, it } from 'vitest'
import { BotEngine } from '../src/engine.js'
import { radiusAtAngle } from '../src/shape.js'
import { EXPRESSION_BY_ID } from '../src/expressions.js'
import { REST_GAZE } from '../src/face.js'
import { SHAPES, shapeRadii } from '../src/skins.js'
import { SEQUENCE, STATES, type StateId } from '../src/states.js'

/** Anchor points of a path produced by closedPath (control points ignored). */
function anchors(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const head = /^M(-?[\d.]+) (-?[\d.]+)/.exec(d)
  if (head) out.push([+head[1]!, +head[2]!])
  for (const seg of d.matchAll(/C[-\d. ]+? (-?[\d.]+) (-?[\d.]+)(?=C|Z)/g)) {
    out.push([+seg[1]!, +seg[2]!])
  }
  return out
}

function footprint(d: string) {
  const pts = anchors(d)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return {
    w: (Math.max(...xs) - Math.min(...xs)) / 100,
    h: (Math.max(...ys) - Math.min(...ys)) / 100
  }
}

/** Footprints measured on the reference (width x height, in ball diameters). */
const FOOTPRINTS: Array<[StateId, number, number, number, number]> = [
  // state,        date, width, height, tolerance
  ['idle', 0.5, 2.0, 2.0, 0.05],
  ['egg', 0.9, 1.653, 2.0, 0.06],
  ['hexagon', 0.9, 1.82, 2.01, 0.07],
  ['exclaim', 0.9, 0.263, 0.842, 0.03],
  ['alert', 0.8, 0.421, 0.753, 0.04],
  ['sleep', 0.6, 0.317, 0.317, 0.03],
  ['comet', 1.0, 0.258, 0.258, 0.03]
]

describe('silhouettes', () => {
  for (const [id, t, w, h, tol] of FOOTPRINTS) {
    it(`"${id}" has the footprint measured on the reference`, () => {
      const e = new BotEngine(100, id)
      const { w: gw, h: gh } = footprint(e.sample(t).bodyPath)
      expect(Math.abs(gw - w)).toBeLessThan(tol)
      expect(Math.abs(gh - h)).toBeLessThan(tol)
    })
  }

  it('the resting ball is a circle, not an oval', () => {
    const e = new BotEngine(100, 'idle')
    const { w, h } = footprint(e.sample(0.5).bodyPath)
    expect(Math.abs(w - h)).toBeLessThan(0.03)
  })

  it('the triangle is wider than tall, point up', () => {
    const e = new BotEngine(100, 'play')
    const { w, h } = footprint(e.sample(0.9).bodyPath)
    expect(w).toBeGreaterThan(h)
    expect(Math.abs(w - 1.99)).toBeLessThan(0.08)
  })
})

describe('engine', () => {
  it('is a pure function of time: two reads at the same date are identical', () => {
    const a = new BotEngine(100, 'orbit')
    const b = new BotEngine(100, 'orbit')
    expect(a.sample(1.3).bodyPath).toBe(b.sample(1.3).bodyPath)
    // and re-reading a past date gives the same image again
    const first = a.sample(0.7).bodyPath
    a.sample(2.5)
    expect(a.sample(0.7).bodyPath).toBe(first)
  })

  it('stays replayable DURING a fade between states', () => {
    // the trap: purging the previous state once the fade is over makes this date
    // unrecoverable, and the fade disappears on a re-read
    const e = new BotEngine(100, 'idle')
    e.setState('egg', 1)
    const during = e.sample(1.2).bodyPath
    e.sample(3)
    expect(e.sample(1.2).bodyPath).toBe(during)
  })

  it('does not fly off on a date before the state change', () => {
    const e = new BotEngine(100, 'idle')
    const before = e.sample(0.5).bodyPath
    e.setState('egg', 1)
    expect(e.sample(0.5).bodyPath).toBe(before)
  })

  it('actually animates: the shape evolves between two dates', () => {
    const e = new BotEngine(100, 'thinking')
    const paths = [0.1, 0.4, 0.8, 1.2].map((t) => e.sample(t).bodyPath)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('interpolates the silhouette during a transition, without a jump', () => {
    const e = new BotEngine(100, 'idle')
    e.setState('egg', 1)
    const widths = [1, 1.1, 1.2, 1.3, 1.4].map((t) => footprint(e.sample(t).bodyPath).w)
    // strictly decreasing: the ball shrinks towards the egg
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeLessThan(widths[i - 1]!)
    }
    expect(widths[0]!).toBeCloseTo(2, 1)
    expect(footprint(e.sample(2).bodyPath).w).toBeCloseTo(1.65, 1)
  })

  it('never lets the body leave the viewBox', () => {
    for (const s of STATES) {
      const e = new BotEngine(100, s.id)
      for (const t of [0.2, 0.9, 1.8, 3]) {
        const pts = anchors(e.sample(t).bodyPath)
        for (const [x, y] of pts) {
          expect(Math.abs(x)).toBeLessThan(158)
          expect(Math.abs(y)).toBeLessThan(158)
        }
      }
    }
  })
})

describe('identity shape', () => {
  const height = (e: BotEngine, t: number) => footprint(e.sample(t).bodyPath).h

  it('replaces the silhouette of the resting states', () => {
    const ball = new BotEngine(100, 'idle')
    const bean = new BotEngine(100, 'idle', shapeRadii('bean'))
    expect(bean.sample(1).bodyPath).not.toBe(ball.sample(1).bodyPath)
  })

  it('leaves untouched the states that draw their own shape', () => {
    for (const id of ['exclaim', 'alert', 'sleep', 'egg', 'hexagon'] as const) {
      const bare = new BotEngine(100, id)
      const dressed = new BotEngine(100, id, shapeRadii('bean'))
      expect(dressed.sample(1).bodyPath).toBe(bare.sample(1).bodyPath)
    }
  })

  it('morphs towards the new shape instead of jumping', () => {
    // a perfect circle is 2.0 high; the wedge is much flatter, so height is telling
    const circle = new Array(64).fill(1)
    const e = new BotEngine(100, 'idle', circle)
    const target = shapeRadii('wedge')!
    expect(height(e, 1)).toBeCloseTo(2, 1)
    e.setShape(target, 1)

    const steps = [1.06, 1.14, 1.26].map((t) => height(e, t))
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeLessThan(steps[i - 1]!)
    }
    expect(steps[0]!).toBeLessThan(2)

    // arrives after the morph's duration
    expect(height(e, 1 + BotEngine.SHAPE_MORPH + 0.05)).toBeCloseTo(
      footprint(new BotEngine(100, 'idle', target).sample(1).bodyPath).h,
      1
    )
  })

  it('stays a pure function of time during a shape morph', () => {
    const circle = new Array(64).fill(1)
    const e = new BotEngine(100, 'idle', circle)
    e.setShape(shapeRadii('orb'), 1)
    const middle = e.sample(1.1).bodyPath
    e.sample(3)
    expect(e.sample(1.1).bodyPath).toBe(middle)
  })

  it('keeps the eyes inside the silhouette on every identity shape', () => {
    for (const shape of SHAPES) {
      const f = new BotEngine(100, 'idle', shape.radii).sample(1)
      expect(f.eyes, shape.id).toHaveLength(2)
      for (const eye of f.eyes) {
        const parts = /matrix\(([^)]+)\)/.exec(eye.matrix)![1]!.split(',').map(Number)
        const ex = parts[4]!
        const ey = parts[5]!
        const edge = radiusAtAngle(shape.radii, Math.atan2(ey, ex)) * 100
        // the eye's centre stays frankly inside the outline
        expect(Math.hypot(ex, ey), shape.id).toBeLessThan(edge)
      }
    }
  })
})

describe('states', () => {
  /**
   * The sequence is the CATALOGUE: the 14 states measured off the reference. Any state
   * outside the sequence is an interface transition, chosen and not measured — it must never
   * appear in the catalogue, and that is what this checks.
   */
  it('keeps the 14 reference states in the sequence, and nothing else', () => {
    expect(SEQUENCE).toHaveLength(14)
    expect(new Set(SEQUENCE).size).toBe(14)
    for (const id of SEQUENCE) expect(STATES.some((s) => s.id === id), id).toBe(true)
  })

  it('keeps interface transitions out of the catalogue', () => {
    const outside = STATES.filter((s) => !SEQUENCE.includes(s.id)).map((s) => s.id)
    expect(outside).toEqual(['swirl'])
  })

  it('shows the face on the face states, hides it on the others', () => {
    const withFace: StateId[] = ['idle', 'wink', 'wide', 'notify', 'egg', 'hexagon']
    const without: StateId[] = ['thinking', 'alert', 'exclaim', 'sleep']
    for (const id of withFace) expect(new BotEngine(100, id).sample(0.9).eyes.length).toBe(2)
    for (const id of without) expect(new BotEngine(100, id).sample(0.9).eyes.length).toBe(0)
  })

  it('cuts a notch around the notification pastille', () => {
    const f = new BotEngine(100, 'notify').sample(1)
    expect(f.notif).not.toBeNull()
    expect(f.notch).not.toBeNull()
    // measured constant margin: 0.054 radius
    expect((f.notch!.r - f.notif!.r) / 100).toBeCloseTo(0.054, 2)
    // the pastille sits on the circumference
    expect(Math.hypot(f.notif!.x, f.notif!.y) / 100).toBeCloseTo(1.003, 1)
  })

  it('draws the rings both in front of and behind the body', () => {
    const f = new BotEngine(100, 'orbit').sample(1.4)
    expect(f.arcs.length).toBeGreaterThan(3)
    expect(f.arcs.some((a) => a.back.length > 0)).toBe(true)
    expect(f.arcs.some((a) => a.front.length > 0)).toBe(true)
  })

  it('spirals the particles towards the centre during the burst', () => {
    const e = new BotEngine(100, 'burst')
    const radius = (t: number) => {
      const d = e.sample(t).dots[0]
      return d ? Math.hypot(d.x, d.y) : 0
    }
    expect(radius(0.15)).toBeGreaterThan(radius(0.45))
    expect(radius(0.45)).toBeGreaterThan(0)
  })
})

describe('gaze that follows the pointer', () => {
  /** Abscissa of the inner eye, in viewBox px. */
  const eyeX = (e: BotEngine, t: number) =>
    +/matrix\([^,]+,[^,]+,[^,]+,[^,]+,(-?[\d.]+)/.exec(e.sample(t).eyes[0]!.matrix)![1]!

  /** Amplitude of its movement over a time range. */
  function amplitude(e: BotEngine, from: number, to: number) {
    const xs: number[] = []
    for (let t = from; t <= to; t += 0.1) xs.push(eyeX(e, t))
    return Math.max(...xs) - Math.min(...xs)
  }

  it('does not touch the gaze while no target is set', () => {
    const bare = new BotEngine(100, 'idle')
    const aimed = new BotEngine(100, 'idle')
    aimed.setLook(null, 0)
    expect(aimed.sample(1).eyes[0]!.matrix).toBe(bare.sample(1).eyes[0]!.matrix)
  })

  it('carries the gaze to the aimed yaw, in absolute terms', () => {
    const right = new BotEngine(100, 'idle')
    const left = new BotEngine(100, 'idle')
    right.setLook({ yaw: 45, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0)
    left.setLook({ yaw: -45, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0)
    const t = 1 + BotEngine.LOOK_MORPH
    expect(eyeX(right, t)).toBeGreaterThan(eyeX(left, t) + 40)
  })

  it('replaces the pose yaw instead of adding to it', () => {
    // Two expressions that differ ONLY by their yaw: an eye's abscissa also depends on pitch
    // and spacing, so varying them together would prove nothing.
    const model = EXPRESSION_BY_ID.get('neutre')!
    const lefty = { ...model, gaze: { ...model.gaze, yaw: -30 } }
    const righty = { ...model, gaze: { ...model.gaze, yaw: 60 } }
    const circle = new Array(64).fill(1)

    const a = new BotEngine(100, 'idle', circle, lefty)
    const b = new BotEngine(100, 'idle', circle, righty)
    // with no target, the two look frankly elsewhere
    expect(Math.abs(eyeX(a, 1) - eyeX(b, 1))).toBeGreaterThan(40)

    a.setLook({ yaw: -26, pitch: 0, mix: 1, spin: 0, wander: 0 }, 1)
    b.setLook({ yaw: -26, pitch: 0, mix: 1, spin: 0, wander: 0 }, 1)
    // ...and the same aimed yaw puts them in exactly the same place
    const t = 1 + BotEngine.LOOK_MORPH
    expect(eyeX(a, t)).toBeCloseTo(eyeX(b, t), 5)
  })

  it('travels the requested turn without changing the landing point', () => {
    const direct = new BotEngine(100, 'idle')
    const turned = new BotEngine(100, 'idle')
    direct.setLook({ yaw: -26, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0)
    turned.setLook({ yaw: -26, pitch: 0, mix: 1, spin: 360, wander: 0 }, 0)
    const t = 1 + BotEngine.LOOK_MORPH
    // a full turn is the same angle: the image must be identical to the pixel
    expect(turned.sample(t).eyes[0]!.matrix).toBe(direct.sample(t).eyes[0]!.matrix)
    // ...while half a turn puts the face away from the viewer
    const half = new BotEngine(100, 'idle')
    half.setLook({ yaw: -26, pitch: 0, mix: 1, spin: 180, wander: 0 }, 0)
    expect(half.sample(t).eyes).toHaveLength(0)
  })

  it('keeps both eyes visible at the extreme amplitudes', () => {
    // beyond these the outer eye passes behind the sphere's limb and the engine drops it
    for (const yaw of [-42, -26, -10]) {
      for (const pitch of [-3, 10, 23]) {
        const e = new BotEngine(100, 'idle')
        e.setLook({ yaw, pitch, mix: 1, spin: 0, wander: 0 }, 0)
        expect(e.sample(1).eyes, `yaw ${yaw} pitch ${pitch}`).toHaveLength(2)
      }
    }
  })

  it('puts out the automatic drift when the pointer commands', () => {
    const free = new BotEngine(100, 'idle')
    const held = new BotEngine(100, 'idle')
    held.setLook({ yaw: REST_GAZE.yaw, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0)

    // same target as the resting gaze: what is left of the movement is therefore ONLY the
    // drift. It must have died out, except for the body's float (+-0.006 radius).
    expect(amplitude(held, 1, 8)).toBeLessThan(2)
    expect(amplitude(free, 1, 8)).toBeGreaterThan(5 * amplitude(held, 1, 8))
  })

  it('returns to the state gaze when the target is released', () => {
    const bare = new BotEngine(100, 'idle')
    const e = new BotEngine(100, 'idle')
    e.setLook({ yaw: -20, pitch: -10, mix: 1, spin: 0, wander: 0 }, 0)
    e.sample(1)
    e.setLook(null, 1)
    // the return is progressive, then complete
    expect(eyeX(e, 1.05)).not.toBeCloseTo(eyeX(bare, 1.05), 1)
    const done = 1 + BotEngine.LOOK_MORPH
    expect(eyeX(e, done)).toBeCloseTo(eyeX(bare, done), 5)
  })

  it('stays a pure function of time during the catch-up', () => {
    const e = new BotEngine(100, 'idle')
    e.setLook({ yaw: -18, pitch: -8, mix: 1, spin: 0, wander: 0 }, 1)
    const middle = e.sample(1.1).eyes[0]!.matrix
    e.sample(3)
    expect(e.sample(1.1).eyes[0]!.matrix).toBe(middle)
  })

  it('leaves the drift intact on thumbnails, which never aim', () => {
    const e = new BotEngine(100, 'idle')
    expect(amplitude(e, 0, 6)).toBeGreaterThan(4)
  })
})

describe('gaze robustness', () => {
  it('refuses a non-finite target rather than remembering it', () => {
    /*
     * The engine KEEPS the last target: a `NaN` set once would propagate to every frame and
     * the bot would never rest again. Happened for real — a `getBoundingClientRect` on a
     * zero-sized box gives `0 / 0` in the caller.
     */
    const sane = new BotEngine(100, 'idle')
    const e = new BotEngine(100, 'idle')
    e.setLook({ yaw: NaN, pitch: 10, mix: 1, spin: 0, wander: 0 }, 0)
    expect(e.sample(1).eyes[0]!.matrix).toBe(sane.sample(1).eyes[0]!.matrix)

    // and a sane target set afterwards still works
    e.setLook({ yaw: -26, pitch: 10, mix: 1, spin: 0, wander: 0 }, 1)
    expect(e.sample(1 + BotEngine.LOOK_MORPH).eyes[0]!.matrix).not.toBe(
      sane.sample(1 + BotEngine.LOOK_MORPH).eyes[0]!.matrix
    )
  })

  it('keeps a turned head alive when no pointer commands it', () => {
    const eyeX = (e: BotEngine, t: number) =>
      +/matrix\([^,]+,[^,]+,[^,]+,[^,]+,(-?[\d.]+)/.exec(e.sample(t).eyes[0]!.matrix)![1]!
    const amplitude = (e: BotEngine) => {
      const xs: number[] = []
      for (let t = 1; t <= 8; t += 0.1) xs.push(eyeX(e, t))
      return Math.max(...xs) - Math.min(...xs)
    }

    const noPointer = new BotEngine(100, 'idle')
    noPointer.setLook({ yaw: -26, pitch: 10, mix: 1, spin: 0, wander: 1 }, 0)
    const withPointer = new BotEngine(100, 'idle')
    withPointer.setLook({ yaw: -26, pitch: 10, mix: 1, spin: 0, wander: 0 }, 0)

    // the head is turned in both cases...
    expect(eyeX(noPointer, 1)).toBeLessThan(0)
    expect(eyeX(withPointer, 1)).toBeLessThan(0)
    // ...but only the one nobody commands keeps drifting
    expect(amplitude(noPointer)).toBeGreaterThan(5 * amplitude(withPointer))
  })
})

/**
 * `reset`: restart on a state with NO history.
 *
 * A public method on what is meant to become an API, so it deserves its own test and not only
 * the indirect coverage of the offscreen player.
 */
describe('reset', () => {
  it('forgets the previous state, where setState keeps it to fade from', () => {
    const fading = new BotEngine(100, 'idle')
    fading.setState('egg', 0)
    const reset = new BotEngine(100, 'idle')
    reset.reset('egg', 0)

    // at the start of the morph one still blends the rest, the other already is the egg
    expect(fading.sample(0).bodyPath).not.toBe(reset.sample(0).bodyPath)
    // and the egg alone is what a fresh engine on `egg` gives
    expect(reset.sample(0).bodyPath).toBe(new BotEngine(100, 'egg').sample(0).bodyPath)
  })

  /*
   * Compared at an equal ABSOLUTE date, not a pose dated 0 against one dated 5: the resting
   * drift depends on absolute time, so two different dates never give the same path, even on a
   * state whose pose is fixed. The comparison would say nothing.
   */
  it('dates the state where you tell it to', () => {
    const early = new BotEngine(100, 'idle')
    early.reset('alert', 0)
    const late = new BotEngine(100, 'idle')
    late.reset('alert', 5)
    // the "!" travels: at the same absolute date one is 5 s in, the other at the start
    expect(early.sample(5).bodyPath).not.toBe(late.sample(5).bodyPath)
    expect(late.state).toBe('alert')
  })

  it('leaves sample a pure function of time', () => {
    const e = new BotEngine(100, 'idle')
    e.reset('orbit', 0)
    const early = e.sample(0.3).bodyPath
    e.sample(9)
    expect(e.sample(0.3).bodyPath).toBe(early)
  })
})

/**
 * A state change landing DURING a fade.
 *
 * The engine keeps one history slot, so the new blend's origin used to become the FULL pose
 * of the state being left, instead of the partly blended frame on screen: a jump. It now
 * blends from the composite pose frozen at the moment of the change.
 *
 * Measured: the displacement of one eye over the two frames following a change. A SPACED
 * change produces 10 to 14 px, and that is wanted — the measured easeOutQuint starts steep.
 * What was not wanted is the 26 to 43 px of a change inside a fade.
 */
describe('state change during a fade', () => {
  const FRAME = 1 / 60

  /** Max displacement of one eye over the two frames following `at`. */
  function jumpAfter(changes: Array<[StateId, number]>, at: number) {
    const e = new BotEngine(100, 'idle')
    const distances: Array<{ t: number; d: number[] }> = []
    let i = 0
    for (let t = 0; t <= at + 4 * FRAME; t += FRAME) {
      while (i < changes.length && changes[i]![1] <= t + 1e-9) {
        e.setState(changes[i]![0], changes[i]![1])
        i++
      }
      distances.push({
        t,
        d: e.sample(t).eyes.map((y) => {
          const n = y.matrix.match(/-?\d+\.?\d*/g)!.map(Number)
          return Math.hypot(n[4]!, n[5]!)
        })
      })
    }
    let worst = 0
    for (let k = 1; k < distances.length; k++) {
      const a = distances[k - 1]!
      const b = distances[k]!
      if (a.d.length !== b.d.length || b.t <= at || b.t > at + 2.5 * FRAME) continue
      worst = Math.max(worst, ...a.d.map((v, j) => Math.abs(v - b.d[j]!)))
    }
    return worst
  }

  /** Reference: the same change, but spaced out. That is normal motion. */
  const NORMAL = 14

  it('does not jump more than a spaced change', () => {
    const spaced = jumpAfter([['wide', 0.5], ['idle', 2]], 2)
    expect(spaced).toBeLessThan(NORMAL)

    // 100 ms after the first, hence inside a 0.55 s fade
    expect(jumpAfter([['wide', 0.5], ['idle', 0.6]], 0.6)).toBeLessThanOrEqual(spaced)
  })

  it('holds up over chained changes', () => {
    const suite: Array<[StateId, number]> = [
      ['wide', 0.5],
      ['idle', 0.55],
      ['egg', 0.6],
      ['orbit', 0.65],
      ['notify', 0.7]
    ]
    for (const [, at] of suite.slice(1)) {
      expect(jumpAfter(suite, at), `change at ${at}s`).toBeLessThan(NORMAL)
    }
  })

  /**
   * And SPACED playback does not change: blocks of a montage last at least the longest fade,
   * so nothing is ever frozen there. Verified frame by frame, which is what protects the
   * measured animations.
   */
  it('changes nothing to a spaced playback', () => {
    const suite: Array<[StateId, number]> = [
      ['thinking', 1],
      ['wink', 2],
      ['alert', 3]
    ]
    const withHistory = new BotEngine(100, 'idle')
    let i = 0
    const frames: string[] = []
    for (let t = 0; t < 4; t += FRAME) {
      while (i < suite.length && suite[i]![1] <= t + 1e-9) {
        withHistory.setState(suite[i]![0], suite[i]![1])
        i++
      }
      frames.push(withHistory.sample(t).bodyPath)
    }
    // no empty frame, and alert's "!" still moves while it fades
    expect(frames.every((p) => p.length > 0)).toBe(true)
    expect(new Set(frames.slice(-12)).size).toBeGreaterThan(1)
  })
})
