import { arcRender, type ArcRender, type DotRender } from './decor.js'
import { blendExpression, type BotExpression } from './expressions.js'
import { eyeOffset } from './eyefit.js'
import { blinkScale, eyePoses, liveliness } from './face.js'
import { clamp, easings, lerp, r2 } from './math.js'
import {
  blend,
  capsulePath,
  closedPath,
  radiusAtAngle,
  toPoints,
  type Point,
  type Silhouette
} from './shape.js'
import { STATE_BY_ID, type Pose, type StateDef, type StateId } from './states.js'

export interface RenderedEye {
  d: string
  matrix: string
  alpha: number
}

export interface BotFrame {
  bodyPath: string
  bodyAlpha: number
  eyes: RenderedEye[]
  dots: DotRender[]
  /** true = the dots pass behind the body (burst particles) */
  dotsBehind: boolean
  arcs: ArcRender[]
  notif: { x: number; y: number; r: number } | null
  notch: { x: number; y: number; r: number } | null
}

/**
 * Where the bot looks when something external drives it — the mouse pointer, today.
 *
 * `yaw` and `pitch` are ABSOLUTE directions, replacing the pose's own as `mix` rises. Two
 * reasons, each a trap already fallen into:
 *
 * - the ENGINE has to do that mix, not the caller, because only it knows the pose AT THIS
 *   INSTANT. A caller compensating for the expression's orientation would read its
 *   ARRIVAL value while the morph is still running, and the eyes jumped on every mood
 *   change;
 * - and it has to be absolute on BOTH axes. In relative terms the eye height followed each
 *   expression's own, and "neutral" looks about 30deg higher than the others, so the eyes
 *   dropped all at once on the first mood change. What distinguishes a mood during
 *   tracking is the SHAPE of its eyes, not where it looks.
 *
 * `mix` says how much the outside world commands the DIRECTION (0 = not at all).
 *
 * `wander` says, separately, what remains of automatic drift. The two must not be
 * conflated: when the pointer moves, the drift has to die out — added together, the bot
 * would look like it was hunting the cursor without ever holding it. But with NO pointer
 * the head must stay turned AND keep living. Conflating them froze the gaze the moment the
 * view opened.
 *
 * `spin` is a turn to travel THROUGH, in degrees, faded to 0 on arrival. Since the eyes
 * live on a sphere a turn takes them behind the ball and back the other side — and -360deg
 * being the same angle as 0, it changes nothing about where they land.
 */
export interface Look {
  yaw: number
  pitch: number
  mix: number
  spin: number
  wander: number
}

const NO_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 }

const lerpLook = (a: Look, b: Look, t: number): Look => ({
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
  mix: lerp(a.mix, b.mix, t),
  spin: lerp(a.spin, b.spin, t),
  wander: lerp(a.wander, b.wander, t)
})

const lerpEye = (a: Pose['eyes'][number], b: Pose['eyes'][number], t: number) => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  open: lerp(a.open, b.open, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t)
})

/** Interpolation of two poses. The decor crosses in opacity, not in geometry. */
function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = 1 - t
  return {
    sil: blend(a.sil, b.sil, t),
    offX: lerp(a.offX, b.offX, t),
    offY: lerp(a.offY, b.offY, t),
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t)
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEye(a.eyes[0], b.eyes[0], t), lerpEye(a.eyes[1], b.eyes[1], t)],
    eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
    bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
    dots: [
      ...a.dots.map((d) => ({ ...d, opacity: d.opacity * out })),
      ...b.dots.map((d) => ({ ...d, opacity: d.opacity * t }))
    ],
    arcs: [
      ...a.arcs.map((r) => ({ ...r, id: `a${r.id}`, opacity: r.opacity * out })),
      ...b.arcs.map((r) => ({ ...r, id: `b${r.id}`, opacity: r.opacity * t }))
    ],
    // the pastille belongs to one of the two states only, it does not blend
    notif: t < 0.5 ? a.notif : b.notif,
    dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind
  }
}

/**
 * Clockless engine: `sample(t)` is a pure function of time.
 *
 * Practical consequence: pause, resume, slow motion and jumping to an arbitrary date give
 * exactly the same image, and the render is testable without a DOM. No `Date.now()`, no
 * framework import: this is what makes the frozen frame, the golden set and the iOS
 * single-frame renders possible.
 */
export class BotEngine {
  /** radius of the ball at rest, in viewBox units */
  readonly scale: number

  private cur: StateId
  private prev: StateId | null = null
  /**
   * FROZEN starting pose, set only when a state change lands while a fade is already in
   * progress. See `setState`.
   */
  private frozenStart: Pose | null = null
  private tCur = 0
  private tPrev = 0
  private blinkAt = -10
  private pts: Point[] = []
  private shape: number[] | null = null
  private shapePrev: number[] | null = null
  private shapeAt = -10
  private expr: BotExpression | null = null
  private exprPrev: BotExpression | null = null
  private exprAt = -10
  private look: Look = NO_LOOK
  private lookPrev: Look = NO_LOOK
  private lookAt = -10
  /** duration of the catch-up in progress; see `LOOK_MORPH`, its default */
  private lookMorph = 0.24

  /** duration of the morph when the body shape changes */
  static readonly SHAPE_MORPH = 0.45

  /**
   * Duration of the gaze catch-up towards the target. Shorter than `SHAPE_MORPH`: a gaze
   * that follows must feel attentive, not viscous. Since the target is reset on every mouse
   * move, this duration is what gives the tracking its inertia — the gaze never quite
   * reaches a moving cursor.
   */
  static readonly LOOK_MORPH = 0.24

  constructor(
    scale = 100,
    initial: StateId = 'idle',
    shape: number[] | null = null,
    expression: BotExpression | null = null
  ) {
    this.scale = scale
    this.cur = initial
    this.shape = shape
    this.expr = expression
  }

  /**
   * Rest expression chosen for this bot. Like the shape, it slides to the new value
   * instead of jumping.
   */
  setExpression(expression: BotExpression | null, now = 0) {
    if (expression === this.expr) return
    this.exprPrev = this.expr
    this.expr = expression
    this.exprAt = now
  }

  /** Effective expression at `now`, morph in progress included. */
  private exprAtTime(now: number): BotExpression | null {
    const to = this.expr
    const from = this.exprPrev
    if (!to || !from) return to
    const k = (now - this.exprAt) / BotEngine.SHAPE_MORPH
    if (k >= 1) return to
    return blendExpression(from, to, easings.easeOutQuint(clamp(k)))
  }

  /**
   * Identity shape for this bot. It only replaces the body on the resting states
   * (`baseBody`): on the others the silhouette IS the animation and must not be
   * overwritten.
   *
   * The change happens as a morph, not a jump: since all shapes are sampled at the same
   * angles, interpolating the radii is enough.
   */
  setShape(radii: number[] | null, now = 0) {
    if (radii === this.shape) return
    this.shapePrev = this.shape
    this.shape = radii
    this.shapeAt = now
  }

  /**
   * Effective shape at `now`, morph in progress included.
   *
   * Does NOT null out `shapePrev` at the end of the morph: `sample` must stay a pure
   * function of time, so re-reading a past date has to give the intermediate image.
   */
  private shapeAtTime(now: number): number[] | null {
    const to = this.shape
    const from = this.shapePrev
    if (!to || !from) return to
    const k = (now - this.shapeAt) / BotEngine.SHAPE_MORPH
    if (k >= 1) return to
    const t = easings.easeOutQuint(clamp(k))
    // allocates only during the morph; outside it the array is returned as is
    return to.map((r, i) => lerp(from[i] ?? r, r, t))
  }

  /**
   * New gaze target, `null` to return to the state's own.
   *
   * It restarts from the CURRENT value, and not from the previous target as `setShape`
   * does: this method is called on every pointer move, and restarting from the old target
   * would pull the gaze back a notch before each catch-up — the tracking would tremble
   * instead of glide.
   *
   * Same contract as `setShape` otherwise: external state enters through a dated setter,
   * never through a variable read during `sample`, otherwise the engine stops being a pure
   * function of time.
   */
  setLook(look: Look | null, now: number, morph = BotEngine.LOOK_MORPH) {
    /*
     * A non-finite target is refused. The engine KEEPS the last one: a `NaN` set once
     * would propagate to every frame and the bot would never rest again. This happened for
     * real — a `getBoundingClientRect` on a zero-sized box gives `0 / 0` in the caller.
     */
    if (look && !Number.isFinite(look.yaw + look.pitch + look.mix + look.spin + look.wander)) {
      return
    }
    this.lookPrev = this.lookAtTime(now)
    this.look = look ?? NO_LOOK
    this.lookAt = now
    this.lookMorph = morph
  }

  /** Effective look at `now`, catch-up in progress included. */
  private lookAtTime(now: number): Look {
    const k = (now - this.lookAt) / this.lookMorph
    if (k >= 1) return this.look
    return lerpLook(this.lookPrev, this.look, easings.easeOutQuint(clamp(k)))
  }

  private posed(
    def: StateDef,
    t: number,
    shape: number[] | null,
    expr: BotExpression | null
  ): Pose {
    let pose = def.pose(t)
    if (def.baseBody && shape) {
      // the pose is kept (rotation, offset, squash) and only the profile is swapped
      pose = { ...pose, sil: { ...pose.sil, radii: shape } }
    }
    if (def.baseFace && expr) {
      pose = { ...pose, gaze: expr.gaze, split: expr.split, eyes: expr.eyes }
    }
    return pose
  }

  /**
   * Eye offset at `now` for a given state, in ball-radius units.
   *
   * It is READ from a table and interpolated, never recomputed: `eyefit.ts` explains why
   * that distinction is the whole fix. Here it only has to be interpolated on the shape
   * axis, with exactly the silhouette morph's curve and duration — same cause, same motion.
   *
   * The table is queried on the morph's BOUNDS (`shapePrev` and `shape`), never on what
   * `shapeAtTime` returns: that one is a fresh array allocated every frame, hence without
   * identity, and it exists in no table.
   */
  private offsetAtTime(now: number, state: StateId): { x: number; y: number } {
    /** One morph axis: read the table at both BOUNDS and interpolate with its curve. */
    const onAxis = (
      start: number,
      duration: number,
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => {
      if (a === b) return b
      const k = (now - start) / duration
      if (k >= 1) return b
      const t = easings.easeOutQuint(clamp(k))
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
    }

    // expression axis, for each of the two shapes in play
    const perShape = (radii: number[] | null) =>
      onAxis(
        this.exprAt,
        BotEngine.SHAPE_MORPH,
        eyeOffset(radii, state, this.exprPrev?.id ?? null),
        eyeOffset(radii, state, this.expr?.id ?? null)
      )

    // then the shape axis
    return onAxis(
      this.shapeAt,
      BotEngine.SHAPE_MORPH,
      perShape(this.shapePrev),
      perShape(this.shape)
    )
  }

  get state(): StateId {
    return this.cur
  }

  /** True while a fade from the previous state is still running at `now`. */
  isFading(now: number): boolean {
    const def = STATE_BY_ID.get(this.cur)!
    return this.prev !== null && now - this.tCur < def.morph
  }

  /**
   * Restarts on `id` WITHOUT a previous state, like a fresh engine placed on that state.
   *
   * That is what "rewind" means for this engine. `setState` alone cannot do it: it keeps
   * the state being left in order to fade it, which is exactly its job during playback and
   * exactly what must not happen when returning to the start of a sequence. Replaying frame
   * 0 after a full pass used to blend the first state with the LAST, and the GIF export
   * opened on a ball with no eyes — the comet has a zero `eyeAlpha`.
   *
   * `sample` stays a pure function of time: like `setState`, this is a DATED setter, called
   * by the sequence driver, never during sampling.
   */
  reset(id: StateId, now: number) {
    this.cur = id
    this.prev = null
    this.frozenStart = null
    this.tCur = now
    this.tPrev = now
    this.blinkAt = -10
  }

  /**
   * Origin of the fade in progress: the frozen pose if there is one, otherwise the state
   * being left evaluated at its own elapsed time — hence still animating, which is wanted.
   */
  private origin(now: number, shape: number[] | null, expr: BotExpression | null): Pose | null {
    if (this.frozenStart) return this.frozenStart
    if (!this.prev) return null
    const prevDef = STATE_BY_ID.get(this.prev)!
    return this.posed(prevDef, Math.max(0, now - this.tPrev), shape, expr)
  }

  /**
   * Composite pose at `now`, fade in progress included: exactly what `sample` blends, before
   * the life-at-rest and gaze layer. Extracted so that `setState` can freeze it.
   */
  private compositePose(now: number): Pose {
    const def = STATE_BY_ID.get(this.cur)!
    const shape = this.shapeAtTime(now)
    const expr = this.exprAtTime(now)
    const pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr)
    const since = now - this.tCur
    if (since >= def.morph) return pose
    const origin = this.origin(now, shape, expr)
    if (!origin) return pose
    return blendPose(origin, pose, easings.easeOutQuint(clamp(since / def.morph)))
  }

  /**
   * State change, dated.
   *
   * The engine keeps ONE slot of history, so a change landing inside a fade used to replace
   * the blend's origin with the FULL pose of the state being left, instead of the partly
   * blended frame that was on screen. Measured on `idle -> wide -> idle` at 100 ms: 35.9 px
   * of jump against 8.0 px of normal motion.
   *
   * So the current composite pose is frozen and the blend starts from it. Continuous by
   * construction, however many changes are chained.
   *
   * And ONLY in that case. Freezing on every change would stop the outgoing state's own
   * animation dead for the whole fade — `alert`'s travelling "!" would halt mid-course —
   * whereas outside a morph there is nothing to fix: the state being left already IS the
   * displayed frame.
   */
  setState(id: StateId, now: number) {
    if (id === this.cur) return
    const morph = STATE_BY_ID.get(this.cur)!.morph
    const inFullFade = this.prev !== null && now - this.tCur < morph
    this.frozenStart = inFullFade ? this.compositePose(now) : null
    this.prev = this.cur
    this.tPrev = this.tCur
    this.cur = id
    this.tCur = now
    // In the reference, every shape change is masked by a blink.
    if (STATE_BY_ID.get(id)?.blinkIn) this.blinkAt = now
  }

  sample(now: number): BotFrame {
    const R = this.scale
    const def = STATE_BY_ID.get(this.cur)!
    const shape = this.shapeAtTime(now)
    const expr = this.exprAtTime(now)
    let pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr)
    let offset = this.offsetAtTime(now, this.cur)

    // --- transition -------------------------------------------------------
    const since = now - this.tCur
    // The previous state is never purged: `since < def.morph` is enough to ignore it once
    // the fade is over, and forgetting it would make the engine non-replayable — re-reading
    // a date from before the end of the fade would no longer find it.
    const origin = since < def.morph ? this.origin(now, shape, expr) : null
    if (origin) {
      // Exponential ease-out: the curve measured on the reference. The body has no
      // overshoot (only the pastille and the eye opening do). The ratio is bounded:
      // re-reading a date BEFORE the state change would give a negative ratio, which the
      // ease-out extrapolates — the silhouette then flies thirty times too far.
      const ratio = easings.easeOutQuint(clamp(since / def.morph))
      pose = blendPose(origin, pose, ratio)
      // The eye offset follows the SAME curve as the silhouette that motivates it. It comes
      // from the state being left, which `setState` always fills in together with the
      // origin — the guard is for the type checker, not for a real case.
      const left = this.prev
      if (left) {
        const before = this.offsetAtTime(now, left)
        offset = {
          x: lerp(before.x, offset.x, ratio),
          y: lerp(before.y, offset.y, ratio)
        }
      }
    }

    // --- life at rest -----------------------------------------------------
    const alive = pose.eyeAlpha > 0.01
    const look = this.lookAtTime(now)
    const life = liveliness(now, { wander: alive ? look.wander : 0, blink: alive })

    const gaze = {
      // Both aims REPLACE the pose's instead of adding to them (see `Look`), and the turn
      // is subtracted on the way. The drift is added AFTER the mix, otherwise the target
      // would cancel it along with the pose — yet it must survive a turned head with no
      // pointer.
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
      // roll follows nothing: the bot's head is tilted -13deg in the reference, and rolling
      // it with the cursor breaks that signature
      roll: pose.gaze.roll + life.dRoll
    }

    // blink triggered by the state change, on top of the schedule
    const forced = clamp((now - this.blinkAt) / 0.2)
    const forcedLid = forced < 1 ? Math.abs(forced * 2 - 1) : 1
    const lid = Math.min(life.lid, forcedLid)

    const offX = pose.offX + life.driftX
    const offY = pose.offY + life.driftY

    // --- body -------------------------------------------------------------
    const sil: Silhouette = {
      ...pose.sil,
      cx: pose.sil.cx + offX,
      cy: pose.sil.cy + offY,
      sy: pose.sil.sy * life.breath
    }
    const bodyPath = closedPath(toPoints(sil, R, this.pts))

    // --- eyes -------------------------------------------------------------
    // The eyes live on a sphere of radius 1; as soon as the silhouette is no longer a
    // circle they are pulled back pro rata of the real radius in their direction, otherwise
    // they overflow and the mask crops them.
    const bodyRadius = (x: number, y: number) =>
      radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot)

    const eyes: RenderedEye[] = []
    if (pose.eyeAlpha > 0.01) {
      const poses = eyePoses(gaze, R, pose.split)
      for (let i = 0; i < 2; i++) {
        const e = poses[i]!
        if (e.depth <= 0.02) continue
        const cfg = pose.eyes[i]!
        const fit = bodyRadius(e.x, e.y)
        // The eye's own tilt: the tangent frame is composed with a rotation in the eye's
        // plane (Basis x Rot). That is what allows mirrored tilts between the two eyes.
        const phi = ((cfg.tilt ?? 0) * Math.PI) / 180
        const cp = Math.cos(phi)
        const sp = Math.sin(phi)
        const ax = e.a * cp + e.c * sp
        const ay = e.b * cp + e.d * sp
        const cx2 = -e.a * sp + e.c * cp
        const cy2 = -e.b * sp + e.d * cp
        // The blink applies AFTER all of that: it is a vertical squash on screen, not along
        // the capsule's axis.
        const k = blinkScale(Math.min(lid, cfg.open))
        eyes.push({
          d: capsulePath(cfg.w * R, cfg.h * R),
          matrix: `matrix(${r2(ax)},${r2(ay * k)},${r2(cx2)},${r2(cy2 * k)},${r2(e.x * fit + (offX + offset.x) * R)},${r2(e.y * fit + (offY + offset.y) * R)})`,
          alpha: pose.eyeAlpha * clamp(e.depth / 0.12)
        })
      }
    }

    // --- decor ------------------------------------------------------------
    const dots = pose.dots
      .filter((p) => p.opacity > 0.01 && p.r > 0.0005)
      .map((p) => ({ ...p, x: (p.x + offX) * R, y: (p.y + offY) * R, r: p.r * R }))

    // the pastille sits on the outline: so it follows the shape too
    const nFit = pose.notif ? bodyRadius(pose.notif.x, pose.notif.y) : 1
    const nx = pose.notif ? (pose.notif.x * nFit + offX) * R : 0
    const ny = pose.notif ? (pose.notif.y * nFit + offY) * R : 0
    const notif = pose.notif ? { x: nx, y: ny, r: pose.notif.r * R } : null
    const notch = pose.notif ? { x: nx, y: ny, r: pose.notif.notch * R } : null

    return {
      bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes,
      dots,
      dotsBehind: pose.dotsBehind,
      // States declare arcs in ball-radius units; the engine is the only one that knows the
      // viewBox scale, so the engine is what rasterises them.
      arcs: pose.arcs
        .filter((a) => a.opacity > 0.01)
        .map((a) => arcRender(a.seed, a.t, R, a.id, a.opacity)),
      notif,
      notch
    }
  }
}
