import { SEQUENCE, STATES, STATE_BY_ID, type StateId } from './states.js'

/**
 * A cycle is a montage: a list of blocks, each a state held for a chosen duration. This is
 * the editor part of the package, and it keeps its rules — pure data, no clock, no
 * framework import: the same cycle must be readable by the tests, the player and the
 * timeline.
 *
 * A block has no identifier: it is a position in a list, and the render key is the index.
 * That keeps the stored JSON readable and the tests deterministic.
 */
export interface Block {
  state: StateId
  duration: number
}

export interface Cycle {
  id: string
  name: string
  blocks: Block[]
}

/**
 * Floor common to every block. The engine keeps only one history slot (`setState`
 * overwrites `prev`), so a block shorter than the next block's entry fade would jump to the
 * image instead of blending into it.
 *
 * DERIVED from the catalogue rather than written by hand: a hard-coded 0.6 only worked
 * because 0.6 happened to be the longest `morph` (`orbit`). Nothing guaranteed it, and a
 * state morphing over 0.8 s would have made the editor tremble without a test noticing.
 */
export const MIN_BLOCK = Math.max(...STATES.map((s) => s.morph))

/**
 * Editor guard, not a measurement: lengthening a block is harmless (states saturate their
 * ramps and hold their final pose), but a track of one-minute blocks is no longer readable.
 */
export const MAX_BLOCK = 10

/**
 * How many blocks and montages are accepted, when editing and when reading back.
 *
 * Not product limits but bounds against hostile storage, which is editable and holds a few
 * megabytes while nothing downstream is dimensioned for it: one cycle of 150 000 blocks,
 * about 4 MB of JSON, yields 1 500 000 s of duration, as many ticks to allocate and a
 * 29 700 000 px wide track. 200 blocks make half an hour of montage, well beyond any use.
 */
export const MAX_BLOCS = 200
export const MAX_CYCLES = 50

/** Step of the wheel and of resizing, in seconds. */
export const STEP = 0.1

const DEFAULT_CYCLE_ID = 'defaut'

/** Minimum duration of a block: the engine floor, or the state's measurement. */
export function minDurationOf(state: StateId): number {
  return Math.max(MIN_BLOCK, STATE_BY_ID.get(state)?.minDuration ?? MIN_BLOCK)
}

/** Brings a duration into its bounds and onto the step, without float residue. */
export function clampDuration(state: StateId, seconds: number): number {
  const snapped = Math.round(seconds / STEP) * STEP
  const bounded = Math.min(MAX_BLOCK, Math.max(minDurationOf(state), snapped))
  return Math.round(bounded * 100) / 100
}

export function makeBlock(state: StateId): Block {
  // the reference duration is the one measured on the footage for that state
  return { state, duration: clampDuration(state, STATE_BY_ID.get(state)?.duration ?? 2) }
}

/**
 * The montage taken off the reference: the order of `SEQUENCE`, each state held for its
 * measured duration. It seeds the first launch, then belongs to the user — it is edited and
 * stored like any other. The reference itself stays in code: clearing storage brings it back.
 */
export function defaultCycle(): Cycle {
  return {
    /**
     * Empty name = "never named by the user", hence displayed in the current language.
     * Writing "Default cycle" here would freeze it: the name ships to storage on the first
     * visit and becomes user data, which a language switch would no longer retranslate.
     */
    name: '',
    id: DEFAULT_CYCLE_ID,
    blocks: SEQUENCE.map(makeBlock)
  }
}

export function totalDuration(blocks: Block[]): number {
  return blocks.reduce((sum, b) => sum + b.duration, 0)
}

/** Start date of a block in the montage. */
export function offsetOf(blocks: Block[], index: number): number {
  let acc = 0
  for (let i = 0; i < index && i < blocks.length; i++) acc += blocks[i]!.duration
  return acc
}

/**
 * Block played at date `t` and time elapsed inside it. Beyond the last block it wraps to the
 * start: playback loops. The caller checks that the montage is not empty.
 */
export function blockAt(blocks: Block[], t: number): { index: number; elapsed: number } {
  const total = totalDuration(blocks)
  if (!blocks.length || total <= 0) return { index: 0, elapsed: 0 }
  // the modulo is only applied when it is needed: on a date already inside the cycle it
  // would add nothing but float residue to the elapsed time
  const wrapped = t >= 0 && t < total ? t : ((t % total) + total) % total
  let acc = 0
  for (let i = 0; i < blocks.length; i++) {
    const end = acc + blocks[i]!.duration
    if (wrapped < end) return { index: i, elapsed: wrapped - acc }
    acc = end
  }
  return { index: blocks.length - 1, elapsed: 0 }
}

/**
 * Appends an animation to the montage.
 *
 * Capped at `MAX_BLOCS`, like the read-back. Without it the editor let you build a montage
 * larger than what storage returns on reload, and the work vanished silently — a read bound
 * that is not also an edit bound is a trap, not a protection.
 */
export function blocksWith(blocks: Block[], state: StateId): Block[] {
  if (blocks.length >= MAX_BLOCS) return blocks
  return [...blocks, makeBlock(state)]
}

/** Moves a block, returning a new list (framework states are replaced, not mutated). */
export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  const next = blocks.slice()
  const [moved] = next.splice(from, 1)
  if (!moved) return blocks
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved)
  return next
}

/** `My cycle`, `My cycle 2`, `My cycle 3`... — never the same name twice. */
export function uniqueName(base: string, cycles: Cycle[]): string {
  const taken = new Set(cycles.map((c) => c.name))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** Collision-free identifier, even against hand-edited storage. */
export function nextCycleId(cycles: Cycle[]): string {
  const taken = new Set(cycles.map((c) => c.id))
  let n = 1
  while (taken.has(`c${n}`)) n++
  return `c${n}`
}

/* ------------------------------------------------------- storage read-back */

function parseBlock(raw: unknown): Block | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { state, duration } = raw as { state?: unknown; duration?: unknown }
  /*
   * Validated against SEQUENCE and not against `STATE_BY_ID`: the latter contains `swirl`,
   * which is deliberately outside the catalogue — it is the settings view's entry
   * transition. A user montage is only ever built from the palette, so a `swirl` can only
   * arrive here through hand-edited storage, and there is no reason to tolerate it here when
   * it is excluded everywhere else.
   */
  if (typeof state !== 'string' || !SEQUENCE.includes(state as StateId)) return null
  if (typeof duration !== 'number' || !Number.isFinite(duration)) return null
  return { state: state as StateId, duration: clampDuration(state as StateId, duration) }
}

function parseCycle(raw: unknown, seen: Cycle[]): Cycle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, name, blocks } = raw as { id?: unknown; name?: unknown; blocks?: unknown }
  if (typeof id !== 'string' || !id) return null
  // the name may be empty — that is the seed montage, which follows the language
  if (typeof name !== 'string') return null
  if (!Array.isArray(blocks)) return null
  // truncate BEFORE reading back: validating 150 000 blocks to keep 200 would do the work we
  // are trying to avoid
  const kept = blocks
    .slice(0, MAX_BLOCS)
    .map(parseBlock)
    .filter((b): b is Block => b !== null)
  if (!kept.length) return null
  if (seen.some((c) => c.id === id)) return null
  return { id, name, blocks: kept }
}

/**
 * Storage is editable by hand: it is not trusted. Anything that does not read back is
 * silently dropped rather than crashing the app on startup.
 */
export function parseCycles(raw: string | null): Cycle[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // intentional: an unreadable cycle file means no cycles, never a crash of the avatar
    return []
  }
  if (!Array.isArray(data)) return []
  const out: Cycle[] = []
  for (const item of data.slice(0, MAX_CYCLES)) {
    const cycle = parseCycle(item, out)
    if (cycle) out.push(cycle)
  }
  return out
}
