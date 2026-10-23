import Foundation

// Port of ts/src/decor.ts: rings, swoosh, comet ribbons, particles, notification pastille.

func wheel(_ hue: Double, _ s: Double = 0.55, _ l: Double = 0.62) -> String {
    let h = jsMod(jsMod(hue, 360) + 360, 360)
    let c = (1 - abs(2 * l - 1)) * s
    let x = c * (1 - abs(jsMod(h / 60, 2) - 1))
    let m = l - c / 2
    let rgb: (Double, Double, Double) =
        h < 60 ? (c, x, 0) : h < 120 ? (x, c, 0) : h < 180 ? (0, c, x) : h < 240 ? (0, x, c) : h < 300 ? (x, 0, c) : (c, 0, x)
    func hx(_ v: Double) -> String { hex2(jsRound((v + m) * 255)) }
    return "#\(hx(rgb.0))\(hx(rgb.1))\(hx(rgb.2))"
}

public struct DotRender: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var r: Double
    public var opacity: Double
    public var color: String? = nil
    public var depth: Double? = nil
    public var d: String? = nil
    public var rot: Double? = nil
}

public struct ArcSeed: Sendable {
    public var a, k, tilt, speed, phase, sweep, hue, hueSpan, width, cx, cy: Double
}

public struct ArcSpec: Sendable {
    public var id: String
    public var seed: ArcSeed
    public var t: Double
    public var opacity: Double
}

public struct ArcGradient: Equatable, Sendable {
    public var x1, y1, x2, y2: Double
    public var stops: [String]
}

public struct ArcRender: Equatable, Sendable {
    public var id: String
    public var front: String
    public var back: String
    public var width: Double
    public var opacity: Double
    public var grad: ArcGradient
}

public func arcRender(_ seed: ArcSeed, _ t: Double, _ scale: Double, _ id: String, _ opacity: Double = 1) -> ArcRender {
    let spin = seed.phase + t * seed.speed * TAU
    let cu = cos(seed.tilt), su = sin(seed.tilt)
    let kz = max(0, 1 - seed.k * seed.k).squareRoot()
    let N = 64
    let span = seed.sweep * TAU
    var front = "", back = ""
    var prev: Bool? = nil
    for i in 0...N {
        let th = spin + (Double(i) / Double(N)) * span
        let ct = cos(th), st = sin(th)
        let x = seed.a * (ct * cu + st * -su * seed.k) + seed.cx
        let y = seed.a * (ct * su + st * cu * seed.k) + seed.cy
        let z = seed.a * st * kz
        let behind = z < 0
        let sx = jsNum(r2(x * scale)), sy = jsNum(r2(y * scale))
        let cmd = behind != prev ? "M" : "L"
        if behind { back += "\(cmd)\(sx) \(sy)" } else { front += "\(cmd)\(sx) \(sy)" }
        prev = behind
    }
    let gx = cos(seed.tilt) * seed.a * scale
    let gy = sin(seed.tilt) * seed.a * scale
    return ArcRender(
        id: id, front: front, back: back, width: seed.width * scale, opacity: opacity,
        grad: ArcGradient(x1: r2(seed.cx * scale - gx), y1: r2(seed.cy * scale - gy),
                          x2: r2(seed.cx * scale + gx), y2: r2(seed.cy * scale + gy),
                          stops: [wheel(seed.hue), wheel(seed.hue + seed.hueSpan * 0.5), wheel(seed.hue + seed.hueSpan)]))
}

public let RINGS: [ArcSeed] = {
    var rng = Rng(seed: 0xa11ce)
    return (0..<6).map { i in
        let i = Double(i)
        let a = 1.3 + rng.next() * 0.1
        let k = 0.05 + rng.next() * 0.4
        let tilt = (i / 6) * Double.pi + rng.next() * 0.5
        let speed = 3 + rng.next() * 0.7
        let phase = rng.next() * TAU
        let sweep = 0.6 + rng.next() * 0.25
        let hue = (i * 360) / 6 + rng.next() * 30
        let hueSpan = 60 + rng.next() * 60
        let width = 0.05 + rng.next() * 0.012
        return ArcSeed(a: a, k: k, tilt: tilt, speed: speed, phase: phase, sweep: sweep, hue: hue, hueSpan: hueSpan,
                       width: width, cx: 0, cy: 0.1)
    }
}()

public let SWOOSH: [ArcSeed] = (0..<4).map { i in
    let i = Double(i)
    return ArcSeed(a: 0.78 + i * 0.2, k: 0.05 + i * 0.02, tilt: -0.62 + i * 0.05, speed: 0.3, phase: 0.06 * i, sweep: 0.4,
                   hue: 95 + i * 62, hueSpan: 100, width: 0.05, cx: 0, cy: -0.12)
}

public let DOT_X: [Double] = [-0.557, -0.013, 0.532]
public let DOT_R = 0.165
public let DOT_PEAK = 1.25

struct Particle { let birth, angle, rho: Double }

let PARTICLES: [Particle] = {
    var rng = Rng(seed: 0xbeef)
    return (0..<5).map { i in
        let angle = rng.next() * TAU
        let rho = 0.58 + rng.next() * 0.18
        return Particle(birth: Double(i) * 0.2, angle: angle, rho: rho)
    }
}()

public func particles(_ t: Double, _ scale: Double) -> [DotRender] {
    var out: [DotRender] = []
    for p in PARTICLES {
        let u = t - p.birth
        if u < 0 || u > 0.62 { continue }
        let rho = p.rho * pow(0.75, u * 10)
        let a = p.angle + (u * 100 * Double.pi) / 180
        out.append(DotRender(x: cos(a) * rho * scale, y: sin(a) * rho * scale, r: (0.04 + 0.028 * clamp(u / 0.55)) * scale,
                             opacity: clamp(u / 0.06) * clamp((0.62 - u) / 0.08), depth: clamp(1 - rho / 0.8)))
    }
    return out
}

public let COMET_RIBBONS: [ArcSeed] = {
    var rng = Rng(seed: 0xc0e7)
    return (0..<4).map { i in
        let d = Double(i) - 1.5
        let phase = -Double(i) * 0.045 + rng.next() * 0.012
        let hue = Double(i) * 85 + rng.next() * 20
        return ArcSeed(a: 0.85 * (1 + d * 0.03), k: (0.15 / 0.85) * (1 + d * 0.16), tilt: (34 * Double.pi) / 180 + d * 0.035,
                       speed: 210.0 / 360, phase: phase, sweep: 0.34, hue: hue, hueSpan: 80, width: 0.095, cx: 0, cy: 0)
    }
}()

public let COMET_DOT = 0.129
public let NOTIF_BLUE = "#2496e8"
public let NOTIF_ANGLE = -42.0
public let NOTIF_DIST = 1.003
public let NOTIF_R = 0.15
public let NOTIF_POP = 1.14
public let NOTIF_MARGIN = 0.054
