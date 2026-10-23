import Foundation
import SwiftUI
import Testing
@testable import HermesAvatar
@testable import HermesAvatarUI

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
}
