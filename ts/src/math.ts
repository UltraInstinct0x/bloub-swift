export const TAU = Math.PI * 2

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export type Easing = (t: number) => number

/**
 * Measured on the reference footage: transitions are exponential ease-outs and the
 * body never overshoots. The only spring effects are local (the notification
 * pastille's pop, the eye opening) and are written into the state that needs them.
 *
 * Ported unchanged from bloub (MIT, Jeremy Perret): the curve is a measurement, not
 * a preference.
 */
export const easings = {
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutQuint: (t: number) => 1 - (1 - t) ** 5
} satisfies Record<string, Easing>

/** Seamless 1D periodic noise: loops without a seam on `period`, used for gaze drift. */
export function loopNoise(t: number, period: number, seed = 0): number {
  const p = (t / period) * TAU
  return (
    0.55 * Math.sin(p + seed) +
    0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) +
    0.15 * Math.sin(3 * p + seed * 2.3 + 2.4)
  )
}

/** Deterministic PRNG (mulberry32): the same sequence on every read. */
export function createRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 32-bit FNV-1a. Used for identity seeds; stable across languages and platforms. */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // 32-bit unsigned multiply by the FNV prime (0x01000193) without losing bits
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/** Short rounding: roughly halves the weight of path strings generated at 60 fps. */
export const r2 = (v: number) => Math.round(v * 100) / 100

/** Round to 1e-6 and normalise -0 to 0. Golden frames are stored at this precision. */
export function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return r === 0 ? 0 : r
}
