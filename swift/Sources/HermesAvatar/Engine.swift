import Foundation

// Port of ts/src/engine.ts. Clockless: sample(t) is a pure function of time and of the dated setters.

public struct RenderedEye: Equatable, Sendable {
    public var d: String
    public var matrix: String
    public var alpha: Double
    /// The numbers of `matrix`, for renderers that do not parse strings.
    public var m: [Double]
}

public struct Circle3: Equatable, Sendable { public var x, y, r: Double }

public struct BotFrame: Equatable, Sendable {
    public var bodyPath: String
    public var bodyAlpha: Double
    public var eyes: [RenderedEye]
    public var dots: [DotRender]
    public var dotsBehind: Bool
    public var arcs: [ArcRender]
    public var notif: Circle3?
    public var notch: Circle3?
}

public struct Look: Equatable, Sendable {
    public var yaw, pitch, mix, spin, wander: Double
    public init(yaw: Double, pitch: Double, mix: Double, spin: Double, wander: Double) {
        self.yaw = yaw; self.pitch = pitch; self.mix = mix; self.spin = spin; self.wander = wander
    }
    public static let none = Look(yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1)
}

func lerpLook(_ a: Look, _ b: Look, _ t: Double) -> Look {
    Look(yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), mix: lerp(a.mix, b.mix, t), spin: lerp(a.spin, b.spin, t),
         wander: lerp(a.wander, b.wander, t))
}

func blendPose(_ a: Pose, _ b: Pose, _ t: Double) -> Pose {
    let out = 1 - t
    var p = Pose()
    p.sil = blend(a.sil, b.sil, t)
    p.offX = lerp(a.offX, b.offX, t)
    p.offY = lerp(a.offY, b.offY, t)
    p.gaze = HeadGaze(yaw: lerp(a.gaze.yaw, b.gaze.yaw, t), pitch: lerp(a.gaze.pitch, b.gaze.pitch, t), roll: lerp(a.gaze.roll, b.gaze.roll, t))
    p.split = lerp(a.split, b.split, t)
    p.eyes = (lerpEyeCfg(a.eyes.0, b.eyes.0, t), lerpEyeCfg(a.eyes.1, b.eyes.1, t))
    p.eyeAlpha = lerp(a.eyeAlpha, b.eyeAlpha, t)
    p.bodyAlpha = lerp(a.bodyAlpha, b.bodyAlpha, t)
    p.dots = a.dots.map { var d = $0; d.opacity *= out; return d } + b.dots.map { var d = $0; d.opacity *= t; return d }
    p.arcs = a.arcs.map { var r = $0; r.id = "a" + r.id; r.opacity *= out; return r }
        + b.arcs.map { var r = $0; r.id = "b" + r.id; r.opacity *= t; return r }
    p.notif = t < 0.5 ? a.notif : b.notif
    p.dotsBehind = t < 0.5 ? a.dotsBehind : b.dotsBehind
    return p
}

public final class BotEngine {
    public let scale: Double
    public private(set) var state: StateId
    private var prev: StateId? = nil
    private var frozenStart: Pose? = nil
    private var tCur = 0.0
    private var tPrev = 0.0
    private var blinkAt = -10.0
    private var shape: ShapeId?
    private var shapePrev: ShapeId? = nil
    private var shapeAt = -10.0
    private var expr: BotExpression?
    private var exprPrev: BotExpression? = nil
    private var exprAt = -10.0
    private var look = Look.none
    private var lookPrev = Look.none
    private var lookAt = -10.0
    private var lookMorph = 0.24

    public static let SHAPE_MORPH = 0.45
    public static let LOOK_MORPH = 0.24

    public init(scale: Double = 100, initial: StateId = .idle, shape: ShapeId? = nil, expression: BotExpression? = nil) {
        self.scale = scale
        self.state = initial
        self.shape = shape
        self.expr = expression
    }

    public func setExpression(_ expression: BotExpression?, now: Double = 0) {
        if expression?.id == expr?.id { return }
        exprPrev = expr
        expr = expression
        exprAt = now
    }

    private func exprAtTime(_ now: Double) -> BotExpression? {
        guard let to = expr, let from = exprPrev else { return expr }
        let k = (now - exprAt) / BotEngine.SHAPE_MORPH
        if k >= 1 { return to }
        return blendExpression(from, to, Easings.easeOutQuint(clamp(k)))
    }

    public func setShape(_ id: ShapeId?, now: Double = 0) {
        if id == shape { return }
        shapePrev = shape
        shape = id
        shapeAt = now
    }

    private func shapeAtTime(_ now: Double) -> [Double]? {
        guard let toId = shape, let to = shapeRadii(toId.rawValue) else { return nil }
        guard let fromId = shapePrev, let from = shapeRadii(fromId.rawValue) else { return to }
        let k = (now - shapeAt) / BotEngine.SHAPE_MORPH
        if k >= 1 { return to }
        let t = Easings.easeOutQuint(clamp(k))
        return to.enumerated().map { i, r in lerp(i < from.count ? from[i] : r, r, t) }
    }

    public func setLook(_ look: Look?, now: Double, morph: Double = BotEngine.LOOK_MORPH) {
        if let l = look, !(l.yaw + l.pitch + l.mix + l.spin + l.wander).isFinite { return }
        lookPrev = lookAtTime(now)
        self.look = look ?? .none
        lookAt = now
        lookMorph = morph
    }

    private func lookAtTime(_ now: Double) -> Look {
        let k = (now - lookAt) / lookMorph
        if k >= 1 { return look }
        return lerpLook(lookPrev, look, Easings.easeOutQuint(clamp(k)))
    }

    private func posed(_ def: StateDef, _ t: Double, _ shape: [Double]?, _ expr: BotExpression?) -> Pose {
        var pose = def.pose(t)
        if def.baseBody, let shape { pose.sil.radii = shape }
        if def.baseFace, let expr {
            pose.gaze = expr.gaze
            pose.split = expr.split
            pose.eyes = expr.eyes
        }
        return pose
    }

    private func offsetAtTime(_ now: Double, _ state: StateId) -> Point {
        func onAxis(_ start: Double, _ duration: Double, _ a: Point, _ b: Point) -> Point {
            if a == b { return b }
            let k = (now - start) / duration
            if k >= 1 { return b }
            let t = Easings.easeOutQuint(clamp(k))
            return Point(x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t))
        }
        func perShape(_ s: ShapeId?) -> Point {
            onAxis(exprAt, BotEngine.SHAPE_MORPH, eyeOffset(s, state, exprPrev?.id.rawValue), eyeOffset(s, state, expr?.id.rawValue))
        }
        return onAxis(shapeAt, BotEngine.SHAPE_MORPH, perShape(shapePrev), perShape(shape))
    }

    public func isFading(_ now: Double) -> Bool {
        prev != nil && now - tCur < STATE_BY_ID[state]!.morph
    }

    public func reset(_ id: StateId, now: Double) {
        state = id
        prev = nil
        frozenStart = nil
        tCur = now
        tPrev = now
        blinkAt = -10
    }

    private func origin(_ now: Double, _ shape: [Double]?, _ expr: BotExpression?) -> Pose? {
        if let f = frozenStart { return f }
        guard let prev else { return nil }
        return posed(STATE_BY_ID[prev]!, max(0, now - tPrev), shape, expr)
    }

    private func compositePose(_ now: Double) -> Pose {
        let def = STATE_BY_ID[state]!
        let shape = shapeAtTime(now)
        let expr = exprAtTime(now)
        let pose = posed(def, max(0, now - tCur), shape, expr)
        let since = now - tCur
        if since >= def.morph { return pose }
        guard let o = origin(now, shape, expr) else { return pose }
        return blendPose(o, pose, Easings.easeOutQuint(clamp(since / def.morph)))
    }

    public func setState(_ id: StateId, now: Double) {
        if id == state { return }
        let morph = STATE_BY_ID[state]!.morph
        let inFullFade = prev != nil && now - tCur < morph
        frozenStart = inFullFade ? compositePose(now) : nil
        prev = state
        tPrev = tCur
        state = id
        tCur = now
        if STATE_BY_ID[id]?.blinkIn == true { blinkAt = now }
    }

    public func sample(_ now: Double) -> BotFrame {
        let R = scale
        let def = STATE_BY_ID[state]!
        let shape = shapeAtTime(now)
        let expr = exprAtTime(now)
        var pose = posed(def, max(0, now - tCur), shape, expr)
        var offset = offsetAtTime(now, state)

        let since = now - tCur
        if since < def.morph, let o = origin(now, shape, expr) {
            let ratio = Easings.easeOutQuint(clamp(since / def.morph))
            pose = blendPose(o, pose, ratio)
            if let left = prev {
                let before = offsetAtTime(now, left)
                offset = Point(x: lerp(before.x, offset.x, ratio), y: lerp(before.y, offset.y, ratio))
            }
        }

        let alive = pose.eyeAlpha > 0.01
        let look = lookAtTime(now)
        let life = liveliness(now, LivelinessOptions(wander: alive ? look.wander : 0, blink: alive))
        let gaze = HeadGaze(yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
                            pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
                            roll: pose.gaze.roll + life.dRoll)
        let forced = clamp((now - blinkAt) / 0.2)
        let forcedLid = forced < 1 ? abs(forced * 2 - 1) : 1
        let lid = min(life.lid, forcedLid)
        let offX = pose.offX + life.driftX
        let offY = pose.offY + life.driftY

        var sil = pose.sil
        sil.cx = pose.sil.cx + offX
        sil.cy = pose.sil.cy + offY
        sil.sy = pose.sil.sy * life.breath
        let bodyPath = closedPath(toPoints(sil, R))

        let silRadii = pose.sil.radii, silRot = pose.sil.rot
        func bodyRadius(_ x: Double, _ y: Double) -> Double { radiusAtAngle(silRadii, atan2(y, x) - silRot) }

        var eyes: [RenderedEye] = []
        if pose.eyeAlpha > 0.01 {
            let poses = eyePoses(gaze, R, split: pose.split)
            for (e, cfg) in [(poses.0, pose.eyes.0), (poses.1, pose.eyes.1)] {
                if e.depth <= 0.02 { continue }
                let fit = bodyRadius(e.x, e.y)
                let phi = (cfg.tilt * Double.pi) / 180
                let cp = cos(phi), sp = sin(phi)
                let ax = e.a * cp + e.c * sp
                let ay = e.b * cp + e.d * sp
                let cx2 = -e.a * sp + e.c * cp
                let cy2 = -e.b * sp + e.d * cp
                let k = blinkScale(min(lid, cfg.open))
                let m = [r2(ax), r2(ay * k), r2(cx2), r2(cy2 * k), r2(e.x * fit + (offX + offset.x) * R), r2(e.y * fit + (offY + offset.y) * R)]
                eyes.append(RenderedEye(d: capsulePath(cfg.w * R, cfg.h * R),
                                        matrix: "matrix(" + m.map(jsNum).joined(separator: ",") + ")",
                                        alpha: pose.eyeAlpha * clamp(e.depth / 0.12), m: m))
            }
        }

        let dots = pose.dots.filter { $0.opacity > 0.01 && $0.r > 0.0005 }.map { p -> DotRender in
            var q = p
            q.x = (p.x + offX) * R; q.y = (p.y + offY) * R; q.r = p.r * R
            return q
        }
        var notif: Circle3? = nil, notch: Circle3? = nil
        if let n = pose.notif {
            let nFit = bodyRadius(n.x, n.y)
            let nx = (n.x * nFit + offX) * R, ny = (n.y * nFit + offY) * R
            notif = Circle3(x: nx, y: ny, r: n.r * R)
            notch = Circle3(x: nx, y: ny, r: n.notch * R)
        }
        return BotFrame(bodyPath: bodyPath, bodyAlpha: pose.bodyAlpha, eyes: eyes, dots: dots, dotsBehind: pose.dotsBehind,
                        arcs: pose.arcs.filter { $0.opacity > 0.01 }.map { arcRender($0.seed, $0.t, R, $0.id, $0.opacity) },
                        notif: notif, notch: notch)
    }
}

// MARK: eyefit (table read from golden/eyefit.json, generated into EyefitTable.swift)

public func eyeOffset(_ shape: ShapeId?, _ state: StateId, _ expr: String?) -> Point {
    guard let shape, let per = EYEFIT_TABLE[shape.rawValue] else { return Point(x: 0, y: 0) }
    return per["\(state.rawValue)|\(expr ?? "")"] ?? per["\(state.rawValue)|"] ?? Point(x: 0, y: 0)
}
