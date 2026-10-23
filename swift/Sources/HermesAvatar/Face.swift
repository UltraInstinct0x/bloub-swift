import Foundation

// Port of ts/src/face.ts: eyes painted on a sphere, plus life at rest (drift, blinks).

typealias Vec3 = (Double, Double, Double)

public let EYE_SPLIT = 15.46
public let EYE_W = 0.186
public let EYE_H = 0.412

public struct HeadGaze: Equatable, Sendable {
    public var yaw: Double
    public var pitch: Double
    public var roll: Double
    public init(yaw: Double, pitch: Double, roll: Double) { self.yaw = yaw; self.pitch = pitch; self.roll = roll }
}

public let REST_GAZE = HeadGaze(yaw: 28.49, pitch: 28.62, roll: -13)

public struct EyePose: Equatable, Sendable {
    public var x, y, a, b, c, d, depth: Double
}

@inline(__always) func deg(_ d: Double) -> Double { (d * Double.pi) / 180 }

func spin(_ u: Vec3, _ v: Vec3, _ angle: Double) -> (Vec3, Vec3) {
    let c = cos(angle), s = sin(angle)
    return ((u.0 * c + v.0 * s, u.1 * c + v.1 * s, u.2 * c + v.2 * s),
            (v.0 * c - u.0 * s, v.1 * c - u.1 * s, v.2 * c - u.2 * s))
}

public func eyePoses(_ gaze: HeadGaze, _ scale: Double, split: Double = EYE_SPLIT) -> (EyePose, EyePose) {
    var f: Vec3 = (0, 0, 1)
    var right: Vec3 = (1, 0, 0)
    var down: Vec3 = (0, 1, 0)
    (f, right) = spin(f, right, deg(gaze.yaw))
    (down, f) = spin(down, f, deg(gaze.pitch))
    (right, down) = spin(right, down, deg(gaze.roll))
    func build(_ side: Double) -> EyePose {
        let (ef, er) = spin(f, right, deg(split * side))
        return EyePose(x: ef.0 * scale, y: ef.1 * scale, a: er.0, b: er.1, c: down.0, d: down.1, depth: ef.2)
    }
    return (build(-1), build(1))
}

public struct Liveliness: Sendable {
    public var dYaw, dPitch, dRoll, lid, driftX, driftY, breath: Double
}

let BLINKS: [Double] = {
    var rng = Rng(seed: 0x5eed)
    var out: [Double] = []
    var t = 1.4
    while t < 900 {
        out.append(t)
        t += 1.9 + rng.next() * 2.7
        if rng.next() < 0.18 {
            out.append(t)
            t += 0.24
        }
    }
    return out
}()

let BLINK_DUR = 0.18

func blinkLid(_ t: Double) -> Double {
    for start in BLINKS {
        if t < start { break }
        let k = (t - start) / BLINK_DUR
        if k >= 0 && k <= 1 { return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55 }
    }
    return 1
}

public struct LivelinessOptions: Sendable {
    public var wander: Double = 1
    public var blink: Bool = true
    public var float: Bool = true
    public init(wander: Double = 1, blink: Bool = true, float: Bool = true) { self.wander = wander; self.blink = blink; self.float = float }
}

public func liveliness(_ t: Double, _ opt: LivelinessOptions = LivelinessOptions()) -> Liveliness {
    let w = opt.wander
    return Liveliness(
        dYaw: (loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6) * w,
        dPitch: (loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3) * w,
        dRoll: loopNoise(t, 13.7, 3.2) * 2.2 * w,
        lid: opt.blink ? blinkLid(t) : 1,
        driftX: opt.float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
        driftY: opt.float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
        breath: opt.float ? 1 + sin((t / 3.4) * Double.pi * 2) * 0.005 : 1
    )
}

public func blinkScale(_ lid: Double) -> Double { 0.06 + 0.94 * clamp(lid) }
