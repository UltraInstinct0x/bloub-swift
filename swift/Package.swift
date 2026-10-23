// swift-tools-version: 5.9
import PackageDescription

// The Swift port of @hermes/avatar. `HermesAvatar` is the clockless engine and the identity look (Foundation
// only); `HermesAvatarUI` draws a frame with SwiftUI. The tests read ../golden, the same files the TypeScript
// engine writes, so both languages are held to one contract.
var targets: [Target] = [
    .target(name: "HermesAvatar"),
    // The engine contract (../golden, identity, eyefit): no SwiftUI, so it runs on Linux too.
    .testTarget(name: "HermesAvatarTests", dependencies: ["HermesAvatar"]),
]
var products: [Product] = [.library(name: "HermesAvatar", targets: ["HermesAvatar"])]
#if canImport(SwiftUI)
products.append(.library(name: "HermesAvatarUI", targets: ["HermesAvatarUI"]))
targets.append(.target(name: "HermesAvatarUI", dependencies: ["HermesAvatar"]))
targets.append(.testTarget(name: "HermesAvatarUITests", dependencies: ["HermesAvatar", "HermesAvatarUI"]))
#endif

let package = Package(
    name: "HermesAvatar",
    // The app repo checks this floor against Config/Base.xcconfig (tests/ios-config.test.mjs).
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: products,
    // The engine is Foundation only, so its tests run anywhere Swift runs, including the Linux box where
    // development and repeated verification happen. The SwiftUI renderer and its slot test are Apple only.
    targets: targets
)
