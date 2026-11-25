#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { SessionManager } from "./session-manager.js";
const server = new Server({
    name: "terminals-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
const sessionManager = new SessionManager();
// Cleanup on exit
process.on("SIGINT", () => {
    sessionManager.cleanup();
    process.exit(0);
});
process.on("SIGTERM", () => {
    sessionManager.cleanup();
    process.exit(0);
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "create_session",
                description: "Create a new persistent terminal session",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Unique identifier for the session",
                        },
                        shell: {
                            type: "string",
                            description: "Shell to use (default: system shell)",
                        },
                        cwd: {
                            type: "string",
                            description: "Working directory (default: current directory)",
                        },
                    },
                    required: ["sessionId"],
                },
            },
            {
                name: "list_sessions",
                description: "List all active terminal sessions",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "execute_in_session",
                description: "Execute a command in a specific session",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID to execute command in",
                        },
                        command: {
                            type: "string",
                            description: "Command to execute",
                        },
                    },
                    required: ["sessionId", "command"],
                },
            },
            {
                name: "get_session_output",
                description: "Get recent output from a session",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID to get output from",
                        },
                        lines: {
                            type: "number",
                            description: "Number of recent lines to retrieve",
                        },
                        stream: {
                            type: "string",
                            enum: ["stdout", "stderr", "all"],
                            description: "Which output stream to retrieve (default: all)",
                        },
                    },
                    required: ["sessionId"],
                },
            },
            {
                name: "destroy_session",
                description: "Destroy a terminal session",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID to destroy",
                        },
                    },
                    required: ["sessionId"],
                },
            },
            {
                name: "set_default_session",
                description: "Set the default session for subsequent operations",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID to set as default",
                        },
                    },
                    required: ["sessionId"],
                },
            },
            {
                name: "get_session_stdout",
                description: "Get recent stdout from a session",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID to get stdout from",
                        },
                        lines: {
                            type: "number",
                            description: "Number of recent lines to retrieve",
                        },
                    },
                    required: ["sessionId"],
                },
            },
            {
                name: "get_session_stderr",
                description: "Get recent stderr from a session",
                inputSchema: {
                    type: "object",
                    properties: {
                        sessionId: {
                            type: "string",
                            description: "Session ID to get stderr from",
                        },
                        lines: {
                            type: "number",
                            description: "Number of recent lines to retrieve",
                        },
                    },
                    required: ["sessionId"],
                },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "create_session": {
                const { sessionId, shell, cwd } = args;
                const sessionInfo = sessionManager.createSession(sessionId, {
                    shell,
                    cwd,
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Created session '${sessionId}'\nShell: ${sessionInfo.shell}\nWorking Directory: ${sessionInfo.cwd}\nStatus: ${sessionInfo.status}`,
                        },
                    ],
                };
            }
            case "list_sessions": {
                const sessions = sessionManager.listSessions();
                const defaultSessionId = sessionManager.getDefaultSession();
                if (sessions.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "No active sessions",
                            },
                        ],
                    };
                }
                const sessionList = sessions
                    .map((session) => `${session.id}${session.id === defaultSessionId ? " (default)" : ""} - ${session.status} - ${session.shell}`)
                    .join("\n");
                return {
                    content: [
                        {
                            type: "text",
                            text: `Active Sessions:\n${sessionList}`,
                        },
                    ],
                };
            }
            case "execute_in_session": {
                const { sessionId, command } = args;
                const result = await sessionManager.executeInSession(sessionId, command);
                return {
                    content: [
                        {
                            type: "text",
                            text: `[${sessionId}] $ ${command}\n${result.combined}`,
                        },
                    ],
                };
            }
            case "get_session_output": {
                const { sessionId, lines, stream } = args;
                const output = sessionManager.getSessionOutput(sessionId, lines, stream);
                const streamLabel = stream ? ` (${stream})` : "";
                return {
                    content: [
                        {
                            type: "text",
                            text: `Recent output from session '${sessionId}'${streamLabel}:\n${output}`,
                        },
                    ],
                };
            }
            case "destroy_session": {
                const { sessionId } = args;
                const destroyed = sessionManager.destroySession(sessionId);
                return {
                    content: [
                        {
                            type: "text",
                            text: destroyed
                                ? `Session '${sessionId}' destroyed`
                                : `Session '${sessionId}' not found`,
                        },
                    ],
                };
            }
            case "set_default_session": {
                const { sessionId } = args;
                sessionManager.setDefaultSession(sessionId);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set '${sessionId}' as default session`,
                        },
                    ],
                };
            }
            case "get_session_stdout": {
                const { sessionId, lines } = args;
                const output = sessionManager.getSessionStdout(sessionId, lines);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Recent stdout from session '${sessionId}':\n${output}`,
                        },
                    ],
                };
            }
            case "get_session_stderr": {
                const { sessionId, lines } = args;
                const output = sessionManager.getSessionStderr(sessionId, lines);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Recent stderr from session '${sessionId}':\n${output}`,
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Terminals MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Server error:", error);
    sessionManager.cleanup();
    process.exit(1);
});
//# sourceMappingURL=index.js.map