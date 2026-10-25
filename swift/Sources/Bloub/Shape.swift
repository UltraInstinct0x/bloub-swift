import Foundation

// Port of ts/src/shape.ts. Radial profiles sampled at PROFILE_SAMPLES angles, so any two shapes morph by
// interpolating radii.

public struct Point: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public struct Silhouette: Equatable, Sendable {
    public var radii: [Double]
    public var rot: Double = 0
    public var cx: Double = 0
    public var cy: Double = 0
    public var sx: Double = 1
    public var sy: Double = 1
    public init(radii: [Double], rot: Double = 0, cx: Double = 0, cy: Double = 0, sx: Double = 1, sy: Double = 1) {
        self.radii = radii; self.rot = rot; self.cx = cx; self.cy = cy; self.sx = sx; self.sy = sy
    }
}

let ANGLES: [Double] = (0..<PROFILE_SAMPLES).map { Double($0) / Double(PROFILE_SAMPLES) * TAU }
let COS: [Double] = ANGLES.map { cos($0) }
let SIN: [Double] = ANGLES.map { sin($0) }

public func silhouette(_ name: String, rot: Double = 0, cx: Double = 0, cy: Double = 0, sx: Double = 1, sy: Double = 1) -> Silhouette {
    Silhouette(radii: Profiles.all[name] ?? Array(repeating: 1, count: PROFILE_SAMPLES), rot: rot, cx: cx, cy: cy, sx: sx, sy: sy)
}

public func circle(_ radius: Double, rot: Double = 0, cx: Double = 0, cy: Double = 0, sx: Double = 1, sy: Double = 1) -> Silhouette {
    Silhouette(radii: Array(repeating: radius, count: PROFILE_SAMPLES), rot: rot, cx: cx, cy: cy, sx: sx, sy: sy)
}

public func blend(_ a: Silhouette, _ b: Silhouette, _ t: Double) -> Silhouette {
    var radii = [Double](repeating: 0, count: PROFILE_SAMPLES)
    for i in 0..<PROFILE_SAMPLES {
        radii[i] = lerp(i < a.radii.count ? a.radii[i] : 1, i < b.radii.count ? b.radii[i] : 1, t)
    }
    var dRot = b.rot - a.rot
    while dRot > Double.pi { dRot -= TAU }
    while dRot < -Double.pi { dRot += TAU }
    return Silhouette(radii: radii, rot: a.rot + dRot * t, cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t),
                      sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t))
}

public func toPoints(_ s: Silhouette, _ scale: Double) -> [Point] {
    let cr = cos(s.rot), sr = sin(s.rot)
    var out: [Point] = []
    out.reserveCapacity(PROFILE_SAMPLES)
    for i in 0..<PROFILE_SAMPLES {
        let r = i < s.radii.count ? s.radii[i] : 1
        let x = r * COS[i], y = r * SIN[i]
        let rx = x * cr - y * sr
        let ry = x * sr + y * cr
        out.append(Point(x: (rx * s.sx + s.cx) * scale, y: (ry * s.sy + s.cy) * scale))
    }
    return out
}

public func closedPath(_ pts: [Point], tension: Double = 1.0 / 6) -> String {
    let n = pts.count
    if n < 3 { return "" }
    var d = "M\(jsNum(r2(pts[0].x))) \(jsNum(r2(pts[0].y)))"
    for i in 0..<n {
        let p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
        let c1x = p1.x + (p2.x - p0.x) * tension
        let c1y = p1.y + (p2.y - p0.y) * tension
        let c2x = p2.x - (p3.x - p1.x) * tension
        let c2y = p2.y - (p3.y - p1.y) * tension
        d += "C\(jsNum(r2(c1x))) \(jsNum(r2(c1y))) \(jsNum(r2(c2x))) \(jsNum(r2(c2y))) \(jsNum(r2(p2.x))) \(jsNum(r2(p2.y)))"
    }
    return d + "Z"
}

public func profileFromPolygon(_ poly: [Point], _ cx: Double, _ cy: Double) -> [Double] {
    var radii = [Double](repeating: 0, count: PROFILE_SAMPLES)
    let n = poly.count
    for k in 0..<PROFILE_SAMPLES {
        let dx = COS[k], dy = SIN[k]
        var best = 0.0
        for i in 0..<n {
            let a = poly[i], b = poly[(i + 1) % n]
            let ex = b.x - a.x, ey = b.y - a.y
            let den = dx * ey - dy * ex
            if abs(den) < 1e-9 { continue }
            let px = a.x - cx, py = a.y - cy
            let t = (px * ey - py * ex) / den
            let u = (px * dy - py * dx) / den
            if t > best && u >= 0 && u <= 1 { best = t }
        }
        radii[k] = best
    }
    return radii
}

public func hullOfCircles(_ x1: Double, _ y1: Double, _ r1: Double, _ x2: Double, _ y2: Double, _ r2v: Double, steps: Int = 96) -> [Point] {
    let dx = x2 - x1, dy = y2 - y1
    var dist = hypot(dx, dy)
    if dist == 0 { dist = 1e-6 }
    let base = atan2(dy, dx)
    let spread = acos(max(-1, min(1, (r1 - r2v) / dist)))
    var pts: [Point] = []
    let half = Double(steps) / 2
    var i = 0
    while Double(i) <= half {
        let a = base + spread + ((TAU - 2 * spread) * Double(i)) / half
        pts.append(Point(x: x1 + cos(a) * r1, y: y1 + sin(a) * r1)); i += 1
    }
    i = 0
    while Double(i) <= half {
        let a = base - spread + ((2 * spread) * Double(i)) / half
        pts.append(Point(x: x2 + cos(a) * r2v, y: y2 + sin(a) * r2v)); i += 1
    }
    return pts
}

/// JavaScript `%` on doubles (truncated remainder), which `fmod` matches.
@inline(__always) func jsMod(_ a: Double, _ b: Double) -> Double { fmod(a, b) }

public func radiusAtAngle(_ radii: [Double], _ angle: Double) -> Double {
    let n = radii.count
    let t = jsMod(jsMod(angle / TAU, 1) + 1, 1) * Double(n)
    let i = Int(floor(t))
    return lerp(radii[i % n], radii[(i + 1) % n], t - Double(i))
}

public func superellipseProfile(_ n: Double, _ sx: Double = 1, _ sy: Double = 1) -> [Double] {
    (0..<PROFILE_SAMPLES).map { i in
        let c = pow(abs(COS[i] / sx), n)
        let s = pow(abs(SIN[i] / sy), n)
        return pow(c + s, -1 / n)
    }
}

public func unionOfCirclesProfile(_ circles: [(x: Double, y: Double, r: Double)]) -> [Double] {
    var out = [Double](repeating: 0, count: PROFILE_SAMPLES)
    for i in 0..<PROFILE_SAMPLES {
        let dx = COS[i], dy = SIN[i]
        var best = 0.0
        for c in circles {
            let b = dx * c.x + dy * c.y
            let disc = b * b - (c.x * c.x + c.y * c.y - c.r * c.r)
            if disc < 0 { continue }
            let t = b + disc.squareRoot()
            if t > best { best = t }
        }
        out[i] = best
    }
    return out
}

func roundedPolygon(_ verts: [Point], _ rc: Double, arcSteps: Int = 10) -> [Point] {
    let n = verts.count
    var out: [Point] = []
    func normal(_ a: Point, _ b: Point) -> Double {
        let dx = b.x - a.x, dy = b.y - a.y
        var len = hypot(dx, dy)
        if len == 0 { len = 1 }
        return atan2(-dx / len, dy / len)
    }
    for i in 0..<n {
        let prev = verts[(i - 1 + n) % n], cur = verts[i], next = verts[(i + 1) % n]
        let a0 = normal(prev, cur), a1 = normal(cur, next)
        var d = a1 - a0
        while d > Double.pi { d -= TAU }
        while d < -Double.pi { d += TAU }
        for k in 0...arcSteps {
            let a = a0 + (d * Double(k)) / Double(arcSteps)
            out.append(Point(x: cur.x + cos(a) * rc, y: cur.y + sin(a) * rc))
        }
    }
    return out
}

public func regularPolygonProfile(_ sides: Int, _ radius: Double, _ rc: Double, _ rotationDeg: Double = 0) -> [Double] {
    let rot = (rotationDeg * Double.pi) / 180
    let verts = (0..<sides).map { i -> Point in
        let a = rot + (Double(i) / Double(sides)) * TAU
        return Point(x: cos(a) * (radius - rc), y: sin(a) * (radius - rc))
    }
    return profileFromPolygon(roundedPolygon(verts, rc), 0, 0)
}

public func polyPath(_ pts: [Point], scale: Double = 1) -> String {
    if pts.count < 3 { return "" }
    var d = ""
    for (i, p) in pts.enumerated() {
        d += "\(i == 0 ? "M" : "L")\(jsNum(r2(p.x * scale))) \(jsNum(r2(p.y * scale)))"
    }
    return d + "Z"
}

public func capsulePath(_ w: Double, _ h: Double) -> String {
    let hw = max(w, 0.01) / 2, hh = max(h, 0.01) / 2
    let r = min(hw, hh)
    let R = jsNum(r2(r))
    return "M\(jsNum(r2(-hw))) \(jsNum(r2(-hh + r)))"
        + "A\(R) \(R) 0 0 1 \(jsNum(r2(-hw + r))) \(jsNum(r2(-hh)))"
        + "L\(jsNum(r2(hw - r))) \(jsNum(r2(-hh)))"
        + "A\(R) \(R) 0 0 1 \(jsNum(r2(hw))) \(jsNum(r2(-hh + r)))"
        + "L\(jsNum(r2(hw))) \(jsNum(r2(hh - r)))"
        + "A\(R) \(R) 0 0 1 \(jsNum(r2(hw - r))) \(jsNum(r2(hh)))"
        + "L\(jsNum(r2(-hw + r))) \(jsNum(r2(hh)))"
        + "A\(R) \(R) 0 0 1 \(jsNum(r2(-hw))) \(jsNum(r2(hh - r)))Z"
}

// MARK: skins.ts

public let RADIUS = 100.0
public let HALF_VIEWBOX = 158.0

public enum ShapeId: String, CaseIterable, Sendable {
    case orb, lozenge, wedge, trefoil, quatrefoil, bean, blob, pentagon
}

public struct BotShape: Sendable {
    public let id: ShapeId
    public let radii: [Double]
}

func normalize(_ radii: [Double], _ maxV: Double = 1) -> [Double] {
    guard let peak = radii.max(), peak > 0 else { return radii }
    let k = maxV / peak
    return radii.map { $0 * k }
}

func harmonicProfile(_ terms: [(Double, Double, Double)], _ maxV: Double = 1) -> [Double] {
    normalize(ANGLES.map { a in 1 + terms.reduce(0.0) { sum, t in sum + t.0 * cos(t.1 * a + t.2) } }, maxV)
}

public let SHAPES: [BotShape] = [
    BotShape(id: .orb, radii: harmonicProfile([(0.018, 2, 0.4), (0.009, 3, 1.9)])),
    BotShape(id: .lozenge, radii: normalize(superellipseProfile(1.45), 1)),
    BotShape(id: .wedge, radii: normalize(superellipseProfile(3.2, 1.06, 0.82), 1.12)),
    BotShape(id: .trefoil, radii: harmonicProfile([(0.085, 3, -Double.pi / 2)])),
    BotShape(id: .quatrefoil, radii: harmonicProfile([(0.07, 4, 0.6)])),
    BotShape(id: .bean, radii: normalize(unionOfCirclesProfile([(-0.24, -0.16, 0.68), (0.22, 0.2, 0.6)]), 1)),
    BotShape(id: .blob, radii: harmonicProfile([(0.06, 2, 2.3), (0.035, 5, 0.7)], 1.02)),
    BotShape(id: .pentagon, radii: normalize(regularPolygonProfile(5, 1.1, 0.3, -90), 1)),
]

public let SHAPE_BY_ID: [String: BotShape] = Dictionary(uniqueKeysWithValues: SHAPES.map { ($0.id.rawValue, $0) })

public func shapeRadii(_ id: String) -> [Double]? { SHAPE_BY_ID[id]?.radii }

public func mixHex(_ from: String, _ to: String, _ t: Double) -> String {
    func parse(_ h: String) -> [Double] {
        let v = Int(h.dropFirst(), radix: 16) ?? 0
        return [Double((v >> 16) & 255), Double((v >> 8) & 255), Double(v & 255)]
    }
    let a = parse(from), b = parse(to)
    return "#" + (0..<3).map { hex2(jsRound(a[$0] + (b[$0] - a[$0]) * t)) }.joined()
}
