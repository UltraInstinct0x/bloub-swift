import Foundation

// Port of ts/src/states.ts and ts/src/expressions.ts.

public struct EyeCfg: Equatable, Sendable {
    public var w: Double
    public var h: Double
    public var open: Double
    public var tilt: Double
    public init(w: Double, h: Double, open: Double = 1, tilt: Double = 0) { self.w = w; self.h = h; self.open = open; self.tilt = tilt }
}

public struct Notif: Equatable, Sendable { public var x, y, r, notch: Double }

public struct Pose: Sendable {
    public var sil = circle(1)
    public var offX = 0.0
    public var offY = 0.0
    public var gaze = REST_GAZE
    public var split = EYE_SPLIT
    public var eyes: (EyeCfg, EyeCfg) = (EyeCfg(w: EYE_W, h: EYE_H), EyeCfg(w: EYE_W, h: EYE_H))
    public var eyeAlpha = 1.0
    public var bodyAlpha = 1.0
    public var dots: [DotRender] = []
    public var arcs: [ArcSpec] = []
    public var notif: Notif? = nil
    public var dotsBehind = false
    public init() {}
}

func pair(_ w: Double, _ h: Double) -> (EyeCfg, EyeCfg) { (EyeCfg(w: w, h: h), EyeCfg(w: w, h: h)) }

func base(_ edit: (inout Pose) -> Void = { _ in }) -> Pose {
    var p = Pose()
    edit(&p)
    return p
}

let BAR_UPRIGHT_CY = -0.1875
let BAR_UPRIGHT = profileFromPolygon(hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075), 0, BAR_UPRIGHT_CY)
let BAR_ITALIC = profileFromPolygon(hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0)
let TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012))
let TRI_ORBIT = 0.213

func spinningTriangle(_ rot: Double) -> Silhouette {
    silhouette("triangle", rot: rot, cx: -TRI_ORBIT * sin(rot), cy: TRI_ORBIT * cos(rot))
}

public enum StateId: String, CaseIterable, Sendable {
    case idle, thinking, wink, wide, alert, notify, exclaim, sleep, egg, hexagon, play, orbit, burst, comet, swirl
}

public struct StateDef: Sendable {
    public let id: StateId
    public let duration: Double
    public let minDuration: Double?
    public let morph: Double
    public let blinkIn: Bool
    public let baseBody: Bool
    public let baseFace: Bool
    public let pose: @Sendable (Double) -> Pose
}

func dotPulse(_ t: Double, _ index: Double) -> Double {
    let p = jsMod(jsMod((t - index * 0.5) / 1.5, 1) + 1, 1)
    let k = p < 0.5 ? 0.5 - 0.5 * cos(p * TAU) : 0
    return clamp(k * 2)
}

public let STATES: [StateDef] = [
    StateDef(id: .idle, duration: 2.4, minDuration: nil, morph: 0.45, blinkIn: false, baseBody: true, baseFace: true) { _ in base() },
    StateDef(id: .thinking, duration: 2.6, minDuration: nil, morph: 0.4, blinkIn: true, baseBody: false, baseFace: false) { t in
        let mid = dotPulse(t, 1)
        let emerge = 0.3 + 0.7 * Easings.easeOutCubic(clamp(t / 0.3))
        return base { p in
            p.sil = circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), cx: DOT_X[1])
            p.eyeAlpha = 0
            p.dots = [0, 2].map { i in
                let k = dotPulse(t, Double(i))
                return DotRender(x: DOT_X[i] * emerge, y: 0, r: DOT_R * (1 + (DOT_PEAK - 1) * k), opacity: 0.55 + 0.45 * k)
            }
        }
    },
    StateDef(id: .wink, duration: 1.6, minDuration: nil, morph: 0.3, blinkIn: true, baseBody: true, baseFace: false) { _ in
        base { p in
            p.gaze = HeadGaze(yaw: -5.37, pitch: 4.55, roll: 6.7)
            p.split = 16.25
            p.eyes = (EyeCfg(w: 0.236, h: 0.464), EyeCfg(w: 0.447, h: 0.089))
        }
    },
    StateDef(id: .wide, duration: 1.8, minDuration: nil, morph: 0.55, blinkIn: true, baseBody: true, baseFace: false) { _ in
        base { p in
            p.gaze = HeadGaze(yaw: 6.92, pitch: -21.96, roll: 11.6)
            p.split = 18.43
            p.eyes = pair(0.356, 0.875)
        }
    },
    StateDef(id: .alert, duration: 2.4, minDuration: 2, morph: 0.45, blinkIn: false, baseBody: false, baseFace: false) { t in
        let pr = clamp(t / 1.5)
        let travel = Easings.easeInOutCubic(pr) * 0.82 - 0.087
        let back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0
        let x = travel * (1 - back) + 0.1 * back
        let buzz = sin(t * 2.5 * TAU) * 0.005
        let tilt = (17.7 * Double.pi) / 180
        return base { p in
            p.sil = Silhouette(radii: BAR_ITALIC, rot: tilt, cx: x, cy: -0.325 - buzz)
            p.eyeAlpha = 0
            p.dots = [DotRender(x: x - sin(tilt) * 0.58, y: -0.325 + cos(tilt) * 0.58 + buzz * 2.8, r: 0.118, opacity: 1,
                                d: TEAR, rot: (tilt * 180) / Double.pi)]
        }
    },
    StateDef(id: .notify, duration: 2.2, minDuration: nil, morph: 0.5, blinkIn: true, baseBody: true, baseFace: false) { t in
        let pr = clamp(t / 0.45)
        let pop = 1 + (NOTIF_POP - 1) * sin(pr * Double.pi) * (1 - pr * 0.35)
        let r = NOTIF_R * (pr < 1 ? pop : 1)
        let a = (NOTIF_ANGLE * Double.pi) / 180
        return base { p in
            p.gaze = HeadGaze(yaw: -21.94, pitch: -5.82, roll: -12.2)
            p.split = 18.89
            p.eyes = pair(0.505, 0.498)
            p.notif = Notif(x: cos(a) * NOTIF_DIST, y: sin(a) * NOTIF_DIST, r: r, notch: r + NOTIF_MARGIN)
        }
    },
    StateDef(id: .exclaim, duration: 2, minDuration: nil, morph: 0.45, blinkIn: false, baseBody: false, baseFace: false) { _ in
        base { p in
            p.sil = Silhouette(radii: BAR_UPRIGHT, cy: BAR_UPRIGHT_CY)
            p.eyeAlpha = 0
            p.dots = [DotRender(x: -0.012, y: 0.526, r: 0.113, opacity: 1)]
        }
    },
    StateDef(id: .sleep, duration: 2.4, minDuration: nil, morph: 0.5, blinkIn: false, baseBody: false, baseFace: false) { t in
        base { p in
            p.sil = circle(0.1585, cy: 0.11 + sin(t * (TAU / 0.6)) * 0.19)
            p.eyeAlpha = 0
        }
    },
    StateDef(id: .egg, duration: 1.8, minDuration: nil, morph: 0.4, blinkIn: true, baseBody: false, baseFace: false) { _ in
        base { p in
            p.sil = silhouette("egg")
            p.gaze = HeadGaze(yaw: 19.97, pitch: 26.01, roll: -17.1)
            p.split = 11.07
            p.eyes = pair(0.164, 0.385)
        }
    },
    StateDef(id: .hexagon, duration: 1.6, minDuration: nil, morph: 0.4, blinkIn: true, baseBody: false, baseFace: false) { _ in
        base { p in
            p.sil = silhouette("hexagon")
            p.gaze = HeadGaze(yaw: 23.11, pitch: 24.42, roll: -13.3)
            p.split = 13.37
            p.eyes = pair(0.177, 0.411)
        }
    },
    StateDef(id: .play, duration: 2, minDuration: nil, morph: 0.5, blinkIn: true, baseBody: false, baseFace: false) { t in
        let fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5)
        return base { p in
            p.sil = spinningTriangle(0)
            p.gaze = HeadGaze(yaw: 12, pitch: -8, roll: -6)
            p.split = 15
            p.eyes = pair(0.18, 0.34)
            p.arcs = SWOOSH.enumerated().map { i, s in
                var seed = s
                seed.cx = 0.45 - t * 0.42
                return ArcSpec(id: "sw\(i)", seed: seed, t: t, opacity: fade)
            }
        }
    },
    StateDef(id: .orbit, duration: 3.4, minDuration: 2.5, morph: 0.6, blinkIn: false, baseBody: false, baseFace: false) { t in
        let ramp = Easings.easeInOutCubic(clamp(t / 0.35))
        let rot = -TAU * 1.25 * t * ramp
        let back = Easings.easeInOutCubic(clamp((t - 1.6) / 0.9))
        let tri = spinningTriangle(rot)
        let sil = Silhouette(radii: tri.radii.map { r in r + (1 - r) * back }, rot: rot, cx: tri.cx * (1 - back), cy: tri.cy * (1 - back))
        let fade = clamp(t / 0.8) * clamp((3.6 - t) / 0.9)
        return base { p in
            p.sil = sil
            p.gaze = HeadGaze(yaw: REST_GAZE.yaw + sin(t * 6.5) * 65 * (1 - back), pitch: -4 + back * 32, roll: -13)
            p.eyes = pair(0.18, 0.34 + back * 0.07)
            p.arcs = RINGS.enumerated().map { i, s in
                ArcSpec(id: "rg\(i)", seed: s, t: t, opacity: fade * clamp((t - Double(i) * 0.13) / 0.3))
            }
        }
    },
    StateDef(id: .swirl, duration: 1.3, minDuration: 1.3, morph: 0.3, blinkIn: true, baseBody: true, baseFace: true) { t in
        base { p in
            p.arcs = RINGS.prefix(3).enumerated().map { i, s in
                ArcSpec(id: "sw\(i)", seed: s, t: t, opacity: clamp((t - Double(i) * 0.06) / 0.14) * clamp((1.22 - t) / 0.34))
            }
        }
    },
    StateDef(id: .burst, duration: 2.6, minDuration: 2.4, morph: 0.4, blinkIn: false, baseBody: false, baseFace: false) { t in
        let collapse = 1 - 0.834 * Easings.easeOutQuint(clamp(t / 0.7))
        let regrow = Easings.easeOutQuint(clamp((t - 1.7) / 0.7))
        return base { p in
            p.sil = circle(collapse + (1 - collapse) * regrow)
            p.eyeAlpha = clamp((t - 1.85) / 0.4)
            p.dots = particles(t, 1)
            p.dotsBehind = true
        }
    },
    StateDef(id: .comet, duration: 2.4, minDuration: 2.4, morph: 0.45, blinkIn: false, baseBody: false, baseFace: false) { t in
        let collapse = 1 - (1 - COMET_DOT) * Easings.easeOutQuint(clamp(t / 0.55))
        let regrow = Easings.easeOutQuint(clamp((t - 1.85) / 0.6))
        let fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3)
        return base { p in
            p.sil = circle(collapse + (1 - collapse) * regrow, cy: sin(clamp(t / 1.7) * Double.pi) * 0.035)
            p.eyeAlpha = clamp((t - 2) / 0.35)
            p.arcs = COMET_RIBBONS.enumerated().map { i, s in ArcSpec(id: "cm\(i)", seed: s, t: t, opacity: fade) }
        }
    },
]

public let STATE_BY_ID: [StateId: StateDef] = Dictionary(uniqueKeysWithValues: STATES.map { ($0.id, $0) })

public let POSES: [StateId: Double] = [
    .idle: 1, .thinking: 1.1, .wink: 0.8, .wide: 0.8, .alert: 0.75, .notify: 0.9, .exclaim: 0.8, .sleep: 0.45,
    .egg: 0.8, .hexagon: 0.8, .play: 0.9, .orbit: 1.2, .swirl: 0.9, .burst: 0.45, .comet: 1.15,
]

// MARK: expressions.ts

public enum ExpressionId: String, CaseIterable, Sendable {
    case neutre, attentif, surpris, excite, heureux, hilare, colere, triste, effraye, mefiant, confus, curieux, fier, timide, blase, somnolent
}

public struct BotExpression: Sendable {
    public var id: ExpressionId
    public var gaze: HeadGaze
    public var split: Double
    public var eyes: (EyeCfg, EyeCfg)
}

func eye(_ w: Double, _ h: Double, _ tilt: Double = 0, _ open: Double = 1) -> EyeCfg { EyeCfg(w: w, h: h, open: open, tilt: tilt) }
func epair(_ w: Double, _ h: Double, _ tilt: Double = 0, _ open: Double = 1) -> (EyeCfg, EyeCfg) { (eye(w, h, tilt, open), eye(w, h, -tilt, open)) }

public let EXPRESSIONS: [BotExpression] = [
    BotExpression(id: .neutre, gaze: REST_GAZE, split: EYE_SPLIT, eyes: (eye(EYE_W, EYE_H), eye(EYE_W, EYE_H))),
    BotExpression(id: .attentif, gaze: HeadGaze(yaw: 4, pitch: 5, roll: -4), split: 16, eyes: epair(0.21, 0.44)),
    BotExpression(id: .surpris, gaze: HeadGaze(yaw: 3, pitch: -3, roll: 0), split: 19, eyes: epair(0.45, 0.47)),
    BotExpression(id: .excite, gaze: HeadGaze(yaw: 6, pitch: -14, roll: 0), split: 19.5, eyes: epair(0.4, 0.56, -10)),
    BotExpression(id: .heureux, gaze: HeadGaze(yaw: 5, pitch: 9, roll: 0), split: 17, eyes: epair(0.27, 0.17, 14)),
    BotExpression(id: .hilare, gaze: HeadGaze(yaw: 4, pitch: 14, roll: 0), split: 18, eyes: epair(0.34, 0.13, 20)),
    BotExpression(id: .colere, gaze: HeadGaze(yaw: 3, pitch: 7, roll: 0), split: 17, eyes: epair(0.34, 0.15, 30)),
    BotExpression(id: .triste, gaze: HeadGaze(yaw: 3, pitch: -13, roll: 0), split: 16, eyes: epair(0.22, 0.4, -28)),
    BotExpression(id: .effraye, gaze: HeadGaze(yaw: 2, pitch: -20, roll: 0), split: 20.5, eyes: epair(0.4, 0.6)),
    BotExpression(id: .mefiant, gaze: HeadGaze(yaw: 12, pitch: 6, roll: -6), split: 16, eyes: (eye(0.21, 0.4), eye(0.22, 0.15))),
    BotExpression(id: .confus, gaze: HeadGaze(yaw: -14, pitch: 3, roll: 8), split: 16.5, eyes: (eye(0.2, 0.44, -18), eye(0.28, 0.17, 14))),
    BotExpression(id: .curieux, gaze: HeadGaze(yaw: 16, pitch: -9, roll: -15), split: 16.5, eyes: (eye(0.24, 0.46, -8), eye(0.2, 0.38, -8))),
    BotExpression(id: .fier, gaze: HeadGaze(yaw: 5, pitch: 17, roll: 0), split: 17, eyes: epair(0.3, 0.15, 18)),
    BotExpression(id: .timide, gaze: HeadGaze(yaw: -19, pitch: -14, roll: -7), split: 14, eyes: epair(0.17, 0.3)),
    BotExpression(id: .blase, gaze: HeadGaze(yaw: -22, pitch: 2, roll: 0), split: 16, eyes: epair(0.3, 0.12)),
    BotExpression(id: .somnolent, gaze: HeadGaze(yaw: 6, pitch: -9, roll: -3), split: 16, eyes: epair(0.2, 0.42, 0, 0.42)),
]

public let EXPRESSION_BY_ID: [String: BotExpression] = Dictionary(uniqueKeysWithValues: EXPRESSIONS.map { ($0.id.rawValue, $0) })

func lerpEyeCfg(_ a: EyeCfg, _ b: EyeCfg, _ t: Double) -> EyeCfg {
    EyeCfg(w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), open: lerp(a.open, b.open, t), tilt: lerp(a.tilt, b.tilt, t))
}

public func blendExpression(_ a: BotExpression, _ b: BotExpression, _ t: Double) -> BotExpression {
    BotExpression(id: b.id,
                  gaze: HeadGaze(yaw: lerp(a.gaze.yaw, b.gaze.yaw, t), pitch: lerp(a.gaze.pitch, b.gaze.pitch, t), roll: lerp(a.gaze.roll, b.gaze.roll, t)),
                  split: lerp(a.split, b.split, t),
                  eyes: (lerpEyeCfg(a.eyes.0, b.eyes.0, t), lerpEyeCfg(a.eyes.1, b.eyes.1, t)))
}
