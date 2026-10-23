import Foundation
import HermesAvatar
import SwiftUI
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
#endif

// SwiftUI renderer for the HermesAvatar engine: one frame -> one Canvas. The engine is clockless; the view is
// the clock (TimelineView at the status's own rate) and nothing else.

/// The bot status the avatar plays (idle, working, waiting, error, speaking, sleeping), re-exported so an app can
/// import only HermesAvatarUI and keep the engine's helper names out of its own namespace.
public typealias BloubStatus = HermesAvatar.BotStatus

/// The profile id inside a composite bot key (`gateway::profile`); the identity seed on every surface.
public func bloubProfile(fromKey key: String) -> String {
    if let r = key.range(of: "::") { return String(key[r.upperBound...]) }
    return key
}

/// SVG path data (M, L, C, A, Z with absolute coordinates, as the engine prints it) -> a SwiftUI Path.
public enum SVGPath {
    public static func parse(_ d: String) -> Path {
        var path = Path()
        var nums: [Double] = []
        var cmd: Character = " "
        var cur = CGPoint.zero
        var start = CGPoint.zero
        func flush() {
            switch cmd {
            case "M":
                var i = 0
                while i + 1 < nums.count {
                    let p = CGPoint(x: nums[i], y: nums[i + 1])
                    if i == 0 { path.move(to: p); start = p } else { path.addLine(to: p) }
                    cur = p; i += 2
                }
            case "L":
                var i = 0
                while i + 1 < nums.count { cur = CGPoint(x: nums[i], y: nums[i + 1]); path.addLine(to: cur); i += 2 }
            case "C":
                var i = 0
                while i + 5 < nums.count {
                    let c1 = CGPoint(x: nums[i], y: nums[i + 1]), c2 = CGPoint(x: nums[i + 2], y: nums[i + 3])
                    cur = CGPoint(x: nums[i + 4], y: nums[i + 5])
                    path.addCurve(to: cur, control1: c1, control2: c2); i += 6
                }
            case "A":
                var i = 0
                while i + 6 < nums.count {
                    let end = CGPoint(x: nums[i + 5], y: nums[i + 6])
                    addArc(&path, from: cur, to: end, rx: nums[i], ry: nums[i + 1], large: nums[i + 3] != 0, sweep: nums[i + 4] != 0)
                    cur = end; i += 7
                }
            case "Z":
                path.closeSubpath(); cur = start
            default: break
            }
            nums.removeAll(keepingCapacity: true)
        }
        var token = ""
        func pushToken() { if !token.isEmpty, let v = Double(token) { nums.append(v) }; token = "" }
        for ch in d {
            if "MLCAZ".contains(ch) {
                pushToken(); flush(); cmd = ch
                if ch == "Z" { flush(); cmd = " " }
            } else if ch == " " || ch == "," {
                pushToken()
            } else if ch == "-" && !token.isEmpty && !token.hasSuffix("e") {
                pushToken(); token = "-"
            } else {
                token.append(ch)
            }
        }
        pushToken(); flush()
        return path
    }

    /// SVG endpoint arc -> centre form -> addArc (circular arcs only; the engine never prints ellipses).
    static func addArc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx: Double, ry: Double, large: Bool, sweep: Bool) {
        let r = max(rx, ry)
        let dx = (p1.x - p0.x) / 2, dy = (p1.y - p0.y) / 2
        let d2 = dx * dx + dy * dy
        if r <= 0 || d2 == 0 { path.addLine(to: p1); return }
        let rr = max(r, d2.squareRoot())
        var h = max(0, rr * rr - d2).squareRoot() / d2.squareRoot()
        if large == sweep { h = -h }
        let mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2
        // perpendicular to the chord; with y down, `sweep` = clockwise on screen
        let c = CGPoint(x: mx - h * dy, y: my + h * dx)
        let a0 = atan2(p0.y - c.y, p0.x - c.x), a1 = atan2(p1.y - c.y, p1.x - c.x)
        path.addArc(center: c, radius: rr, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: !sweep)
    }
}

extension Color {
    init(bloubHex hex: String) {
        let v = Int(hex.dropFirst(), radix: 16) ?? 0
        self.init(.sRGB, red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255, opacity: 1)
    }
}

/// Draws one engine frame into a Canvas context `side` points wide.
public func drawBloub(_ frame: BotFrame, avatar: Avatar, in ctx: inout GraphicsContext, side: CGFloat, background: Color? = nil) {
    let k = side / CGFloat(HALF_VIEWBOX * 2)
    ctx.translateBy(x: side / 2, y: side / 2)
    ctx.scaleBy(x: k, y: k)
    let body = Color(bloubHex: avatar.palette.body), eye = Color(bloubHex: avatar.palette.eye)
    func stroke(_ d: String, _ a: ArcRender) {
        guard !d.isEmpty else { return }
        ctx.stroke(SVGPath.parse(d), with: .color(Color(bloubHex: a.grad.stops[1]).opacity(a.opacity)),
                   style: StrokeStyle(lineWidth: a.width, lineCap: .round))
    }
    func dots() {
        for d in frame.dots {
            let fill = d.depth.map { Color(bloubHex: mixHex(avatar.palette.shadow, avatar.palette.body, $0)) }
                ?? d.color.map { Color(bloubHex: $0) } ?? body
            if let path = d.d {
                var c = ctx
                c.translateBy(x: d.x, y: d.y)
                c.rotate(by: .degrees(d.rot ?? 0))
                c.scaleBy(x: 100, y: 100)
                c.fill(SVGPath.parse(path), with: .color(fill.opacity(d.opacity)))
            } else {
                ctx.fill(Path(ellipseIn: CGRect(x: d.x - d.r, y: d.y - d.r, width: d.r * 2, height: d.r * 2)), with: .color(fill.opacity(d.opacity)))
            }
        }
    }
    for a in frame.arcs { stroke(a.back, a) }
    if frame.dotsBehind { dots() }
    ctx.fill(SVGPath.parse(frame.bodyPath), with: .color(body.opacity(frame.bodyAlpha)))
    if let n = frame.notch {
        ctx.fill(Path(ellipseIn: CGRect(x: n.x - n.r, y: n.y - n.r, width: n.r * 2, height: n.r * 2)), with: .color(background ?? Color(white: 0.07)))
    }
    if let n = frame.notif {
        ctx.fill(Path(ellipseIn: CGRect(x: n.x - n.r, y: n.y - n.r, width: n.r * 2, height: n.r * 2)), with: .color(Color(bloubHex: NOTIF_BLUE)))
    }
    for e in frame.eyes where e.m.count == 6 {
        let t = CGAffineTransform(a: e.m[0], b: e.m[1], c: e.m[2], d: e.m[3], tx: e.m[4], ty: e.m[5])
        ctx.fill(SVGPath.parse(e.d).applying(t), with: .color(eye.opacity(e.alpha)))
    }
    if !frame.dotsBehind { dots() }
    for a in frame.arcs { stroke(a.front, a) }
}

/// One engine per view identity, so a status change morphs instead of restarting.
@MainActor
final class BloubModel: ObservableObject {
    let avatar: Avatar
    let engine: BotEngine
    let origin = Date()
    var revertTask: Task<Void, Never>?

    init(profile: String) {
        avatar = avatarFor(profile)
        engine = engineForAvatar(profile)
    }

    func t(_ date: Date) -> Double { date.timeIntervalSince(origin) }

    func apply(_ s: BotStatus, at date: Date, still: Bool) {
        revertTask?.cancel()
        let look = STATUS_LOOKS[s]!
        if still { engine.reset(look.state, now: 0); return }
        engine.setState(look.state, now: t(date))
        if let to = look.revertTo, let after = look.revertAfter {
            revertTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(after * 1e9))
                guard let self, !Task.isCancelled else { return }
                self.engine.setState(STATUS_LOOKS[to]!.state, now: self.t(Date()))
            }
        }
    }
}

/// The animated bot avatar. `profile` is the bot's profile id (the identity seed; the desktop uses the same one).
///
/// Battery: the timeline runs at the status's own rate (4 fps idle and sleeping, 30 when working or speaking),
/// pauses while the scene is not active, and with Reduce Motion draws one still pose per status.
public struct BloubView: View {
    let profile: String
    let status: BotStatus
    let size: CGFloat
    let animate: Bool
    @StateObject private var model: BloubModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    public init(profile: String, status: BotStatus = .idle, size: CGFloat = 34, animate: Bool = true) {
        self.profile = profile
        self.status = status
        self.size = size
        self.animate = animate
        _model = StateObject(wrappedValue: BloubModel(profile: profile))
    }

    private var still: Bool { reduceMotion || !animate }

    public var body: some View {
        let fps = STATUS_LOOKS[status]!.fps
        TimelineView(.animation(minimumInterval: 1 / fps, paused: still || scenePhase != .active)) { tl in
            Canvas { ctx, sz in
                let t = still ? (POSES[STATUS_LOOKS[status]!.state] ?? 1) : model.t(tl.date)
                drawBloub(model.engine.sample(t), avatar: model.avatar, in: &ctx, side: min(sz.width, sz.height))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onAppear { model.apply(status, at: Date(), still: still) }
        .onChange(of: status) { _, s in model.apply(s, at: Date(), still: still) }
        .onChange(of: still) { _, s in model.apply(status, at: Date(), still: s) }
    }
}

/// One still frame (Live Activity, widgets, snapshots): no timeline, no state.
public struct BloubStill: View {
    let profile: String
    let status: BotStatus
    let size: CGFloat
    public init(profile: String, status: BotStatus = .idle, size: CGFloat = 34) {
        self.profile = profile; self.status = status; self.size = size
    }
    public var body: some View {
        let state = STATUS_LOOKS[status]!.state
        let avatar = avatarFor(profile)
        let frame = engineForAvatar(profile, status: status.rawValue).sample(POSES[state] ?? 1)
        Canvas { ctx, sz in drawBloub(frame, avatar: avatar, in: &ctx, side: min(sz.width, sz.height)) }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Renders one still frame to PNG data (snapshots, screenshot proof). macOS/iOS 16+.
@MainActor
public func bloubPNG(profile: String, status: BotStatus, side: CGFloat = 160, scale: CGFloat = 2) -> Data? {
    let view = BloubStill(profile: profile, status: status, size: side).background(Color(white: 0.07))
    let r = ImageRenderer(content: view)
    r.scale = scale
    #if canImport(AppKit) && !targetEnvironment(macCatalyst)
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
    return rep.representation(using: .png, properties: [:])
    #else
    return r.uiImage?.pngData()
    #endif
}
