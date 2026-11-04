// swift-tools-version:5.7
// Open this file in Xcode (File ▸ Open… ▸ Package.swift) and press Run, or use ./build_app.sh
// to produce a double-clickable DesktopBonk.app.
import PackageDescription

let package = Package(
    name: "DesktopBonk",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "DesktopBonk",
            path: "Sources/DesktopBonk",
            resources: [.copy("Web")],
            linkerSettings: [
                .linkedFramework("Cocoa"),
                .linkedFramework("WebKit"),
                .linkedFramework("Carbon"),
            ]
        ),
    ]
)
