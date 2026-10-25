import Foundation
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif
import Testing
@testable import Bloub
@testable import BloubUI
@testable import BloubUI

@Suite struct RenderTests {
    /// The comparison is not vacuous: a frame from another date must fail against the golden one.
    @Test func aWrongFrameIsCaught() throws {
        let file = try Golden.json("frames.json")
        let c = (file["cases"] as! [[String: Any]])[0]
        let s = (c["samples"] as! [[String: Any]])[1]
        let e = buildCase(c)
        #expect(!diffFrame(e.sample(num(s["t"]) + 0.3), s["frame"] as! [String: Any], "shifted").isEmpty)
    }

    @Test func pathsParseIntoClosedShapes() {
        let f = engineForAvatar("appdev").sample(1)
        let body = SVGPath.parse(f.bodyPath).boundingRect
        #expect(body.width > 150 && body.width < 230 && body.height > 150 && body.height < 230)
        let cfg = restExpression("appdev").eyes.0
        let eye = SVGPath.parse(f.eyes[0].d).boundingRect
        #expect(abs(eye.width - cfg.w * 100) < 0.6 && abs(eye.height - cfg.h * 100) < 0.6, "\(eye) vs \(cfg)")
    }

    /// Writes one PNG per bot and status when BLOUB_SNAPSHOT_DIR is set (screenshot proof), and always renders.
    @MainActor @Test func everyBotRendersInEveryStatus() throws {
        let bots = ["hermesbot", "appdev", "health", "hermesvoice", "scout", "hermes"]
        let out = ProcessInfo.processInfo.environment["BLOUB_SNAPSHOT_DIR"].map { URL(fileURLWithPath: $0) }
        if let out { try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true) }
        for b in bots {
            for s in BotStatus.allCases {
                let png = bloubPNG(profile: b, status: s, side: 120)
                #expect((png?.count ?? 0) > 1000, "\(b) \(s)")
                if let out, let png { try png.write(to: out.appendingPathComponent("\(b)-\(s.rawValue).png")) }
            }
        }
    }

    /// Slot proof: each bot at the app's slot sizes (bubble 30, header 34, home 44, call 100) on a grey slot
    /// square, so it shows the body filling the slot instead of sitting small in a circle.
    @MainActor @Test func botsFillTheirSlot() throws {
        let bots = ["hermesbot", "appdev", "health", "hermesvoice", "scout", "hermes"]
        let sizes: [CGFloat] = [30, 34, 44, 100]
        let row = HStack(alignment: .top, spacing: 14) {
            ForEach(bots, id: \.self) { b in
                VStack(spacing: 10) {
                    ForEach(sizes, id: \.self) { s in
                        BloubStill(profile: b, status: .idle, size: s)
                            .background(Rectangle().stroke(Color.gray.opacity(0.5), lineWidth: 0.5))
                    }
                }
            }
        }.padding(20).background(Color(white: 0.07))
        let r = ImageRenderer(content: row); r.scale = 3
        #if canImport(AppKit) && !targetEnvironment(macCatalyst)
        let png = r.nsImage.flatMap { $0.tiffRepresentation }.flatMap { NSBitmapImageRep(data: $0) }?.representation(using: .png, properties: [:])
        #else
        let png = r.uiImage?.pngData()
        #endif
        #expect((png?.count ?? 0) > 1000)
        if let dir = ProcessInfo.processInfo.environment["BLOUB_SNAPSHOT_DIR"], let png {
            try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("slots.png"))
        }
    }
}
