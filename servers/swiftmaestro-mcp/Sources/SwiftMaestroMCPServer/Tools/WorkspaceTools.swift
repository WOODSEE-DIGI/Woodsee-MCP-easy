import Foundation
import MCP

// MARK: - Tool Definitions

enum WorkspaceTools {
    static let getAgentWorkspace = Tool(
        name: "get_agent_workspace",
        description: "Return the workspace folder paths configured for a SwiftMaestro agent.",
        inputSchema: .object([
            "type": .string("object"),
            "properties": .object([
                "agent": .object([
                    "type": .string("string"),
                    "description": .string("Agent name or ID"),
                ]),
            ]),
            "required": .array([.string("agent")]),
        ])
    )

    static let updateAgentWorkspace = Tool(
        name: "update_agent_workspace",
        description:
            "Add or remove workspace folder paths for a SwiftMaestro agent. Provide 'add' and/or 'remove' arrays of absolute folder paths.",
        inputSchema: .object([
            "type": .string("object"),
            "properties": .object([
                "agent": .object([
                    "type": .string("string"),
                    "description": .string("Agent name or ID"),
                ]),
                "add": .object([
                    "type": .string("array"),
                    "items": .object(["type": .string("string")]),
                    "description": .string("Absolute folder paths to add"),
                ]),
                "remove": .object([
                    "type": .string("array"),
                    "items": .object(["type": .string("string")]),
                    "description": .string("Absolute folder paths to remove"),
                ]),
            ]),
            "required": .array([.string("agent")]),
        ])
    )

    static let listWorkspaceFiles = Tool(
        name: "list_workspace_files",
        description:
            "List files/directories for an agent within its configured workspace folders. Relative paths resolve from the first workspace folder.",
        inputSchema: .object([
            "type": .string("object"),
            "properties": .object([
                "agent": .object([
                    "type": .string("string"),
                    "description": .string("Agent name or ID"),
                ]),
                "directory": .object([
                    "type": .string("string"),
                    "description": .string(
                        "Directory path to list (absolute or relative to first workspace folder). Defaults to first workspace folder."
                    ),
                ]),
                "recursive": .object([
                    "type": .string("boolean"),
                    "description": .string("Recursively list descendants (default: false)."),
                ]),
                "maxEntries": .object([
                    "type": .string("number"),
                    "description": .string("Maximum number of entries to return (default: 200, max: 2000)."),
                ]),
            ]),
            "required": .array([.string("agent")]),
        ])
    )

    static let readWorkspaceFile = Tool(
        name: "read_workspace_file",
        description: "Read a UTF-8 text file within an agent's configured workspace folders.",
        inputSchema: .object([
            "type": .string("object"),
            "properties": .object([
                "agent": .object([
                    "type": .string("string"),
                    "description": .string("Agent name or ID"),
                ]),
                "path": .object([
                    "type": .string("string"),
                    "description": .string(
                        "File path to read (absolute or relative to first workspace folder)."
                    ),
                ]),
                "maxBytes": .object([
                    "type": .string("number"),
                    "description": .string("Max bytes to return before truncating (default: 200000)."),
                ]),
            ]),
            "required": .array([.string("agent"), .string("path")]),
        ])
    )

    static let writeWorkspaceFile = Tool(
        name: "write_workspace_file",
        description: "Write UTF-8 content to a file within an agent's configured workspace folders.",
        inputSchema: .object([
            "type": .string("object"),
            "properties": .object([
                "agent": .object([
                    "type": .string("string"),
                    "description": .string("Agent name or ID"),
                ]),
                "path": .object([
                    "type": .string("string"),
                    "description": .string(
                        "File path to write (absolute or relative to first workspace folder)."
                    ),
                ]),
                "content": .object([
                    "type": .string("string"),
                    "description": .string("Text content to write."),
                ]),
                "mode": .object([
                    "type": .string("string"),
                    "description": .string("Write mode: overwrite (default) or append."),
                ]),
                "createDirectories": .object([
                    "type": .string("boolean"),
                    "description": .string("Create parent directories if needed (default: true)."),
                ]),
            ]),
            "required": .array([.string("agent"), .string("path"), .string("content")]),
        ])
    )

    static var all: [Tool] {
        [getAgentWorkspace, updateAgentWorkspace, listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile]
    }
}

// MARK: - Workspace Path Resolution

private enum WorkspaceResolver {
    struct ResolvedPath {
        let candidatePath: String
        let workspaceRoot: String
    }

    static func resolve(agent: MaestroAgent, requestedPath: String) throws -> ResolvedPath {
        let roots = agent.workspaceFolders
        guard !roots.isEmpty else {
            throw WorkspaceError.noWorkspace(agent.name)
        }

        let candidate: String
        if requestedPath.hasPrefix("/") {
            candidate = (requestedPath as NSString).standardizingPath
        } else {
            candidate = ((roots[0] as NSString).appendingPathComponent(requestedPath) as NSString)
                .standardizingPath
        }

        guard
            let allowedRoot = roots.first(where: { root in
                let normalizedRoot = (root as NSString).standardizingPath
                return candidate == normalizedRoot || candidate.hasPrefix(normalizedRoot + "/")
            })
        else {
            throw WorkspaceError.outsideWorkspace(agent.name)
        }

        return ResolvedPath(
            candidatePath: candidate,
            workspaceRoot: (allowedRoot as NSString).standardizingPath
        )
    }
}

private enum WorkspaceError: LocalizedError {
    case noWorkspace(String)
    case outsideWorkspace(String)
    case notFound(String)
    case notAFile(String)
    case notADirectory(String)

    var errorDescription: String? {
        switch self {
        case .noWorkspace(let name): return "Agent \"\(name)\" has no workspace folders configured"
        case .outsideWorkspace(let name): return "Path is outside allowed workspaces for agent \"\(name)\""
        case .notFound(let path): return "Path does not exist: \(path)"
        case .notAFile(let path): return "Path is not a file: \(path)"
        case .notADirectory(let path): return "Path is not a directory: \(path)"
        }
    }
}

// MARK: - Handlers

enum WorkspaceToolHandlers {

    // MARK: get_agent_workspace

    static func handleGetAgentWorkspace(arguments: [String: Value]?) -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }
        let agents = MaestroDataStore.loadAgents()
        guard let agent = MaestroDataStore.findAgent(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }
        return jsonResult(agent.workspaceFolders)
    }

    // MARK: update_agent_workspace

    static func handleUpdateAgentWorkspace(arguments: [String: Value]?) -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }

        var agents = MaestroDataStore.loadAgents()
        guard let idx = MaestroDataStore.findAgentIndex(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }

        var folders = agents[idx].workspaceFolders

        // Add
        if let addValues = arguments?["add"]?.arrayValue {
            let addPaths = addValues.compactMap(\.stringValue)
            for path in addPaths where !folders.contains(path) {
                folders.append(path)
            }
        }

        // Remove
        if let removeValues = arguments?["remove"]?.arrayValue {
            let removePaths = Set(removeValues.compactMap(\.stringValue))
            folders.removeAll { removePaths.contains($0) }
        }

        agents[idx].workspaceFolders = folders
        MaestroDataStore.saveAgents(agents)

        return jsonResult([
            "agent": agents[idx].name,
            "workspaceFolders": folders,
        ] as [String: Any])
    }

    // MARK: list_workspace_files

    static func handleListWorkspaceFiles(arguments: [String: Value]?) -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }

        let agents = MaestroDataStore.loadAgents()
        guard let agent = MaestroDataStore.findAgent(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }

        let requestedDir = arguments?["directory"]?.stringValue ?? agent.workspaceFolders.first ?? "."
        let recursive = arguments?["recursive"]?.boolValue ?? false
        let maxEntries = min(2000, max(1, arguments?["maxEntries"]?.intValue ?? 200))

        let resolved: WorkspaceResolver.ResolvedPath
        do {
            resolved = try WorkspaceResolver.resolve(agent: agent, requestedPath: requestedDir)
        } catch {
            return errorResult(error.localizedDescription)
        }

        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: resolved.candidatePath, isDirectory: &isDir) else {
            return errorResult("Directory does not exist: \(resolved.candidatePath)")
        }
        guard isDir.boolValue else {
            return errorResult("Path is not a directory: \(resolved.candidatePath)")
        }

        var entries: [[String: Any]] = []
        var queue = [resolved.candidatePath]

        while !queue.isEmpty && entries.count < maxEntries {
            let dir = queue.removeFirst()
            guard let contents = try? fm.contentsOfDirectory(atPath: dir) else { continue }

            for name in contents {
                if entries.count >= maxEntries { break }
                let fullPath = (dir as NSString).appendingPathComponent(name)
                var childIsDir: ObjCBool = false
                fm.fileExists(atPath: fullPath, isDirectory: &childIsDir)
                let entryType = childIsDir.boolValue ? "directory" : "file"

                let relativePath: String
                if fullPath.hasPrefix(resolved.workspaceRoot + "/") {
                    relativePath = String(fullPath.dropFirst(resolved.workspaceRoot.count + 1))
                } else {
                    relativePath = fullPath
                }

                entries.append([
                    "path": fullPath,
                    "relativePath": relativePath,
                    "type": entryType,
                ])

                if recursive && childIsDir.boolValue {
                    queue.append(fullPath)
                }
            }
        }

        return jsonResult([
            "agent": agent.name,
            "workspaceRoot": resolved.workspaceRoot,
            "listedDirectory": resolved.candidatePath,
            "recursive": recursive,
            "maxEntries": maxEntries,
            "count": entries.count,
            "entries": entries,
        ] as [String: Any])
    }

    // MARK: read_workspace_file

    static func handleReadWorkspaceFile(arguments: [String: Value]?) -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }
        guard let filePath = arguments?["path"]?.stringValue else {
            return errorResult("Missing required parameter: path")
        }

        let agents = MaestroDataStore.loadAgents()
        guard let agent = MaestroDataStore.findAgent(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }

        let resolved: WorkspaceResolver.ResolvedPath
        do {
            resolved = try WorkspaceResolver.resolve(agent: agent, requestedPath: filePath)
        } catch {
            return errorResult(error.localizedDescription)
        }

        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: resolved.candidatePath, isDirectory: &isDir) else {
            return errorResult("File does not exist: \(resolved.candidatePath)")
        }
        guard !isDir.boolValue else {
            return errorResult("Path is not a file: \(resolved.candidatePath)")
        }

        let maxBytes = max(1, arguments?["maxBytes"]?.intValue ?? 200_000)

        guard let raw = try? String(contentsOfFile: resolved.candidatePath, encoding: .utf8) else {
            return errorResult("Could not read file as UTF-8: \(resolved.candidatePath)")
        }

        let byteCount = raw.utf8.count
        let truncated = byteCount > maxBytes
        let content = truncated ? String(raw.prefix(maxBytes)) : raw

        let relativePath: String
        if resolved.candidatePath.hasPrefix(resolved.workspaceRoot + "/") {
            relativePath = String(resolved.candidatePath.dropFirst(resolved.workspaceRoot.count + 1))
        } else {
            relativePath = resolved.candidatePath
        }

        return jsonResult([
            "agent": agent.name,
            "workspaceRoot": resolved.workspaceRoot,
            "path": resolved.candidatePath,
            "relativePath": relativePath,
            "truncated": truncated,
            "content": content,
        ] as [String: Any])
    }

    // MARK: write_workspace_file

    static func handleWriteWorkspaceFile(arguments: [String: Value]?) -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }
        guard let filePath = arguments?["path"]?.stringValue else {
            return errorResult("Missing required parameter: path")
        }
        guard let content = arguments?["content"]?.stringValue else {
            return errorResult("Missing required parameter: content")
        }

        let agents = MaestroDataStore.loadAgents()
        guard let agent = MaestroDataStore.findAgent(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }

        let resolved: WorkspaceResolver.ResolvedPath
        do {
            resolved = try WorkspaceResolver.resolve(agent: agent, requestedPath: filePath)
        } catch {
            return errorResult(error.localizedDescription)
        }

        let mode = arguments?["mode"]?.stringValue ?? "overwrite"
        let createDirectories = arguments?["createDirectories"]?.boolValue ?? true
        let fm = FileManager.default

        if createDirectories {
            let parent = (resolved.candidatePath as NSString).deletingLastPathComponent
            try? fm.createDirectory(atPath: parent, withIntermediateDirectories: true, attributes: nil)
        }

        do {
            if mode == "append" {
                let prior = (try? String(contentsOfFile: resolved.candidatePath, encoding: .utf8)) ?? ""
                try (prior + content).write(toFile: resolved.candidatePath, atomically: true, encoding: .utf8)
            } else {
                try content.write(toFile: resolved.candidatePath, atomically: true, encoding: .utf8)
            }
        } catch {
            return errorResult("Write failed: \(error.localizedDescription)")
        }

        let relativePath: String
        if resolved.candidatePath.hasPrefix(resolved.workspaceRoot + "/") {
            relativePath = String(resolved.candidatePath.dropFirst(resolved.workspaceRoot.count + 1))
        } else {
            relativePath = resolved.candidatePath
        }

        return jsonResult([
            "agent": agent.name,
            "workspaceRoot": resolved.workspaceRoot,
            "path": resolved.candidatePath,
            "relativePath": relativePath,
            "bytesWritten": content.utf8.count,
            "mode": mode,
        ] as [String: Any])
    }
}
