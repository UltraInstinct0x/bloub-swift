/**
 * @hermes/avatar — the live avatar engine, framework-free and clock-free.
 *
 * `BotEngine.sample(t)` is a pure function of time. No `Date.now()`, no DOM, no framework:
 * pause, resume, slow motion and jumping to an arbitrary date give exactly the same frame,
 * which is what lets the desktop, the app and the iOS Live Activity draw the same image
 * from the same numbers.
 *
 * Two layers on top of the ported engine:
 *
 * - `identity.ts`: the look (shape, palette, resting expression) derived from a profile id,
 *   deterministically, with no storage and no server;
 * - `status.ts`: bot status -> engine state.
 *
 * The golden files in `../golden` are the cross-language contract: the Swift port reads the
 * same files and must reproduce the same numbers.
 */

export * from './math.js'
export * from './repere.js'
export * from './profiles.js'
export * from './shape.js'
export * from './face.js'
export * from './expressions.js'
export * from './decor.js'
export * from './states.js'
export * from './skins.js'
export * from './eyefit.js'
export * from './engine.js'
export * from './cycles.js'
export * from './identity.js'
export * from './status.js'
