import Foundation
import MCP

// ---------------------------------------------------------------------------
// SwiftMaestro MCP Server — native Swift replacement for mcp-server/server.js
//
// Bridges external agents (Warp/Oz, Claude Desktop, etc.) to SwiftMaestro's
// local agent data, LLM endpoints, and workspace file I/O.
//
// Usage:
//   swiftmaestro-mcp-server [--agent-name <name>]
//
// The --agent-name flag is optional and used for display/identification only.
// It is included in the MCP server name so that process monitors (e.g. Apex
// AI Model Monitor) can show which agent each server instance belongs to.
// ---------------------------------------------------------------------------

// MARK: - Parse CLI Arguments

/// Detect agent name from either:
/// 1. `--agent-name <name>` flag (explicit)
/// 2. The executable/symlink name (e.g. `swiftmaestro-mcp-default-assistant`)
func detectAgentName() -> String? {
    let args = CommandLine.arguments

    // 1) Check for --agent-name flag
    for i in 0..<args.count {
        if args[i] == "--agent-name" && i + 1 < args.count {
            return args[i + 1]
        }
    }

    // 2) Extract from executable name (symlink pattern: swiftmaestro-mcp-<agent>)
    let execPath = args.first ?? ""
    let execName = (execPath as NSString).lastPathComponent
    let prefix = "swiftmaestro-mcp-"
    if execName.hasPrefix(prefix) {
        let agent = String(execName.dropFirst(prefix.count))
        if !agent.isEmpty {
            return agent
        }
    }

    return nil
}

let agentName = detectAgentName()
let serverName = agentName.map { "swiftmaestro-mcp/\($0)" } ?? "swiftmaestro"

let server = Server(
    name: serverName,
    version: "2.0.0",
    capabilities: .init(tools: .init(listChanged: false))
)

// MARK: - List Tools

let allTools: [Tool] = AgentTools.all + ConfigTools.all + WorkspaceTools.all

await server.withMethodHandler(ListTools.self) { _ in
    ListTools.Result(tools: allTools)
}

// MARK: - Call Tool

await server.withMethodHandler(CallTool.self) { params in
    let args = params.arguments

    switch params.name {
    // Agent tools
    case "list_agents":
        return AgentToolHandlers.handleListAgents()
    case "get_agent_history":
        return AgentToolHandlers.handleGetAgentHistory(arguments: args)
    case "send_to_agent":
        return await AgentToolHandlers.handleSendToAgent(arguments: args)

    // Config tools
    case "list_configs":
        return ConfigToolHandlers.handleListConfigs()

    // Workspace tools
    case "get_agent_workspace":
        return WorkspaceToolHandlers.handleGetAgentWorkspace(arguments: args)
    case "update_agent_workspace":
        return WorkspaceToolHandlers.handleUpdateAgentWorkspace(arguments: args)
    case "list_workspace_files":
        return WorkspaceToolHandlers.handleListWorkspaceFiles(arguments: args)
    case "read_workspace_file":
        return WorkspaceToolHandlers.handleReadWorkspaceFile(arguments: args)
    case "write_workspace_file":
        return WorkspaceToolHandlers.handleWriteWorkspaceFile(arguments: args)

    default:
        return errorResult("Unknown tool: \(params.name)")
    }
}

// MARK: - Start

let transport = StdioTransport()
try await server.start(transport: transport)
await server.waitUntilCompleted()
