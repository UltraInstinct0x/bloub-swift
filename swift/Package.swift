// swift-tools-version: 5.9
import PackageDescription

// The Swift port of the bloub engine. `Bloub` is the clockless engine and the identity look (Foundation
// only); `BloubUI` draws a frame with SwiftUI. The tests read ../golden, the same files the TypeScript
// engine writes, so both languages are held to one contract.
var targets: [Target] = [
    .target(name: "Bloub"),
    // The engine contract (../golden, identity, eyefit): no SwiftUI, so it runs on Linux too.
    .testTarget(name: "BloubTests", dependencies: ["Bloub"]),
]
var products: [Product] = [.library(name: "Bloub", targets: ["Bloub"])]
#if canImport(SwiftUI)
products.append(.library(name: "BloubUI", targets: ["BloubUI"]))
targets.append(.target(name: "BloubUI", dependencies: ["Bloub"]))
targets.append(.testTarget(name: "BloubUITests", dependencies: ["Bloub", "BloubUI"]))
#endif

let package = Package(
    name: "Bloub",
    // The app repo checks this floor against Config/Base.xcconfig (tests/ios-config.test.mjs).
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: products,
    // The engine is Foundation only, so its tests run anywhere Swift runs, including the Linux box where
    // development and repeated verification happen. The SwiftUI renderer and its slot test are Apple only.
    targets: targets
)
