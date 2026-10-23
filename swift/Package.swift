// swift-tools-version: 5.9
import PackageDescription

// The Swift port of @hermes/avatar. `HermesAvatar` is the clockless engine and the identity look (Foundation
// only); `HermesAvatarUI` draws a frame with SwiftUI. The tests read ../golden, the same files the TypeScript
// engine writes, so both languages are held to one contract.
let package = Package(
    name: "HermesAvatar",
    platforms: [.iOS(.v17), .macOS(.v14), .watchOS(.v10)],
    products: [
        .library(name: "HermesAvatar", targets: ["HermesAvatar"]),
        .library(name: "HermesAvatarUI", targets: ["HermesAvatarUI"]),
    ],
    targets: [
        .target(name: "HermesAvatar"),
        .target(name: "HermesAvatarUI", dependencies: ["HermesAvatar"]),
        .testTarget(name: "HermesAvatarTests", dependencies: ["HermesAvatar", "HermesAvatarUI"]),
    ]
)
