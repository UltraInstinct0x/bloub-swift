import Foundation
import Testing
@testable import HermesAvatar

/// The cross-language contract: ../golden is written by the TypeScript engine (ts/scripts/gen-golden.ts) and the
/// Swift port must reproduce it. Numbers compare at 2e-6 (the files store 1e-6); numbers inside path and matrix
/// strings compare at 0.0101, one step of the engine's two-decimal rounding, because a libm last-ulp difference
/// can move a value that sits exactly on a rounding boundary. Everything else (counts, ids, colours, commands)
/// must be identical.
enum Golden {
    /// `<package>/golden` when vendored (the app repo), else `<repo>/golden` (the hermes-avatar repo).
    static let dir: URL = {
        let pkg = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let local = pkg.appendingPathComponent("golden")
        return FileManager.default.fileExists(atPath: local.path) ? local : pkg.deletingLastPathComponent().appendingPathComponent("golden")
    }()
    static func json(_ name: String) throws -> [String: Any] {
        let data = try Data(contentsOf: dir.appendingPathComponent(name))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
}

func near(_ a: Double, _ b: Double, _ tol: Double = 2e-6) -> Bool { abs(a - b) <= tol }

/// Splits an SVG path or matrix string into commands and numbers.
func tokens(_ s: String) -> [String] {
    var out: [String] = []
    var cur = ""
    for ch in s {
        if ch.isLetter && ch != "e" || ch == "(" || ch == ")" || ch == "," || ch == " " {
            if !cur.isEmpty { out.append(cur); cur = "" }
            if ch.isLetter { out.append(String(ch)) }
        } else if ch == "-" && !cur.isEmpty && !cur.hasSuffix("e") {
            out.append(cur); cur = "-"
        } else {
            cur.append(ch)
        }
    }
    if !cur.isEmpty { out.append(cur) }
    return out
}

func samePath(_ a: String, _ b: String, _ ctx: String) -> String? {
    let ta = tokens(a), tb = tokens(b)
    if ta.count != tb.count { return "\(ctx): \(ta.count) tokens vs \(tb.count)" }
    for (x, y) in zip(ta, tb) where x != y {
        guard let dx = Double(x), let dy = Double(y), near(dx, dy, 0.0101) else { return "\(ctx): \(x) vs \(y)" }
    }
    return nil
}

func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? .nan }

func buildCase(_ c: [String: Any]) -> BotEngine {
    let e = engineForAvatar(c["profileId"] as! String, status: "idle", now: 0)
    for op in c["setup"] as! [[String: Any]] {
        let at = num(op["at"])
        switch op["kind"] as! String {
        case "state": e.setState(StateId(rawValue: op["state"] as! String)!, now: at)
        case "look":
            let l = op["look"] as! [String: Any]
            e.setLook(Look(yaw: num(l["yaw"]), pitch: num(l["pitch"]), mix: num(l["mix"]), spin: num(l["spin"]), wander: num(l["wander"])), now: at)
        case "shape": e.setShape(ShapeId(rawValue: op["shape"] as! String)!, now: at)
        case "expression": e.setExpression(EXPRESSION_BY_ID[op["expression"] as! String]!, now: at)
        default: Issue.record("unknown setup op")
        }
    }
    return e
}

func diffFrame(_ f: BotFrame, _ g: [String: Any], _ ctx: String) -> [String] {
    var errs: [String] = []
    if let e = samePath(f.bodyPath, g["bodyPath"] as! String, "\(ctx) bodyPath") { errs.append(e) }
    if !near(f.bodyAlpha, num(g["bodyAlpha"])) { errs.append("\(ctx) bodyAlpha") }
    if f.dotsBehind != (g["dotsBehind"] as! Bool) { errs.append("\(ctx) dotsBehind") }
    let ge = g["eyes"] as! [[String: Any]]
    if ge.count != f.eyes.count { errs.append("\(ctx) eyes \(f.eyes.count) vs \(ge.count)") } else {
        for (i, (a, b)) in zip(f.eyes, ge).enumerated() {
            if let e = samePath(a.d, b["d"] as! String, "\(ctx) eye\(i).d") { errs.append(e) }
            if let e = samePath(a.matrix, b["matrix"] as! String, "\(ctx) eye\(i).matrix") { errs.append(e) }
            if !near(a.alpha, num(b["alpha"])) { errs.append("\(ctx) eye\(i).alpha \(a.alpha) vs \(num(b["alpha"]))") }
        }
    }
    let gd = g["dots"] as! [[String: Any]]
    if gd.count != f.dots.count { errs.append("\(ctx) dots \(f.dots.count) vs \(gd.count)") } else {
        for (i, (a, b)) in zip(f.dots, gd).enumerated() {
            for (k, v) in [("x", a.x), ("y", a.y), ("r", a.r), ("opacity", a.opacity)] where !near(v, num(b[k])) {
                errs.append("\(ctx) dot\(i).\(k) \(v) vs \(num(b[k]))")
            }
            if let dep = a.depth, !near(dep, num(b["depth"])) { errs.append("\(ctx) dot\(i).depth") }
            if (a.depth == nil) != (b["depth"] == nil) { errs.append("\(ctx) dot\(i).depth presence") }
            if let d = a.d { if let e = samePath(d, b["d"] as? String ?? "", "\(ctx) dot\(i).d") { errs.append(e) } }
            if let r = a.rot, !near(r, num(b["rot"])) { errs.append("\(ctx) dot\(i).rot") }
        }
    }
    let ga = g["arcs"] as! [[String: Any]]
    if ga.count != f.arcs.count { errs.append("\(ctx) arcs \(f.arcs.count) vs \(ga.count)") } else {
        for (i, (a, b)) in zip(f.arcs, ga).enumerated() {
            if a.id != b["id"] as! String { errs.append("\(ctx) arc\(i).id") }
            if let e = samePath(a.front, b["front"] as! String, "\(ctx) arc\(i).front") { errs.append(e) }
            if let e = samePath(a.back, b["back"] as! String, "\(ctx) arc\(i).back") { errs.append(e) }
            if !near(a.width, num(b["width"])) || !near(a.opacity, num(b["opacity"])) { errs.append("\(ctx) arc\(i).width/opacity") }
            let gg = b["grad"] as! [String: Any]
            if a.grad.stops != gg["stops"] as! [String] { errs.append("\(ctx) arc\(i).stops \(a.grad.stops) vs \(gg["stops"]!)") }
            for (k, v) in [("x1", a.grad.x1), ("y1", a.grad.y1), ("x2", a.grad.x2), ("y2", a.grad.y2)] where !near(v, num(gg[k]), 0.0101) {
                errs.append("\(ctx) arc\(i).grad.\(k)")
            }
        }
    }
    for (name, c) in [("notif", f.notif), ("notch", f.notch)] {
        let gc = g[name] as? [String: Any]
        if (c == nil) != (gc == nil) { errs.append("\(ctx) \(name) presence"); continue }
        if let c, let gc, !(near(c.x, num(gc["x"])) && near(c.y, num(gc["y"])) && near(c.r, num(gc["r"]))) { errs.append("\(ctx) \(name)") }
    }
    return errs
}

@Suite struct GoldenTests {
    @Test func identityLooksMatchTheTypeScriptEngine() throws {
        let file = try Golden.json("identity.json")
        let cases = file["cases"] as! [[String: Any]]
        #expect(cases.count == 8)
        for c in cases {
            let id = c["profileId"] as! String
            let g = c["avatar"] as! [String: Any]
            let a = avatarFor(id)
            #expect(Double(a.seed) == num(g["seed"]), "\(id) seed")
            #expect(a.shape.rawValue == g["shape"] as! String, "\(id) shape")
            let p = g["palette"] as! [String: Any]
            #expect(a.palette.body == p["body"] as! String, "\(id) body")
            #expect(a.palette.shadow == p["shadow"] as! String, "\(id) shadow")
            #expect(a.palette.eye == p["eye"] as! String, "\(id) eye")
            #expect(near(a.palette.hue, num(p["hue"])), "\(id) hue")
            let rest = g["rest"] as! [String: Any]
            #expect(a.mood.rawValue == rest["mood"] as! String, "\(id) mood")
            #expect(a.expression.rawValue == rest["expression"] as! String, "\(id) expression")
            let tr = rest["transition"] as! [String: Any]
            for m in RestMoodId.allCases { #expect(near(a.transition[m]!, num(tr[m.rawValue])), "\(id) transition \(m)") }
        }
    }

    @Test func theEyeOffsetTableIsTheGoldenOne() throws {
        let file = try Golden.json("eyefit.json")
        let shapes = file["shapes"] as! [String: [String: [String: Any]]]
        #expect(Set(shapes.keys) == Set(ShapeId.allCases.map(\.rawValue)))
        for (shape, per) in shapes {
            #expect(EYEFIT_TABLE[shape]?.count == per.count, "\(shape) size")
            for (k, v) in per {
                let p = EYEFIT_TABLE[shape]?[k]
                #expect(p != nil && near(p!.x, num(v["x"])) && near(p!.y, num(v["y"])), "\(shape) \(k)")
            }
        }
    }

    @Test func everyGoldenFrameIsReproduced() throws {
        let file = try Golden.json("frames.json")
        let cases = file["cases"] as! [[String: Any]]
        #expect(cases.count == 12)
        var checked = 0
        var errs: [String] = []
        for c in cases {
            let e = buildCase(c)
            for s in c["samples"] as! [[String: Any]] {
                let t = num(s["t"])
                errs += diffFrame(e.sample(t), s["frame"] as! [String: Any], "\(c["id"]!)@\(t)")
                checked += 1
            }
        }
        #expect(checked == 32)
        #expect(errs.isEmpty, "\(errs.prefix(12).joined(separator: "\n"))")
    }

    @Test func theShapeRadiiAreStable() {
        #expect(SHAPES.count == 8)
        for s in SHAPES { #expect(s.radii.count == PROFILE_SAMPLES && abs((s.radii.max() ?? 0) - (s.id == .wedge ? 1.12 : s.id == .blob ? 1.02 : 1)) < 1e-12) }
    }

    @Test func statusesMapLikeTheTypeScriptTable() {
        #expect(stateForStatus("working") == .thinking)
        #expect(stateForStatus("waiting") == .wide)
        #expect(stateForStatus("error") == .burst)
        #expect(stateForStatus("speaking") == .swirl)
        #expect(stateForStatus("sleeping") == .sleep)
        #expect(stateForStatus("nonsense") == .idle)
        #expect(lookForStatus("error").revertAfter == 10)
    }
}
