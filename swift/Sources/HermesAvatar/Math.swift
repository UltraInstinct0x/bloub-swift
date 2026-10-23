import Foundation

// Port of ts/src/math.ts. Every helper here reproduces the JavaScript semantics exactly (Math.round, >>>,
// Math.imul, String(number)), because the golden files are written by the TypeScript engine.

public let TAU = Double.pi * 2

@inline(__always) public func clamp(_ v: Double, _ lo: Double = 0, _ hi: Double = 1) -> Double { v < lo ? lo : (v > hi ? hi : v) }
@inline(__always) public func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

public enum Easings {
    public static func easeOutCubic(_ t: Double) -> Double { 1 - pow(1 - t, 3) }
    public static func easeInOutCubic(_ t: Double) -> Double { t < 0.5 ? 4 * pow(t, 3) : 1 - pow(-2 * t + 2, 3) / 2 }
    public static func easeOutQuint(_ t: Double) -> Double { 1 - pow(1 - t, 5) }
}

/// Seamless 1D periodic noise (gaze drift).
public func loopNoise(_ t: Double, _ period: Double, _ seed: Double = 0) -> Double {
    let p = (t / period) * TAU
    return 0.55 * sin(p + seed) + 0.3 * sin(2 * p + seed * 1.7 + 1.1) + 0.15 * sin(3 * p + seed * 2.3 + 2.4)
}

/// mulberry32, bit for bit.
public struct Rng {
    private var a: UInt32
    public init(seed: UInt32) { a = seed }
    public mutating func next() -> Double {
        a = a &+ 0x6d2b79f5
        var t = (a ^ (a >> 15)) &* (1 | a)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double(t ^ (t >> 14)) / 4294967296
    }
}

/// 32-bit FNV-1a over UTF-16 code units (JavaScript `charCodeAt`).
public func fnv1a32(_ input: String) -> UInt32 {
    var h: UInt32 = 0x811c9dc5
    for unit in input.utf16 {
        h ^= UInt32(unit)
        h = h &* 0x01000193
    }
    return h
}

/// JavaScript `Math.round`: half rounds towards +infinity.
@inline(__always) public func jsRound(_ x: Double) -> Double {
    let f = floor(x)
    return x - f >= 0.5 ? f + 1 : f
}

@inline(__always) public func r2(_ v: Double) -> Double { jsRound(v * 100) / 100 }

public func round6(_ v: Double) -> Double {
    let r = jsRound(v * 1e6) / 1e6
    return r == 0 ? 0 : r
}

/// JavaScript `String(number)` for the values the engine prints (finite, short decimals).
public func jsNum(_ v: Double) -> String {
    if v == 0 { return "0" }
    if v == v.rounded(), abs(v) < 1e15 { return String(Int64(v)) }
    var s = "\(v)"
    if s.contains("e") {
        // the engine never prints these magnitudes after r2; keep a JavaScript-like exponent if it ever does
        s = s.replacingOccurrences(of: "e-0", with: "e-").replacingOccurrences(of: "e+0", with: "e+")
    }
    return s
}

func hex2(_ v: Double) -> String {
    let s = String(Int(v), radix: 16)
    return s.count < 2 ? "0" + s : s
}
