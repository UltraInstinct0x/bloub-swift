import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { avatarFor } from '../src/identity.js'
import type { BotFrame } from '../src/engine.js'
import { FRAME_CASES, IDENTITY_IDS, buildCase, roundFrame, roundNumbers } from '../scripts/golden-cases.js'

/**
 * The golden set, re-read and re-derived. This is the test that makes the files a contract
 * instead of a snapshot: the generator and this verifier share the case list and the rounding,
 * so a difference here is a difference in the engine, not in the harness.
 *
 * A failure means one of two things, and the message says which:
 *
 * - the engine changed what it draws (then the goldens were regenerated without thought, or a
 *   constant moved: review the diff, it is a diff in every bot's face);
 * - the file was edited by hand / truncated (then regenerate with `npm run gen:golden`).
 */

/** The golden directory: `ts/` at test time, repo root above it. */
const GOLDEN_DIR = resolve(process.cwd(), '..', 'golden')

function readGolden<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(GOLDEN_DIR, name), 'utf8')) as T
}

interface IdentityFile {
  version: number
  cases: Array<{ profileId: string; avatar: ReturnType<typeof avatarFor> }>
}

interface FrameFile {
  version: number
  cases: Array<{
    id: string
    profileId: string
    shape: string
    expression: string
    samples: Array<{ t: number; frame: BotFrame }>
  }>
}

describe('golden files', () => {
  it('are version 1 and cover the case list exactly', () => {
    const identity = readGolden<IdentityFile>('identity.json')
    const frames = readGolden<FrameFile>('frames.json')

    expect(identity.version).toBe(1)
    expect(frames.version).toBe(1)

    expect(identity.cases.map((c) => c.profileId)).toEqual([...IDENTITY_IDS])
    expect(frames.cases.map((c) => c.id)).toEqual(FRAME_CASES.map((c) => c.id))
  })

  it('pin down the frames on 1e-6 numbers only (no full-precision drift)', () => {
    const identity = readGolden<IdentityFile>('identity.json')
    const frames = readGolden<FrameFile>('frames.json')
    const text = JSON.stringify(identity) + JSON.stringify(frames)
    // Every number in the files is stored at 6 decimals at most. 17-digit doubles appearing
    // here would mean the rounding step was bypassed.
    const overPrecise = text.match(/-?\d+\.\d{8,}/g) ?? []
    expect(overPrecise.slice(0, 5)).toEqual([])
  })
})

describe('identity goldens', () => {
  const file = readGolden<IdentityFile>('identity.json')

  for (const { profileId, avatar } of file.cases) {
    it(`"${profileId}" derives the same look`, () => {
      expect(roundNumbers(avatarFor(profileId)), profileId).toEqual(avatar)
    })
  }
})

describe('frame goldens', () => {
  const file = readGolden<FrameFile>('frames.json')

  for (const golden of file.cases) {
    const cases = FRAME_CASES.filter((c) => c.id === golden.id)

    it(`"${golden.id}" reproduces ${golden.samples.length} frames`, () => {
      expect(cases, `case ${golden.id} is in the shared case list`).toHaveLength(1)

      // the identity the frames were generated with is stored alongside them, so a Swift port
      // can rebuild the engine without re-deriving it
      const avatar = avatarFor(golden.profileId)
      expect(golden.shape).toBe(avatar.shape)
      expect(golden.expression).toBe(avatar.rest.expression)

      for (const sample of golden.samples) {
        // a fresh engine per date, like the generator: `sample` is a pure function of time
        const frame = roundFrame(buildCase(cases[0]!).sample(sample.t))
        expect(frame, `${golden.id} at t=${sample.t}`).toEqual(sample.frame)
      }
    })
  }
})
