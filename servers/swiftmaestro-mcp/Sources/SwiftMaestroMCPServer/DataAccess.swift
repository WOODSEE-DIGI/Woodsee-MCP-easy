import Foundation
import Security

// MARK: - Paths

enum MaestroDataPaths {
    static let dataDir: URL = {
        FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SwiftMaestro", isDirectory: true)
    }()

    static let agentsFile = dataDir.appendingPathComponent("agents.json")
    static let configsFile = dataDir.appendingPathComponent("configs.json")
    static let mcpServersFile = dataDir.appendingPathComponent("mcp_servers.json")

    static let keychainService = "com.woodseedigi.SwiftMaestro"
}

// MARK: - Message

struct MaestroMessage: Codable, Sendable {
    let id: String
    let role: String
    let content: String
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, role, content, createdAt
    }

    init(id: String = UUID().uuidString, role: String, content: String, createdAt: String? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt ?? ISO8601DateFormatter().string(from: Date())
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // id can be UUID or String in the JSON
        if let uuid = try? c.decode(UUID.self, forKey: .id) {
            id = uuid.uuidString
        } else {
            id = try c.decode(String.self, forKey: .id)
        }
        role = try c.decode(String.self, forKey: .role)
        content = try c.decode(String.self, forKey: .content)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

// MARK: - Agent

struct MaestroAgent: Codable, Sendable {
    let id: UUID
    var name: String
    let providerType: String
    let configID: UUID
    var messages: [MaestroMessage]
    let createdAt: String?
    var workspaceFolders: [String]
    var enabledMCPServerIDs: [String]
    var rules: [String]
    var overrideModelIdentifier: String?
    var parentAgentID: UUID?
    var childAgentIDs: [String]

    enum CodingKeys: String, CodingKey {
        case id, name, providerType, configID, messages, createdAt
        case workspaceFolders, enabledMCPServerIDs, rules
        case overrideModelIdentifier, parentAgentID, childAgentIDs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        providerType = try c.decode(String.self, forKey: .providerType)
        configID = try c.decode(UUID.self, forKey: .configID)
        messages = try c.decode([MaestroMessage].self, forKey: .messages)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        workspaceFolders = try c.decodeIfPresent([String].self, forKey: .workspaceFolders) ?? []
        enabledMCPServerIDs = try c.decodeIfPresent([String].self, forKey: .enabledMCPServerIDs) ?? []
        rules = try c.decodeIfPresent([String].self, forKey: .rules) ?? []
        overrideModelIdentifier = try c.decodeIfPresent(String.self, forKey: .overrideModelIdentifier)
        parentAgentID = try c.decodeIfPresent(UUID.self, forKey: .parentAgentID)
        childAgentIDs = try c.decodeIfPresent([String].self, forKey: .childAgentIDs) ?? []
    }
}

// MARK: - LLM Config

struct MaestroLLMConfig: Codable, Sendable {
    let id: UUID
    let name: String
    let endpointURL: String
    let modelIdentifier: String
    let requiresAPIKey: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, endpointURL, modelIdentifier, requiresAPIKey
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        endpointURL = try c.decodeIfPresent(String.self, forKey: .endpointURL) ?? ""
        modelIdentifier = try c.decodeIfPresent(String.self, forKey: .modelIdentifier) ?? ""
        requiresAPIKey = try c.decodeIfPresent(Bool.self, forKey: .requiresAPIKey) ?? false
    }
}

// MARK: - Data Store

enum MaestroDataStore {
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    // MARK: Agents

    static func loadAgents() -> [MaestroAgent] {
        guard let data = try? Data(contentsOf: MaestroDataPaths.agentsFile),
              let agents = try? decoder.decode([MaestroAgent].self, from: data)
        else { return [] }
        return agents
    }

    static func saveAgents(_ agents: [MaestroAgent]) {
        try? FileManager.default.createDirectory(
            at: MaestroDataPaths.dataDir,
            withIntermediateDirectories: true
        )
        try? encoder.encode(agents).write(to: MaestroDataPaths.agentsFile, options: .atomic)
    }

    static func findAgent(_ agents: [MaestroAgent], idOrName: String) -> MaestroAgent? {
        agents.first { agent in
            agent.id.uuidString == idOrName
                || agent.id.uuidString.lowercased() == idOrName.lowercased()
                || agent.name.lowercased() == idOrName.lowercased()
        }
    }

    static func findAgentIndex(_ agents: [MaestroAgent], idOrName: String) -> Int? {
        agents.firstIndex { agent in
            agent.id.uuidString == idOrName
                || agent.id.uuidString.lowercased() == idOrName.lowercased()
                || agent.name.lowercased() == idOrName.lowercased()
        }
    }

    // MARK: Configs

    static func loadConfigs() -> [MaestroLLMConfig] {
        guard let data = try? Data(contentsOf: MaestroDataPaths.configsFile),
              let configs = try? decoder.decode([MaestroLLMConfig].self, from: data)
        else { return [] }
        return configs
    }

    // MARK: Keychain

    static func getAPIKey(configId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: MaestroDataPaths.keychainService,
            kSecAttrAccount as String: "apikey.\(configId)",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
