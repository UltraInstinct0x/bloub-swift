import Foundation

// Port of ts/src/identity.ts and ts/src/status.ts: the look derived from a profile id, and the status mapping.

public let SEED_PREFIX = "hermes-avatar/v1:"

public enum RestMoodId: String, CaseIterable, Sendable { case calm, bright, amused }

public let REST_MOODS: [(id: RestMoodId, expression: ExpressionId)] = [(.calm, .neutre), (.bright, .attentif), (.amused, .heureux)]

public struct AvatarPalette: Equatable, Sendable {
    public var hue: Double
    public var body: String
    public var shadow: String
    public var eye: String
    public var oklchBody: [Double]
    public var oklchShadow: [Double]
    public var oklchEye: [Double]
}

public struct Avatar: Equatable, Sendable {
    public var profileId: String
    public var seed: UInt32
    public var shape: ShapeId
    public var palette: AvatarPalette
    public var mood: RestMoodId
    public var expression: ExpressionId
    public var transition: [RestMoodId: Double]
}

public func seedFor(_ profileId: String) -> UInt32 { fnv1a32(SEED_PREFIX + profileId) }

func linearSrgb(_ l: Double, _ c: Double, _ hDeg: Double) -> [Double] {
    let h = (hDeg * Double.pi) / 180
    let a = c * cos(h), b = c * sin(h)
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b
    let s_ = l - 0.0894841775 * a - 1.291485548 * b
    let L = l_ * l_ * l_, M = m_ * m_ * m_, S = s_ * s_ * s_
    return [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
            -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
            -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S]
}

public func oklchToHex(_ l: Double, _ c: Double, _ hDeg: Double) -> String {
    func fits(_ chroma: Double) -> Bool { linearSrgb(l, chroma, hDeg).allSatisfy { $0 >= -1e-6 && $0 <= 1 + 1e-6 } }
    var chroma = c
    if !fits(c) {
        var lo = 0.0, hi = c
        if fits(0) {
            for _ in 0..<16 {
                let mid = (lo + hi) / 2
                if fits(mid) { lo = mid } else { hi = mid }
            }
            chroma = lo
        } else {
            chroma = 0
        }
    }
    func channel(_ v: Double) -> String {
        let enc = v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055
        return hex2(jsRound(min(1, max(0, enc)) * 255))
    }
    let rgb = linearSrgb(l, chroma, hDeg)
    return "#\(channel(rgb[0]))\(channel(rgb[1]))\(channel(rgb[2]))"
}

func span(_ r: (Double, Double), _ u: Double) -> Double { r.0 + (r.1 - r.0) * u }

public func avatarFor(_ profileId: String) -> Avatar {
    let seed = seedFor(profileId)
    var rng = Rng(seed: seed)
    let shapeIndex = min(SHAPES.count - 1, Int(floor(rng.next() * Double(SHAPES.count))))
    let shape = SHAPES[shapeIndex]
    let hue = rng.next() * 360
    let bodyL = span((0.62, 0.72), rng.next())
    let bodyC = span((0.1, 0.16), rng.next())
    let shadowL = span((0.44, 0.52), rng.next())
    let shadowC = span((0.07, 0.12), rng.next())
    let eyeL = span((0.13, 0.2), rng.next())
    let eyeC = span((0.02, 0.05), rng.next())
    let eyeHue = jsMod(hue + span((150, 210), rng.next()), 360)
    let mood = REST_MOODS[min(REST_MOODS.count - 1, Int(floor(rng.next() * Double(REST_MOODS.count))))]
    let driftChance = span((0.06, 0.16), rng.next())
    let driftSplit = span((0.35, 0.65), rng.next())
    let others = REST_MOODS.filter { $0.id != mood.id }.map(\.id)
    var transition: [RestMoodId: Double] = [.calm: 0, .bright: 0, .amused: 0]
    transition[mood.id] = 1 - driftChance
    transition[others[0]] = driftChance * driftSplit
    transition[others[1]] = driftChance * (1 - driftSplit)
    return Avatar(profileId: profileId, seed: seed, shape: shape.id,
                  palette: AvatarPalette(hue: hue, body: oklchToHex(bodyL, bodyC, hue), shadow: oklchToHex(shadowL, shadowC, hue),
                                         eye: oklchToHex(eyeL, eyeC, eyeHue), oklchBody: [bodyL, bodyC, hue],
                                         oklchShadow: [shadowL, shadowC, hue], oklchEye: [eyeL, eyeC, eyeHue]),
                  mood: mood.id, expression: mood.expression, transition: transition)
}

public func restExpression(_ profileId: String) -> BotExpression { EXPRESSION_BY_ID[avatarFor(profileId).expression.rawValue]! }

// MARK: status.ts

public enum BotStatus: String, CaseIterable, Sendable { case idle, working, waiting, error, speaking, sleeping }

public struct StatusLook: Sendable {
    public let state: StateId
    public let loop: Bool
    public let fps: Double
    public let revertTo: BotStatus?
    public let revertAfter: Double?
}

public let STATUS_LOOKS: [BotStatus: StatusLook] = [
    .idle: StatusLook(state: .idle, loop: true, fps: 4, revertTo: nil, revertAfter: nil),
    .working: StatusLook(state: .thinking, loop: true, fps: 30, revertTo: nil, revertAfter: nil),
    .waiting: StatusLook(state: .wide, loop: false, fps: 12, revertTo: nil, revertAfter: nil),
    .error: StatusLook(state: .burst, loop: false, fps: 30, revertTo: .idle, revertAfter: 10),
    .speaking: StatusLook(state: .orbit, loop: true, fps: 30, revertTo: nil, revertAfter: nil),
    .sleeping: StatusLook(state: .sleep, loop: true, fps: 4, revertTo: nil, revertAfter: nil),
]

public func lookForStatus(_ status: String) -> StatusLook { STATUS_LOOKS[BotStatus(rawValue: status) ?? .idle]! }
public func stateForStatus(_ status: String) -> StateId { lookForStatus(status).state }

public func engineForAvatar(_ profileId: String, status: String = "idle", scale: Double = RADIUS, now: Double = 0) -> BotEngine {
    let avatar = avatarFor(profileId)
    let engine = BotEngine(scale: scale, initial: .idle, shape: avatar.shape, expression: restExpression(profileId))
    engine.reset(stateForStatus(status), now: now)
    return engine
}

@discardableResult
public func applyStatus(_ engine: BotEngine, _ status: String, now: Double) -> StatusLook {
    let look = lookForStatus(status)
    engine.setState(look.state, now: now)
    return look
}
