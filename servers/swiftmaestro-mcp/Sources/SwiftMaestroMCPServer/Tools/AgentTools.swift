import Foundation
import MCP

// MARK: - Tool Definitions

enum AgentTools {
    static let listAgents = Tool(
        name: "list_agents",
        description: "List all SwiftMaestro agents with their IDs, names, provider types, message counts, and workspace folders.",
        inputSchema: .object(["type": .string("object")])
    )

    static let getAgentHistory = Tool(
        name: "get_agent_history",
        description: "Return the full conversation history (all messages) for a SwiftMaestro agent.",
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

    static let sendToAgent = Tool(
        name: "send_to_agent",
        description: "Send a prompt to a SwiftMaestro agent's configured LLM endpoint and get a response. Both the user message and the assistant reply are persisted to the agent's history.",
        inputSchema: .object([
            "type": .string("object"),
            "properties": .object([
                "agent": .object([
                    "type": .string("string"),
                    "description": .string("Agent name or ID"),
                ]),
                "prompt": .object([
                    "type": .string("string"),
                    "description": .string("The message to send to the agent"),
                ]),
            ]),
            "required": .array([.string("agent"), .string("prompt")]),
        ])
    )

    static var all: [Tool] { [listAgents, getAgentHistory, sendToAgent] }
}

// MARK: - Handlers

enum AgentToolHandlers {

    static func handleListAgents() -> CallTool.Result {
        let agents = MaestroDataStore.loadAgents()
        let items: [[String: Any]] = agents.map { agent in
            [
                "id": agent.id.uuidString,
                "name": agent.name,
                "providerType": agent.providerType,
                "configID": agent.configID.uuidString,
                "messageCount": agent.messages.count,
                "workspaceFolders": agent.workspaceFolders,
            ] as [String: Any]
        }
        return jsonResult(items)
    }

    static func handleGetAgentHistory(arguments: [String: Value]?) -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }
        let agents = MaestroDataStore.loadAgents()
        guard let agent = MaestroDataStore.findAgent(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }
        return jsonResult(agent.messages.map { msg in
            [
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "createdAt": msg.createdAt ?? "",
            ]
        })
    }

    static func handleSendToAgent(arguments: [String: Value]?) async -> CallTool.Result {
        guard let agentRef = arguments?["agent"]?.stringValue else {
            return errorResult("Missing required parameter: agent")
        }
        guard let prompt = arguments?["prompt"]?.stringValue else {
            return errorResult("Missing required parameter: prompt")
        }

        var agents = MaestroDataStore.loadAgents()
        guard let idx = MaestroDataStore.findAgentIndex(agents, idOrName: agentRef) else {
            return errorResult("Agent \"\(agentRef)\" not found")
        }

        let agent = agents[idx]
        let configs = MaestroDataStore.loadConfigs()
        guard let config = configs.first(where: { $0.id == agent.configID }) else {
            return errorResult(
                "No LLM config found for agent \"\(agent.name)\" (configID: \(agent.configID.uuidString))"
            )
        }

        // Build messages for the LLM
        var llmMessages: [[String: Any]] = agent.messages.map { msg in
            ["role": msg.role == "system" ? "system" : msg.role, "content": msg.content]
        }
        llmMessages.append(["role": "user", "content": prompt])

        // Build request
        let baseURL = config.endpointURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let llmURL = "\(baseURL)/v1/chat/completions"

        guard let url = URL(string: llmURL) else {
            return errorResult("Invalid endpoint URL: \(llmURL)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if config.requiresAPIKey {
            if let apiKey = MaestroDataStore.getAPIKey(configId: config.id.uuidString) {
                request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            }
        }

        let body: [String: Any] = [
            "model": config.modelIdentifier,
            "messages": llmMessages,
            "stream": false,
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            return errorResult("Failed to encode request: \(error.localizedDescription)")
        }

        // Send request
        let reply: String
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
                let body = String(data: data, encoding: .utf8) ?? "(unreadable)"
                return errorResult("LLM returned HTTP \(httpResponse.statusCode): \(body)")
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let firstChoice = choices.first,
                  let message = firstChoice["message"] as? [String: Any],
                  let content = message["content"] as? String
            else {
                reply = "(empty response from LLM)"
                // Still persist
                persistExchange(agents: &agents, idx: idx, prompt: prompt, reply: reply)
                return textResult(reply)
            }
            reply = content.isEmpty ? "(empty response from LLM)" : content
        } catch {
            return errorResult("LLM request failed: \(error.localizedDescription)")
        }

        // Persist both messages to agents.json
        persistExchange(agents: &agents, idx: idx, prompt: prompt, reply: reply)

        return textResult(reply)
    }

    // MARK: - Helpers

    private static func persistExchange(
        agents: inout [MaestroAgent],
        idx: Int,
        prompt: String,
        reply: String
    ) {
        let now = ISO8601DateFormatter().string(from: Date())
        let userMsg = MaestroMessage(id: UUID().uuidString, role: "user", content: prompt, createdAt: now)
        let assistantMsg = MaestroMessage(
            id: UUID().uuidString, role: "assistant", content: reply, createdAt: now
        )
        agents[idx].messages.append(userMsg)
        agents[idx].messages.append(assistantMsg)
        MaestroDataStore.saveAgents(agents)
    }
}
