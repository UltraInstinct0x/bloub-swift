import { describe, expect, it } from 'vitest'
import {
  MAX_BLOCK,
  MAX_BLOCS,
  MAX_CYCLES,
  MIN_BLOCK,
  blockAt,
  blocksWith,
  clampDuration,
  defaultCycle,
  makeBlock,
  minDurationOf,
  moveBlock,
  nextCycleId,
  parseCycles,
  totalDuration,
  uniqueName,
  type Cycle
} from '../src/cycles.js'
import { SEQUENCE, STATES, STATE_BY_ID } from '../src/states.js'

describe('default cycle', () => {
  it('follows the sequence measured on the reference, in order', () => {
    expect(defaultCycle().blocks.map((b) => b.state)).toEqual(SEQUENCE)
  })

  it('holds each state for its measured duration', () => {
    for (const block of defaultCycle().blocks) {
      expect(block.duration).toBe(STATE_BY_ID.get(block.state)!.duration)
    }
  })

  it('is rebuilt identically on every call', () => {
    expect(defaultCycle()).toEqual(defaultCycle())
    // ...without sharing objects, otherwise editing a montage would touch the seed
    expect(defaultCycle().blocks[0]).not.toBe(defaultCycle().blocks[0])
  })

  it('always leaves room for a new cycle, without collision', () => {
    const reference = defaultCycle()
    const one: Cycle = {
      id: nextCycleId([reference]),
      name: uniqueName('My cycle', [reference]),
      blocks: []
    }
    const two: Cycle = {
      id: nextCycleId([reference, one]),
      name: uniqueName('My cycle', [reference, one]),
      blocks: []
    }
    expect(one.id).not.toBe(reference.id)
    expect(two.id).not.toBe(one.id)
    expect(two.name).not.toBe(one.name)
  })
})

describe('durations', () => {
  it('does not go below the engine floor', () => {
    // below it the block is shorter than the next entry fade
    expect(clampDuration('idle', 0.1)).toBe(MIN_BLOCK)
    expect(clampDuration('idle', -5)).toBe(MIN_BLOCK)
  })

  it('respects the measurement of states that need to resolve', () => {
    // the "!" is back at 2.0, the body is put back together at 2.4
    expect(minDurationOf('alert')).toBe(2)
    expect(minDurationOf('burst')).toBe(2.4)
    expect(clampDuration('orbit', 1)).toBe(2.5)
    // a state that ignores time only has the floor
    expect(minDurationOf('idle')).toBe(MIN_BLOCK)
  })

  it('lets no state go below its measurement', () => {
    for (const state of SEQUENCE) {
      expect(clampDuration(state, 0)).toBeGreaterThanOrEqual(minDurationOf(state))
    }
  })

  it('caps and snaps to the step, without float residue', () => {
    expect(clampDuration('idle', 999)).toBe(MAX_BLOCK)
    expect(clampDuration('idle', 2.44)).toBe(2.4)
    expect(clampDuration('idle', 2.46)).toBe(2.5)
  })
})

describe('reading', () => {
  const cycle: Cycle = {
    id: 'c1',
    name: 'Test',
    blocks: [
      { state: 'idle', duration: 2 },
      { state: 'wink', duration: 1 },
      { state: 'egg', duration: 3 }
    ]
  }

  it('adds up the blocks', () => {
    expect(totalDuration(cycle.blocks)).toBe(6)
  })

  it('finds the block being played and the time elapsed inside it', () => {
    expect(blockAt(cycle.blocks, 0)).toEqual({ index: 0, elapsed: 0 })
    expect(blockAt(cycle.blocks, 1.9)).toEqual({ index: 0, elapsed: 1.9 })
    // the boundary belongs to the next block
    expect(blockAt(cycle.blocks, 2)).toEqual({ index: 1, elapsed: 0 })
    expect(blockAt(cycle.blocks, 3.5)).toEqual({ index: 2, elapsed: 0.5 })
  })

  it('loops beyond the last block', () => {
    expect(blockAt(cycle.blocks, 6)).toEqual({ index: 0, elapsed: 0 })
    expect(blockAt(cycle.blocks, 8)).toEqual({ index: 1, elapsed: 0 })
  })

  it('does not break on an empty cycle', () => {
    expect(blockAt([], 3)).toEqual({ index: 0, elapsed: 0 })
    expect(totalDuration([])).toBe(0)
  })

  it('moves a block without touching the original list', () => {
    const blocks = cycle.blocks
    expect(moveBlock(blocks, 0, 2).map((b) => b.state)).toEqual(['wink', 'egg', 'idle'])
    expect(moveBlock(blocks, 2, 0).map((b) => b.state)).toEqual(['egg', 'idle', 'wink'])
    expect(blocks.map((b) => b.state)).toEqual(['idle', 'wink', 'egg'])
  })
})

describe('storage read-back', () => {
  it('does not break on empty or invalid JSON', () => {
    expect(parseCycles(null)).toEqual([])
    expect(parseCycles('')).toEqual([])
    expect(parseCycles('{not json')).toEqual([])
    expect(parseCycles('{"id":"c1"}')).toEqual([])
  })

  it('drops blocks whose state no longer exists', () => {
    const raw =
      '[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":2},' +
      '{"state":"gone","duration":2}]}]'
    expect(parseCycles(raw)[0]!.blocks.map((b) => b.state)).toEqual(['idle'])
  })

  it('brings aberrant durations back into their bounds', () => {
    const raw =
      '[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":-4},' +
      '{"state":"egg","duration":9999}]}]'
    expect(parseCycles(raw)[0]!.blocks.map((b) => b.duration)).toEqual([MIN_BLOCK, MAX_BLOCK])
  })

  it('drops an empty, nameless or duplicate cycle', () => {
    expect(parseCycles('[{"id":"c1","name":"A","blocks":[]}]')).toEqual([])
    expect(parseCycles('[{"id":"c1","blocks":[{"state":"idle","duration":2}]}]')).toEqual([])
    const duplicate =
      '[{"id":"c1","name":"A","blocks":[{"state":"idle","duration":2}]},' +
      '{"id":"c1","name":"B","blocks":[{"state":"egg","duration":2}]}]'
    expect(parseCycles(duplicate).map((c) => c.name)).toEqual(['A'])
  })

  it('keeps only the model fields, not what is smuggled in', () => {
    const raw =
      '[{"id":"defaut","name":"My montage","locked":true,"secret":1,' +
      '"blocks":[{"state":"idle","duration":2,"speed":3}]}]'
    const cycle = parseCycles(raw)[0]!
    expect(Object.keys(cycle).sort()).toEqual(['blocks', 'id', 'name'])
    expect(Object.keys(cycle.blocks[0]!).sort()).toEqual(['duration', 'state'])
  })

  /*
   * Storage is editable and holds a few megabytes, while nothing downstream is dimensioned for
   * it. One cycle of 150 000 blocks — about 4 MB of JSON, so within the budget — gave
   * 1 500 000 s of duration, as many ticks to allocate and a 29 700 000 px wide track.
   */
  it('bounds the size of a read-back montage', () => {
    const blocks = Array.from({ length: 200_000 }, () => ({ state: 'idle', duration: 10 }))
    const raw = JSON.stringify([{ id: 'c1', name: 'A', blocks }])
    expect(parseCycles(raw)[0]!.blocks).toHaveLength(MAX_BLOCS)
  })

  /*
   * The floor is DERIVED from the longest `morph`, no longer written by hand: it was 0.6 in
   * hard code, which only worked because 0.6 happened to be orbit's morph.
   */
  it('the block floor covers the longest fade of the catalogue', () => {
    const longest = Math.max(...STATES.map((s) => s.morph))
    expect(MIN_BLOCK).toBeGreaterThanOrEqual(longest)
    // and it is not gratuitously larger: it IS that fade
    expect(MIN_BLOCK).toBe(longest)
  })

  it('also bounds adding from the editor, not only reading back', () => {
    let blocks = Array.from({ length: MAX_BLOCS }, () => makeBlock('idle'))
    expect(blocksWith(blocks, 'egg')).toHaveLength(MAX_BLOCS)
    // and adding just below the bound is still possible
    blocks = blocks.slice(0, MAX_BLOCS - 1)
    expect(blocksWith(blocks, 'egg')).toHaveLength(MAX_BLOCS)
  })

  it('bounds the number of montages read back', () => {
    const raw = JSON.stringify(
      Array.from({ length: 5000 }, (_, i) => ({
        id: `c${i}`,
        name: `A${i}`,
        blocks: [{ state: 'idle', duration: 2 }]
      }))
    )
    expect(parseCycles(raw)).toHaveLength(MAX_CYCLES)
  })

  /*
   * `swirl` is the settings view's entry transition, deliberately outside `SEQUENCE`. A user
   * montage is only built from the palette, so it can only arrive here through hand-edited
   * storage — and it is refused here as everywhere else.
   */
  it('refuses a state outside the catalogue, `swirl` included', () => {
    const raw =
      '[{"id":"c1","name":"A","blocks":[{"state":"swirl","duration":2},' +
      '{"state":"idle","duration":2}]}]'
    expect(parseCycles(raw)[0]!.blocks.map((b) => b.state)).toEqual(['idle'])
    // a montage containing ONLY that becomes empty, hence dropped
    expect(
      parseCycles('[{"id":"c1","name":"A","blocks":[{"state":"swirl","duration":2}]}]')
    ).toEqual([])
  })
})
