/**
 * The frame of reference of everything the engine returns.
 *
 * `engine.sample()` emits viewBox units, and these two numbers are their definition:
 * without them an engine output means nothing.
 */

/**
 * Radius of the ball at rest, in viewBox units. It is the working unit: the rest of
 * the package is expressed in fractions of it, which keeps measurements taken off the
 * reference footage independent of the display size.
 */
export const RADIUS = 100

/**
 * Half-side of the displayed viewBox. The margin beyond the radius holds the rings.
 *
 * Not a free value: the orbit rings and the comet swoosh reach 1.4 times the radius,
 * i.e. 140. Nothing bounds them at runtime — it is the hand setting of the `RINGS`
 * and `SWOOSH` tables (`decor.ts`) that keeps them under 158.
 */
export const HALF_VIEWBOX = 158

/** The viewBox string a renderer should put on the root `<svg>`. */
export const VIEW_BOX = `${-HALF_VIEWBOX} ${-HALF_VIEWBOX} ${HALF_VIEWBOX * 2} ${HALF_VIEWBOX * 2}`
