import { round6 } from '../src/math.js'
import type { BotFrame, Look } from '../src/engine.js'
import { engineForAvatar } from '../src/status.js'
import { EXPRESSION_BY_ID, type ExpressionId } from '../src/expressions.js'
import { shapeRadii, type ShapeId } from '../src/skins.js'
import type { BotEngine } from '../src/engine.js'
import type { StateId } from '../src/states.js'

/**
 * The golden set's case list, shared by the generator and the verifier.
 *
 * A golden file is the cross-language contract: the TypeScript engine writes it, the Swift
 * port reads it, and both must reproduce the same numbers. So the case list lives here, in
 * one place, and neither side may invent its own.
 */

/**
 * The profile ids of the eight identity cases. They are the real ones we ship — including the
 * four the design note names — so a golden mismatch is a real bot changing its face, not a
 * synthetic case nobody looks at.
 */
export const IDENTITY_IDS = [
  'hermesbot',
  'appdev',
  'health',
  'scout',
  'goku',
  'retro',
  'cron',
  'paperclip'
] as const

/** An operation applied to a fresh engine before sampling, dated as the engine expects. */
export type SetupOp =
  | { kind: 'state'; state: StateId; at: number }
  | { kind: 'look'; look: Look; at: number }
  | { kind: 'shape'; shape: ShapeId; at: number }
  | { kind: 'expression'; expression: ExpressionId; at: number }

export interface FrameCase {
  id: string
  profileId: string
  /** absolute dates to sample, in seconds */
  t: number[]
  /** applied in order, before any sampling */
  setup: SetupOp[]
}

/**
 * Twelve cases: the resting state, the loops a status maps to, the two states that collapse
 * the body, an interface transition, a fade between two states, a gaze catch-up, and a shape
 * and expression morph. Together they exercise every branch of `sample`.
 */
export const FRAME_CASES: FrameCase[] = [
  { id: 'hermesbot/idle', profileId: 'hermesbot', t: [0, 0.9, 4.4], setup: [] },
  { id: 'hermesbot/orbit', profileId: 'hermesbot', t: [0, 1.2, 2.8], setup: [{ kind: 'state', state: 'orbit', at: 0 }] },
  { id: 'appdev/thinking', profileId: 'appdev', t: [0, 0.7, 1.9], setup: [{ kind: 'state', state: 'thinking', at: 0 }] },
  { id: 'appdev/burst', profileId: 'appdev', t: [0.2, 0.9, 2.2], setup: [{ kind: 'state', state: 'burst', at: 0 }] },
  { id: 'health/sleep', profileId: 'health', t: [0.3, 1.5], setup: [{ kind: 'state', state: 'sleep', at: 0 }] },
  { id: 'scout/comet', profileId: 'scout', t: [0.4, 1.3, 2.3], setup: [{ kind: 'state', state: 'comet', at: 0 }] },
  { id: 'scout/wide', profileId: 'scout', t: [0.5, 1.4], setup: [{ kind: 'state', state: 'wide', at: 0 }] },
  { id: 'goku/notify', profileId: 'goku', t: [0.35, 1.1], setup: [{ kind: 'state', state: 'notify', at: 0 }] },
  // a fade, sampled inside and after it: the frozen-composite path
  { id: 'appdev/idle-to-egg', profileId: 'appdev', t: [0.45, 0.6, 1.2], setup: [{ kind: 'state', state: 'egg', at: 0.4 }] },
  // the gaze catch-up: pointer-driven, drift off, absolute yaw
  { id: 'scout/look', profileId: 'scout', t: [0.2, 0.5], setup: [{ kind: 'look', look: { yaw: -20, pitch: 10, mix: 1, spin: 0, wander: 0 }, at: 0 }] },
  // a shape morph mid-flight, then settled
  { id: 'health/shape-morph', profileId: 'health', t: [0.1, 0.3, 0.8], setup: [{ kind: 'shape', shape: 'pentagon', at: 0.05 }] },
  // an expression morph mid-flight, then settled
  { id: 'retro/expression-morph', profileId: 'retro', t: [0.1, 0.3, 0.8], setup: [{ kind: 'expression', expression: 'colere', at: 0.05 }] }
]

/**
 * Rounds every number in a frame to 1e-6 and normalises -0.
 *
 * Applied by BOTH the generator and the test, so the comparison is on the stored precision and
 * a value that differs only beyond 1e-6 (a different `Math.sin` implementation, say) is not
 * treated as a failure. Paths and matrices are already strings rounded to two decimals by the
 * engine.
 */
export function roundFrame(frame: BotFrame): BotFrame {
  return roundNumbers(frame) as BotFrame
}

/** Rounds every number of an arbitrary JSON-able value to 1e-6 and normalises -0. */
export function roundNumbers(value: unknown): unknown {
  return deepRound(value)
}

/**
 * The engine a frame case describes: the bot's real identity wiring (shape, resting
 * expression), started on `idle`, then the case's operations applied in order.
 *
 * Both the generator and the verifier call THIS, so a golden can never encode a different
 * construction than the one the tests check.
 */
export function buildCase(c: FrameCase): BotEngine {
  const e = engineForAvatar(c.profileId, 'idle', { now: 0 })
  for (const op of c.setup) {
    switch (op.kind) {
      case 'state':
        e.setState(op.state, op.at)
        break
      case 'look':
        e.setLook(op.look, op.at)
        break
      case 'shape': {
        const radii = shapeRadii(op.shape)
        if (!radii) throw new Error(`unknown shape id: ${op.shape}`)
        e.setShape(radii, op.at)
        break
      }
      case 'expression': {
        const expr = EXPRESSION_BY_ID.get(op.expression)
        if (!expr) throw new Error(`unknown expression id: ${op.expression}`)
        e.setExpression(expr, op.at)
        break
      }
    }
  }
  return e
}

function deepRound(value: unknown): unknown {
  if (typeof value === 'number') return round6(value)
  if (Array.isArray(value)) return value.map(deepRound)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[k] = deepRound(v)
    }
    return out
  }
  return value
}
