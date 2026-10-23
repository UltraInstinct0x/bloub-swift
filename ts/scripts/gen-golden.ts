/**
 * Generates the golden set: `golden/identity.json` and `golden/frames.json`.
 *
 * Run it with:
 *
 *   npm run gen:golden            # builds, then writes ../golden
 *   npm run gen:golden -- <dir>   # writes to an explicit directory
 *
 * The golden files are the cross-language contract of the project: TypeScript writes them,
 * the Swift port reads them and must reproduce the same numbers. They are checked into the
 * repository on purpose — a diff there is a diff in what every bot looks like, and it has to
 * be reviewed like one.
 *
 * Numbers are rounded to 1e-6 (`roundFrame`), which is the precision the comparison uses on
 * both sides. Paths and eye matrices are strings already rounded to two decimals by the engine.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { avatarFor } from '../src/identity.js'
import { engineForAvatar } from '../src/status.js'
import { FOR_TESTS } from '../src/eyefit.js'
import { SHAPES } from '../src/skins.js'
import { FRAME_CASES, IDENTITY_IDS, buildCase, roundFrame, roundNumbers } from './golden-cases.js'

const argDir = process.argv[2]
const outDir = argDir ? resolve(argDir) : resolve(process.cwd(), '..', 'golden')

const GENERATOR = 'ts/scripts/gen-golden.ts'

/** A tiny, stable shape for the files: two spaces, one trailing newline. */
function writeJson(name: string, value: unknown) {
  const path = resolve(outDir, name)
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
  return path
}

const identity = {
  version: 1,
  generator: GENERATOR,
  note:
    'Look derived from a profile id. seed = fnv1a32("hermes-avatar/v1:" + profileId). ' +
    'Numbers rounded to 1e-6. Any change here changes what bots look like.',
  cases: IDENTITY_IDS.map((profileId) => ({ profileId, avatar: roundNumbers(avatarFor(profileId)) }))
}

const frames = {
  version: 1,
  generator: GENERATOR,
  note:
    'sample(t) frames of the engine, per identity, state and date. The engine is built from ' +
    'the profile id (shape and resting expression) and then the setup operations are applied. ' +
    'Numbers rounded to 1e-6.',
  cases: FRAME_CASES.map((c) => {
    const avatar = avatarFor(c.profileId)
    // a fresh engine per date: sample() is a pure function of time, so the order in which the
    // dates are read cannot matter — and building a new one proves it stays that way
    const samples = c.t.map((t) => ({ t, frame: roundFrame(buildCase(c).sample(t)) }))
    return {
      id: c.id,
      profileId: c.profileId,
      shape: avatar.shape,
      expression: avatar.rest.expression,
      setup: c.setup,
      samples
    }
  })
}

/*
 * The eye-offset table (eyefit.ts) as data. It is built by a bisection whose branch points are
 * float comparisons, so a port recomputing it could land one step away; the Swift port READS this
 * table instead, and the table is pinned here like every other number.
 */
const built = FOR_TESTS.build()
const eyefit = {
  version: 1,
  generator: GENERATOR,
  note: 'eyeOffset(shape, state, expression) in ball-radius units, key "<state>|<expression or empty>". Read by the Swift port as data.',
  shapes: Object.fromEntries(
    SHAPES.map((shape) => [shape.id, Object.fromEntries([...built.get(shape.radii)!].map(([k, v]) => [k, roundNumbers(v)]))])
  )
}

mkdirSync(outDir, { recursive: true })
writeJson('eyefit.json', eyefit)
const a = writeJson('identity.json', identity)
const b = writeJson('frames.json', frames)

/* Counts on stdout, so CI logs say how much is actually pinned down. */
const frameCount = frames.cases.reduce((n, c) => n + c.samples.length, 0)
process.stdout.write(
  `wrote ${a} (${identity.cases.length} identity cases)\n` +
    `wrote ${b} (${frames.cases.length} cases, ${frameCount} frames)\n`
)
