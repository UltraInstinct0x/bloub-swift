import { describe, expect, it } from 'vitest'
import { createRng, easings, fnv1a32, loopNoise, r2, round6, TAU } from '../src/math.js'

describe('fnv1a32', () => {
  /* Reference values of the FNV-1a 32-bit test vectors: if these drift, every seed
   * downstream changes and the golden identity set is meaningless. */
  it('reproduces the reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })

  it('stays in the unsigned 32-bit range', () => {
    for (const s of ['x', 'hermes-avatar/v1:', 'a'.repeat(500), '\u00e7\u00fc\u015f']) {
      const h = fnv1a32(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(2 ** 32)
    }
  })

  it('separates the profile ids we ship', () => {
    const ids = ['hermesbot', 'appdev', 'health', 'scout', 'goku', 'retro', 'cron', 'paperclip']
    expect(new Set(ids.map((id) => fnv1a32('hermes-avatar/v1:' + id))).size).toBe(ids.length)
  })
})

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('stays in [0, 1)', () => {
    const rnd = createRng(0xdeadbeef)
    for (let i = 0; i < 5000; i++) {
      const v = rnd()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('gives different sequences for neighbouring seeds', () => {
    const a = createRng(1)()
    const b = createRng(2)()
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6)
  })
})

describe('easings', () => {
  it('anchors the ease-out curves at 0 and 1 without overshoot', () => {
    for (const fn of [easings.easeOutCubic, easings.easeOutQuint, easings.easeInOutCubic]) {
      expect(fn(0)).toBeCloseTo(0, 12)
      expect(fn(1)).toBeCloseTo(1, 12)
      for (let t = 0; t <= 1; t += 0.01) {
        expect(fn(t)).toBeGreaterThanOrEqual(-1e-12)
        expect(fn(t)).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
  })

  it('starts fast for an ease-out, which is what the reference measures', () => {
    expect(easings.easeOutQuint(0.2)).toBeGreaterThan(0.6)
  })
})

describe('loopNoise', () => {
  it('is seamless on its period', () => {
    for (const period of [3.7, 11.3]) {
      expect(loopNoise(0, period, 0.4)).toBeCloseTo(loopNoise(period, period, 0.4), 10)
    }
  })

  it('stays within the bounds the eye-offset solver relies on', () => {
    for (let t = 0; t < 200; t += 0.013) {
      expect(Math.abs(loopNoise(t, 11.3, 0.4))).toBeLessThanOrEqual(1)
    }
  })
})

describe('rounding', () => {
  it('r2 keeps two decimals', () => {
    expect(r2(1.23456)).toBe(1.23)
    // JS rounds halves towards +Infinity, which is why the avatar paths never emit -0.01
    // from -0.005: they emit -0, normalised to 0 by round6.
    expect(r2(-0.006)).toBe(-0.01)
  })

  it('round6 normalises negative zero, so goldens never differ by -0', () => {
    expect(round6(-1e-12)).toBe(0)
    expect(Object.is(round6(-1e-12), -0)).toBe(false)
    expect(round6(1.23456789)).toBe(1.234568)
  })

  it('TAU is a full turn', () => {
    expect(TAU).toBeCloseTo(6.283185307179586, 12)
  })
})
