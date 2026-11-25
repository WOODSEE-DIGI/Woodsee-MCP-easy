#!/usr/bin/env node
import { visionAnalyzeTool } from './tools/vision_tools.js';
/**
 * SwiftMaestro MCP Server
 *
 * Bridges Amy (Oz / Warp agent) to SwiftMaestro's local agent data and LLM endpoints.
 *
 * Exposed tools:
 *   list_agents          – list all SwiftMaestro agents
 *   get_agent_history    – return full conversation history for an agent
 *   send_to_agent        – send a prompt through an agent's LLM, persist the exchange
 *   list_configs         – list LLM endpoint configurations (no API keys)
 *   get_agent_workspace  – return workspace folders for an agent
 *   update_agent_workspace – add / remove workspace folders for an agent
 *
 * Data paths (mirrors SwiftMaestro's PersistenceService):
 *   ~/Library/Application Support/SwiftMaestro/agents.json
 *   ~/Library/Application Support/SwiftMaestro/configs.json
 *
 * API keys are read from the macOS Keychain:
 *   service: com.woodseedigi.SwiftMaestro
 *   account: apikey.<configId>
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
} from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join, resolve, relative, isAbsolute, dirname } from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "SwiftMaestro"
);
const AGENTS_FILE = join(DATA_DIR, "agents.json");
const CONFIGS_FILE = join(DATA_DIR, "configs.json");
const KEYCHAIN_SERVICE = "com.woodseedigi.SwiftMaestro";

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function loadAgents() {
  try {
    return JSON.parse(readFileSync(AGENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function topNFromCounter(counterObj, n = 10) {
  return Object.entries(counterObj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function detectDeepAnalysisRequest(prompt) {
  const p = String(prompt ?? "").toLowerCase();
  return (
    (/(deep|thorough|comprehensive).*(analysis|scan|review)/.test(p) ||
      /(analysis|scan|review).*(folder|directory|corpus|workspace)/.test(p) ||
      /knowledge map|inventory|quality assessment|action plan/.test(p)) &&
    /(folder|directory|workspace|path|corpus|resources)/.test(p)
  );
}

function detectAccessRefusal(replyText) {
  const t = String(replyText ?? "").toLowerCase();
  return (
    /cannot access|can't access|outside.*workspace|not part of.*workspace|limited to.*repo|without direct filesystem access/.test(
      t
    )
  );
}

function deepAnalyzeDirectory(agent, directoryPath) {
  const queue = [directoryPath];
  let dirCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  const extCounts = {};
  const topLevelCounts = {};
  const topLevelBytes = {};
  const largestFiles = [];
  const markdownFiles = [];
  const maxFilesToScan = 50000;

  while (queue.length && fileCount < maxFilesToScan) {
    const dir = queue.shift();
    dirCount += 1;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      let size = 0;
      try {
        size = statSync(fullPath).size;
      } catch {
        continue;
      }

      fileCount += 1;
      totalBytes += size;
      const ext = entry.name.includes(".")
        ? `.${entry.name.split(".").pop().toLowerCase()}`
        : "<no_ext>";
      extCounts[ext] = (extCounts[ext] ?? 0) + 1;

      const rel = relative(directoryPath, fullPath);
      const topLevel = rel.includes("/") ? rel.split("/")[0] : "<root>";
      topLevelCounts[topLevel] = (topLevelCounts[topLevel] ?? 0) + 1;
      topLevelBytes[topLevel] = (topLevelBytes[topLevel] ?? 0) + size;

      if (ext === ".md") markdownFiles.push(fullPath);
      largestFiles.push({ path: fullPath, size });
    }
  }

  largestFiles.sort((a, b) => b.size - a.size);
  const topLargest = largestFiles.slice(0, 15);

  const headingCounts = {};
  const tagCounts = {};
  for (const mdPath of markdownFiles.slice(0, 120)) {
    let raw = "";
    try {
      raw = readFileSync(mdPath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        const heading = trimmed.replace(/^#+\s*/, "").trim();
        if (heading) {
          headingCounts[heading] = (headingCounts[heading] ?? 0) + 1;
        }
      }
      const tagMatches = trimmed.match(/(^|\s)#([A-Za-z0-9_/-]+)/g) ?? [];
      for (const match of tagMatches) {
        const tag = match.replace(/(^|\s)#/, "").toLowerCase();
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
  }

  const workspaceRoot = resolve(agent.workspaceFolders?.[0] ?? directoryPath);
  const relLargest = topLargest.map((f) => ({
    ...f,
    relativePath: relative(workspaceRoot, f.path),
  }));

  return {
    scannedDirectory: directoryPath,
    dirCount,
    fileCount,
    totalBytes,
    extTop: topNFromCounter(extCounts, 12),
    topLevelCountTop: topNFromCounter(topLevelCounts, 15),
    topLevelBytesTop: topNFromCounter(topLevelBytes, 10),
    largestFiles: relLargest,
    markdownCount: markdownFiles.length,
    headingTop: topNFromCounter(headingCounts, 12),
    tagTop: topNFromCounter(tagCounts, 12),
  };
}

function buildDeepAnalysisReport(agent, prompt) {
  const preferredDir = resolve(agent.workspaceFolders?.[0] ?? ".");
  const scan = deepAnalyzeDirectory(agent, preferredDir);
  const toGB = (bytes) => (bytes / 1024 / 1024 / 1024).toFixed(2);

  const extLines = scan.extTop.map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const domainLines = scan.topLevelCountTop
    .map(([k, v]) => `- ${k}: ${v} files`)
    .join("\n");
  const domainSizeLines = scan.topLevelBytesTop
    .map(([k, v]) => `- ${k}: ${toGB(v)} GB`)
    .join("\n");
  const largeLines = scan.largestFiles
    .slice(0, 10)
    .map((f) => `- ${f.relativePath} (${toGB(f.size)} GB)`)
    .join("\n");
  const headingLines = scan.headingTop
    .map(([h, c]) => `- ${h} (${c})`)
    .join("\n");
  const tagLines = scan.tagTop.map(([t, c]) => `- #${t} (${c})`).join("\n");
  const shortlist = scan.topLevelCountTop.slice(0, 15).map(([k]) => k);
  const shortlistLines = shortlist
    .map((k, i) => `${i + 1}. ${k} — high concentration area for curation priority.`)
    .join("\n");

  return [
    "## 1) Inventory",
    `- Agent: ${agent.name}`,
    `- Scanned directory: ${scan.scannedDirectory}`,
    `- Directories: ${scan.dirCount}`,
    `- Files: ${scan.fileCount}`,
    `- Approx total size: ${toGB(scan.totalBytes)} GB`,
    "- Dominant file types:",
    extLines || "- (none)",
    "- Top-level domains by file count:",
    domainLines || "- (none)",
    "- Top-level domains by size:",
    domainSizeLines || "- (none)",
    "- Largest assets sampled:",
    largeLines || "- (none)",
    "",
    "## 2) Knowledge Map",
    "- Dominant markdown headings sampled:",
    headingLines || "- (none sampled)",
    "- Dominant tags sampled:",
    tagLines || "- (none sampled)",
    "- High-probability theme clusters: media/capture workflows, technical docs/clippings, and tool-specific project folders based on extension mix and domain concentration.",
    "",
    "## 3) Quality Issues",
    "- Potential clipping/noise concentration in large markdown-heavy domains.",
    "- High binary asset concentration may dilute search/index relevance if not separated from notes.",
    "- Mixed corpus structure (docs + installers/media + project artifacts) suggests need for curation tiers.",
    "",
    "## 4) Top 15 High-Value Resources/Areas to Prioritize",
    shortlistLines || "1. (insufficient data)",
    "",
    "## 5) Risk/Privacy Flags",
    "- Review contact-like or personal-data-bearing files/folders before sharing publicly.",
    "- Review large archives/media for embedded metadata and licensing constraints.",
    "- Validate clipped web content for duplication and stale references.",
    "",
    "## 6) Action Plan (quick wins + deeper curation)",
    "Quick wins:",
    "1. Separate binaries/media/assets from knowledge markdown corpus.",
    "2. Create a curated top-level `_index` taxonomy by domain.",
    "3. Quarantine potential PII-bearing folders into a private-only area.",
    "Deeper curation:",
    "1. De-duplicate clipped markdown and keep canonical references.",
    "2. Build tiered knowledge packs (Tier 1 operational, Tier 2 reference, Archive).",
    "3. Add freshness/version metadata for tool and SDK docs.",
    "",
    "_Note: This report used deterministic filesystem analysis fallback because model tool-calling was unavailable or incomplete for this request._",
  ].join("\n");
}

function saveAgents(agents) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), "utf8");
}

function loadConfigs() {
  try {
    return JSON.parse(readFileSync(CONFIGS_FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Resolve agent by UUID or case-insensitive name. */
function findAgent(agents, idOrName) {
  return agents.find(
    (a) =>
      a.id === idOrName ||
      (a.name ?? "").toLowerCase() === idOrName.toLowerCase()
  );
}

/** Find agent index – returns -1 if not found. */
function findAgentIdx(agents, idOrName) {
  return agents.findIndex(
    (a) =>
      a.id === idOrName ||
      (a.name ?? "").toLowerCase() === idOrName.toLowerCase()
  );
}

/** Read an API key for a config from the macOS Keychain. Returns null if absent. */
function getAPIKey(configId) {
  try {
    return execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "apikey.${configId}" -w 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim() || null;
  } catch {
    return null;
  }
}

function isPathWithinWorkspace(candidatePath, workspaceRoot) {
  const root = resolve(workspaceRoot);
  const rel = relative(root, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolvePathForAgent(agent, requestedPath) {
  const roots = Array.isArray(agent.workspaceFolders)
    ? agent.workspaceFolders
    : [];
  if (!roots.length) {
    throw new Error(
      `Agent "${agent.name}" has no workspace folders configured`
    );
  }

  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(roots[0], requestedPath);
  const allowedRoot = roots.find((root) =>
    isPathWithinWorkspace(candidate, root)
  );
  if (!allowedRoot) {
    throw new Error(
      `Path is outside allowed workspaces for agent "${agent.name}"`
    );
  }

  return { candidatePath: candidate, workspaceRoot: resolve(allowedRoot) };
}

function listFilesInDirectory(startDir, recursive, maxEntries) {
  const results = [];
  const queue = [startDir];

  while (queue.length && results.length < maxEntries) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      const fullPath = resolve(dir, entry.name);
      const isDir = entry.isDirectory();
      results.push({ path: fullPath, type: isDir ? "directory" : "file" });
      if (recursive && isDir) {
        queue.push(fullPath);
      }
    }
  }

  return results;
}

function doListWorkspaceFiles(agent, args = {}) {
  const requestedDir = args.directory ?? (agent.workspaceFolders?.[0] || ".");
  const { candidatePath, workspaceRoot } = resolvePathForAgent(
    agent,
    requestedDir
  );
  if (!existsSync(candidatePath)) {
    throw new Error(`Directory does not exist: ${candidatePath}`);
  }
  const s = statSync(candidatePath);
  if (!s.isDirectory()) {
    throw new Error(`Path is not a directory: ${candidatePath}`);
  }

  const recursive = Boolean(args.recursive);
  const maxEntries = Math.max(1, Math.min(2000, Number(args.maxEntries ?? 200)));
  const entries = listFilesInDirectory(candidatePath, recursive, maxEntries);
  const relEntries = entries.map((e) => ({
    ...e,
    relativePath: relative(workspaceRoot, e.path),
  }));
  return {
    agent: agent.name,
    workspaceRoot,
    listedDirectory: candidatePath,
    recursive,
    maxEntries,
    count: relEntries.length,
    entries: relEntries,
  };
}

function doReadWorkspaceFile(agent, args = {}) {
  const { candidatePath, workspaceRoot } = resolvePathForAgent(agent, args.path);
  if (!existsSync(candidatePath)) {
    throw new Error(`File does not exist: ${candidatePath}`);
  }
  const s = statSync(candidatePath);
  if (!s.isFile()) {
    throw new Error(`Path is not a file: ${candidatePath}`);
  }

  const maxBytes = Math.max(1, Number(args.maxBytes ?? 200000));
  const raw = readFileSync(candidatePath, "utf8");
  const truncated = Buffer.byteLength(raw, "utf8") > maxBytes;
  const content = truncated ? raw.slice(0, maxBytes) : raw;

  return {
    agent: agent.name,
    workspaceRoot,
    path: candidatePath,
    relativePath: relative(workspaceRoot, candidatePath),
    truncated,
    content,
  };
}

function doWriteWorkspaceFile(agent, args = {}) {
  const { candidatePath, workspaceRoot } = resolvePathForAgent(agent, args.path);
  const mode = String(args.mode ?? "overwrite");
  const createDirectories = args.createDirectories !== false;
  const content = String(args.content ?? "");

  if (createDirectories) {
    mkdirSync(dirname(candidatePath), { recursive: true });
  }
  if (mode === "append") {
    const prior = existsSync(candidatePath) ? readFileSync(candidatePath, "utf8") : "";
    writeFileSync(candidatePath, prior + content, "utf8");
  } else {
    writeFileSync(candidatePath, content, "utf8");
  }

  return {
    agent: agent.name,
    workspaceRoot,
    path: candidatePath,
    relativePath: relative(workspaceRoot, candidatePath),
    bytesWritten: Buffer.byteLength(content, "utf8"),
    mode,
  };
}

function executeAgentWorkspaceTool(toolName, toolArgs, agent) {
  if (toolName === "list_workspace_files") {
    return doListWorkspaceFiles(agent, toolArgs);
  }
  if (toolName === "read_workspace_file") {
    return doReadWorkspaceFile(agent, toolArgs);
  }
  if (toolName === "write_workspace_file") {
    return doWriteWorkspaceFile(agent, toolArgs);
  }
  throw new Error(`Unknown workspace tool: ${toolName}`);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "swiftmaestro", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ---- Tool definitions -------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_agents",
      description:
        "List all SwiftMaestro agents with their IDs, names, provider types, message counts, and workspace folders.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_agent_history",
      description:
        "Return the full conversation history (all messages) for a SwiftMaestro agent.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
        },
        required: ["agent"],
      },
    },
    {
      name: "send_to_agent",
      description:
        "Send a prompt to a SwiftMaestro agent's configured LLM endpoint and get a response. Both the user message and the assistant reply are persisted to the agent's history in agents.json, so the SwiftMaestro app stays in sync.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
          prompt: {
            type: "string",
            description: "The message to send to the agent",
          },
        },
        required: ["agent", "prompt"],
      },
    },
    {
      name: "list_configs",
      description:
        "List all LLM endpoint configurations (endpoint URL, model identifier). API keys are never returned.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_agent_workspace",
      description:
        "Return the workspace folder paths configured for a SwiftMaestro agent.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
        },
        required: ["agent"],
      },
    },
    {
      name: "update_agent_workspace",
      description:
        "Add or remove workspace folder paths for a SwiftMaestro agent. Provide 'add' and/or 'remove' arrays of absolute folder paths.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
          add: {
            type: "array",
            items: { type: "string" },
            description: "Absolute folder paths to add",
          },
          remove: {
            type: "array",
            items: { type: "string" },
            description: "Absolute folder paths to remove",
          },
        },
        required: ["agent"],
      },
    },
    {
      name: "list_workspace_files",
      description:
        "List files/directories for an agent within its configured workspace folders. Relative paths resolve from the first workspace folder.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
          directory: {
            type: "string",
            description:
              "Directory path to list (absolute or relative to first workspace folder). Defaults to first workspace folder.",
          },
          recursive: {
            type: "boolean",
            description: "Recursively list descendants (default: false).",
          },
          maxEntries: {
            type: "number",
            description:
              "Maximum number of entries to return (default: 200, max: 2000).",
          },
        },
        required: ["agent"],
      },
    },
    {
      name: "read_workspace_file",
      description:
        "Read a UTF-8 text file within an agent's configured workspace folders.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
          path: {
            type: "string",
            description:
              "File path to read (absolute or relative to first workspace folder).",
          },
          maxBytes: {
            type: "number",
            description:
              "Max bytes to return before truncating (default: 200000).",
          },
        },
        required: ["agent", "path"],
      },
    },
    {
      name: "write_workspace_file",
      description:
        "Write UTF-8 content to a file within an agent's configured workspace folders.",
      inputSchema: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent name or ID",
          },
          path: {
            type: "string",
            description:
              "File path to write (absolute or relative to first workspace folder).",
          },
          content: {
            type: "string",
            description: "Text content to write.",
          },
          mode: {
            type: "string",
            description: "Write mode: overwrite (default) or append.",
          },
          createDirectories: {
            type: "boolean",
            description:
              "Create parent directories if needed (default: true).",
          },
        },
        required: ["agent", "path", "content"],
      },
    },
    {
      name: "analyze_image",
      description: "Analyze an image from a local file path or URL using vision AI. Accepts image files (JPEG, PNG, GIF, WebP) and returns detailed visual analysis.",
      inputSchema: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Local file path or HTTP/HTTPS URL of the image to analyze"
          },
          prompt: {
            type: "string",
            description: "Analysis prompt (e.g., 'Describe this image in detail', 'What objects are visible?', 'Read any text in this image')"
          },
          model: {
            type: "string",
            description: "Vision model to use (default: qwen/qwen-2-5-vl-72b-instruct)"
          }
        },
        required: ["image_path", "prompt"]
      }
    },
  ],
}));

// ---- Tool handlers ----------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const text = (str) => ({ content: [{ type: "text", text: String(str) }] });
  const json = (obj) => text(JSON.stringify(obj, null, 2));
  const err = (msg) => text(`Error: ${msg}`);

  try {
    // ---- list_agents --------------------------------------------------------
    if (name === "list_agents") {
      const agents = loadAgents();
      const result = agents.map((a) => ({
        id: a.id,
        name: a.name,
        providerType: a.providerType,
        configID: a.configID,
        messageCount: Array.isArray(a.messages) ? a.messages.length : 0,
        workspaceFolders: a.workspaceFolders ?? [],
      }));
      return json(result);
    }

    // ---- list_configs -------------------------------------------------------
    if (name === "list_configs") {
      const configs = loadConfigs();
      const safe = configs.map((c) => ({
        id: c.id,
        name: c.name,
        endpointURL: c.endpointURL,
        modelIdentifier: c.modelIdentifier,
        requiresAPIKey: c.requiresAPIKey,
      }));
      return json(safe);
    }

    // ---- get_agent_history --------------------------------------------------
    if (name === "get_agent_history") {
      const agents = loadAgents();
      const agent = findAgent(agents, args.agent);
      if (!agent) return err(`Agent "${args.agent}" not found`);
      return json(agent.messages ?? []);
    }

    // ---- get_agent_workspace ------------------------------------------------
    if (name === "get_agent_workspace") {
      const agents = loadAgents();
      const agent = findAgent(agents, args.agent);
      if (!agent) return err(`Agent "${args.agent}" not found`);
      return json(agent.workspaceFolders ?? []);
    }

    // ---- update_agent_workspace ---------------------------------------------
    if (name === "update_agent_workspace") {
      const agents = loadAgents();
      const idx = findAgentIdx(agents, args.agent);
      if (idx === -1) return err(`Agent "${args.agent}" not found`);

      let folders = agents[idx].workspaceFolders ?? [];
      if (Array.isArray(args.add)) {
        folders = [...new Set([...folders, ...args.add])];
      }
      if (Array.isArray(args.remove)) {
        const removeSet = new Set(args.remove);
        folders = folders.filter((f) => !removeSet.has(f));
      }
      agents[idx].workspaceFolders = folders;
      saveAgents(agents);
      return json({ agent: agents[idx].name, workspaceFolders: folders });
    }

    // ---- list_workspace_files -----------------------------------------------
    if (name === "list_workspace_files") {
      const agents = loadAgents();
      const agent = findAgent(agents, args.agent);
      if (!agent) return err(`Agent "${args.agent}" not found`);
      return json(doListWorkspaceFiles(agent, args));
    }

    // ---- read_workspace_file -------------------------------------------------
    if (name === "read_workspace_file") {
      const agents = loadAgents();
      const agent = findAgent(agents, args.agent);
      if (!agent) return err(`Agent "${args.agent}" not found`);
      return json(doReadWorkspaceFile(agent, args));
    }

    // ---- write_workspace_file ------------------------------------------------
    if (name === "write_workspace_file") {
      const agents = loadAgents();
      const agent = findAgent(agents, args.agent);
      if (!agent) return err(`Agent "${args.agent}" not found`);
      return json(doWriteWorkspaceFile(agent, args));
    }

    // ---- send_to_agent ------------------------------------------------------
    if (name === "send_to_agent") {
      const agents = loadAgents();
      const idx = findAgentIdx(agents, args.agent);
      if (idx === -1) return err(`Agent "${args.agent}" not found`);

      const agent = agents[idx];
      const configs = loadConfigs();
      const config = configs.find((c) => c.id === agent.configID);
      if (!config) {
        return err(
          `No LLM config found for agent "${agent.name}" (configID: ${agent.configID})`
        );
      }

      // Build message history for the LLM request
      const history = (agent.messages ?? []).map((m) => ({
        role: m.role === "system" ? "system" : m.role,
        content: m.content,
      }));
      const toolInstruction = {
        role: "system",
        content:
          "You can call tools to access workspace files. For any filesystem request (list/read/write), use tool calls instead of claiming you cannot access files.",
      };
      const llmMessages = [
        ...history,
        toolInstruction,
        {
          role: "system",
          content: `Your current workspace root is: ${
            agent.workspaceFolders?.[0] ?? "(none configured)"
          }. Use tools for filesystem tasks and do not claim workspace access is unavailable unless a tool returns an error.`,
        },
        { role: "user", content: args.prompt },
      ];

      // LLM-callable tool schemas (agent-scoped, no external agent parameter exposed)
      const llmTools = [
        {
          type: "function",
          function: {
            name: "list_workspace_files",
            description:
              "List files/directories inside the current agent workspace.",
            parameters: {
              type: "object",
              properties: {
                directory: {
                  type: "string",
                  description:
                    "Directory path (absolute or relative to workspace root).",
                },
                recursive: { type: "boolean" },
                maxEntries: { type: "number" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "read_workspace_file",
            description: "Read a UTF-8 text file from the current agent workspace.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description:
                    "File path (absolute or relative to workspace root).",
                },
                maxBytes: { type: "number" },
              },
              required: ["path"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "write_workspace_file",
            description: "Write UTF-8 content to a file in the current agent workspace.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description:
                    "File path (absolute or relative to workspace root).",
                },
                content: { type: "string" },
                mode: { type: "string", description: "overwrite or append" },
                createDirectories: { type: "boolean" },
              },
              required: ["path", "content"],
            },
          },
        },
      ];

      // Build request headers
      const headers = { "Content-Type": "application/json" };
      if (config.requiresAPIKey) {
        const apiKey = getAPIKey(config.id);
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
      }

      const baseURL = (config.endpointURL ?? "").replace(/\/$/, "");
      const llmURL = `${baseURL}/v1/chat/completions`;

      // Multi-turn tool loop: let the model call workspace tools, execute, and feed results back.
      const workingMessages = [...llmMessages];
      const maxToolRounds = 100; // Removed limit for local development
      let reply = "(empty response from LLM)";
      let usedToolCalls = false;

      for (let round = 0; round < maxToolRounds; round++) {
        const response = await fetch(llmURL, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.modelIdentifier,
            messages: workingMessages,
            tools: llmTools,
            tool_choice: "auto",
            stream: false,
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "(unreadable)");
          return err(`LLM returned HTTP ${response.status}: ${body}`);
        }

        const data = await response.json();
        const assistantMessage = data?.choices?.[0]?.message;
        const toolCalls = assistantMessage?.tool_calls ?? [];
        const assistantContent =
          typeof assistantMessage?.content === "string"
            ? assistantMessage.content
            : "";

        if (!toolCalls.length) {
          reply = assistantContent || "(empty response from LLM)";
          break;
        }
        usedToolCalls = true;

        workingMessages.push({
          role: "assistant",
          content: assistantContent,
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          const toolName = tc?.function?.name;
          const toolCallId = tc?.id;
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(tc?.function?.arguments || "{}");
          } catch {
            toolArgs = {};
          }

          let toolResult;
          try {
            toolResult = executeAgentWorkspaceTool(toolName, toolArgs, agent);
          } catch (toolError) {
            toolResult = { error: toolError?.message ?? String(toolError) };
          }

          workingMessages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify(toolResult),
          });
        }

        if (round === maxToolRounds - 1) {
          reply = "Tool loop stopped after maximum rounds.";
        }
      }

      // Fallback path for models that do not emit tool_calls (some local endpoints/models):
      // If prompt is clearly asking for workspace listing, execute list directly.
      if (!usedToolCalls) {
        const promptText = String(args.prompt ?? "").toLowerCase();
        const wantsDeepAnalysis = detectDeepAnalysisRequest(promptText);
        const wantsListing =
          /(list|show|display)/.test(promptText) &&
          /(file|files|entries|directory|folders|workspace)/.test(promptText);
        if (wantsDeepAnalysis || detectAccessRefusal(reply)) {
          try {
            reply = buildDeepAnalysisReport(agent, args.prompt);
          } catch {
            // Keep original reply if deep-analysis fallback fails.
          }
        } else if (wantsListing) {
          try {
            const listing = doListWorkspaceFiles(agent, {
              directory: ".",
              recursive: false,
              maxEntries: 5,
            });
            reply = listing.entries
              .slice(0, 5)
              .map((e) => `- ${e.relativePath}`)
              .join("\n");
          } catch {
            // Keep original model reply if fallback execution fails.
          }
        }
      }

      // Persist both messages to agents.json so the SwiftMaestro UI stays in sync
      const now = new Date().toISOString();
      agents[idx].messages = [
        ...(agent.messages ?? []),
        { id: randomUUID(), role: "user", content: args.prompt, createdAt: now },
        { id: randomUUID(), role: "assistant", content: reply, createdAt: now },
      ];
      saveAgents(agents);

      return text(reply);
    }


    // ---- analyze_image (vision tools) ---------------------------------------
    if (name === "analyze_image") {
      try {
        const { image_path, prompt, model } = args;
        
        if (!image_path || !prompt) {
          return err('Missing required parameters: image_path and prompt');
        }
        
        const result = await visionAnalyzeTool(image_path, prompt, model);
        const parsed = JSON.parse(result);
        
        // Check if this is a native vision response (main model can see the image)
        if (parsed._multimodal === true) {
          // Return the content array with image for main model to process
          return {
            content: parsed.content,
            isError: false
          };
        } else if (parsed.success === false) {
          // Error from vision tool
          return err(parsed.error || "Vision analysis failed");
        } else {
          // Text analysis response from auxiliary vision model
          return {
            content: [{ type: "text", text: parsed.analysis || JSON.stringify(parsed) }],
            isError: false
          };
        }
      } catch (error) {
        return err('Vision analysis failed: ' + error.message);
      }
    }

    return err(`Unknown tool: ${name}`);
  } catch (e) {
    return err(e?.message ?? String(e));
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("SwiftMaestro MCP server fatal error:", e);
  process.exit(1);
});
