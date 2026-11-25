// swift-tools-version:6.1

import PackageDescription

let package = Package(
    name: "SwiftMaestroMCPServer",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(
            name: "swiftmaestro-mcp-server",
            targets: ["SwiftMaestroMCPServer"]
        ),
    ],
    dependencies: [
        .package(
            url: "https://github.com/modelcontextprotocol/swift-sdk.git",
            from: "0.12.0"
        ),
    ],
    targets: [
        .executableTarget(
            name: "SwiftMaestroMCPServer",
            dependencies: [
                .product(name: "MCP", package: "swift-sdk"),
            ]
        ),
    ]
)
