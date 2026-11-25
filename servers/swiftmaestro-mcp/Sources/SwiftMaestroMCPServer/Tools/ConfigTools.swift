import Foundation
import MCP

// MARK: - Tool Definitions

enum ConfigTools {
    static let listConfigs = Tool(
        name: "list_configs",
        description: "List all LLM endpoint configurations (endpoint URL, model identifier). API keys are never returned.",
        inputSchema: .object(["type": .string("object")])
    )

    static var all: [Tool] { [listConfigs] }
}

// MARK: - Handlers

enum ConfigToolHandlers {

    static func handleListConfigs() -> CallTool.Result {
        let configs = MaestroDataStore.loadConfigs()
        let safe: [[String: Any]] = configs.map { config in
            [
                "id": config.id.uuidString,
                "name": config.name,
                "endpointURL": config.endpointURL,
                "modelIdentifier": config.modelIdentifier,
                "requiresAPIKey": config.requiresAPIKey,
            ] as [String: Any]
        }
        return jsonResult(safe)
    }
}
