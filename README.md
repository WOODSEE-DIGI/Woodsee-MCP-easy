# Woodsee MCP Easy

One installer for the whole Woodsee MCP stack — eleven Model Context Protocol
servers that give an AI agent local memory, terminal sessions, browser control,
web research, Xcode build tooling and cross-agent messaging.

**What problem it solves:** setting those servers up by hand takes a dozen
repos, build commands and six different agent config formats, and doing it on a
second machine usually leaks your home path, machine name, API keys and private
network addresses into the configs you copy. This kit turns that into one
command, works on a fresh Mac, and is safe to hand to a friend.

- **Reproducible** — everything is defined in `manifest.json` with pinned refs
  and build steps; `{{HOME}}` and `{{INSTALL_DIR}}` expand on the target machine.
- **Portable** — no hardcoded home-directory paths, no API keys, no machine-specific IPs.
- **Safe by construction** — downloads are scanned, configs are backed up and
  merged, secrets are blocked at commit/push, and destructive commands are
  denied before anything runs.

By default it installs **everything**. Optional profiles let you narrow that
to public servers (for friends) or the four custom bridges — see below.

## Quick start

```bash
git clone https://github.com/WOODSEE-DIGI/Woodsee-MCP-easy.git
cd Woodsee-MCP-easy
chmod +x install.sh
./install.sh
```

**No flags means install everything** — all eleven servers, configured across
all six clients. That is the default and the intended way to run it.

Only add flags when deliberately narrowing the install:

```bash
# One client only
./install.sh --clients opencode

# A friend who only wants the public, open-source servers
./install.sh --profile public --clients opencode

# Non-interactive / scripting
./install.sh --yes
```

List what the installer knows about:

```bash
./install.sh --list
```

## Built for OpenCode

OpenCode is the primary target of this kit. The installer writes a merged,
backed-up server list to `~/.config/opencode/opencode.jsonc` and leaves any
servers you already had in place.

After running `./install.sh`:

1. Restart OpenCode (config is usually picked up live, but a restart guarantees
   a clean tool list).
2. Ask your agent to **list its MCP tools**, or run `/mcp` in OpenCode.
3. You should see these tool namespaces: `ai-context-bridge`, `firecrawl-mcp`,
   `playwright`, `browse`, `read-website-fast`, `swift-terminals`,
   `swiftmaestro-mcp`, `swiftmaestro-agent-vision-bridge`, `xcodebuildmcp` and
   `touchdesigner` (plus `browser`, `opencode` and `automation`, which are
   built into OpenCode itself).

One OpenCode-specific detail: the `browse` server is stored under OpenCode's
`mcp.servers` container rather than as a top-level key. The config writer
handles that automatically — you do not need to edit it by hand.

If you only want OpenCode configured, use:

```bash
./install.sh --clients opencode
```

## Prerequisites and dependencies

Most servers are self-contained once built. **Two are not — and one of them is
the vision bridge:**

| Server | Requires | Without it |
|---|---|---|
| `swiftmaestro-mcp` | SwiftMaestro installed and configured | Agent lists are empty; `send_to_agent` fails |
| `vision-bridge` | **SwiftMaestro for all agent tools**; a vision-capable calling model for `analyze_image` | Agent tools (`list_agents`, `get_agent_history`, `send_to_agent`, `list_configs`, `get_agent_workspace`, `update_agent_workspace`) return nothing useful; `analyze_image` still loads but only hands image data back to the calling agent |

The vision bridge reads `~/Library/Application Support/SwiftMaestro/agents.json`
and `configs.json`, and API keys from the macOS Keychain service
`com.woodseedigi.SwiftMaestro`. Its MCP path does **not** call an external
vision API on its own — `analyze_image` returns base64 image data plus a model
name, and the calling agent must be able to see the image. A bundled
`vision_analyzer.py` has a standalone API path, but the MCP tool does not use it
by default.

So: **if SwiftMaestro is not installed on the target machine, the vision
bridge's agent features will not work.** The server still starts, so you will
see its tools in OpenCode — they just have no data behind them.

Friends without SwiftMaestro should install with `--profile public`, which
excludes both of these servers. Other optional prerequisites: `browse` needs
the Chrome extension and its CLI; `whatsapp-mcp` needs a Go bridge started
separately; `xcodebuildmcp` needs Xcode; `webclaw` needs Rust/Cargo. The
installer skips servers whose prerequisites are missing and prints what to do.

## Profiles (optional filters — you can ignore these)

Profiles exist only for sharing. **The default is `full`: everything is always
installed unless you explicitly ask for less.**

| Profile | Contains |
|---|---|
| `full` | **Everything — default, no flag needed** |
| `public` | Open-source servers only: XcodeBuildMCP, Playwright, read-website-fast, local-only Firecrawl MCP, browse CLI, webclaw, whatsapp-mcp |
| `private` | The four custom Woodsee bridges only: ai-context-bridge, swift-terminals, swiftmaestro-mcp, vision-bridge |

Publisher notes (PII scrub, push checks, licence) are in `MAINTAINING.md`.
Installers do not need to read it.

## Other clients (optional)

OpenCode is configured by default. The same server definitions can also be
merged into other agents if you want them — `--clients` accepts any
combination of:

| Client | Config written |
|---|---|
| `opencode` | `~/.config/opencode/opencode.jsonc` |
| `warp` | `~/.warp/.mcp.json` |
| `lmstudio` | `~/.lmstudio/mcp.json` |
| `claude` | `~/.claude.json` |
| `qwen` | `~/.qwen/settings.json` |
| `swiftmaestro` | `~/.ai-context/mcp-registry/mcp-servers.json` |

Every config file is backed up as `<filename>.bak-<timestamp>` before it is
changed, and entries are merged rather than overwritten — your own existing
servers survive.

## What it installs

Servers are cloned or copied into `~/.local/share/woodsee-mcp/servers/` and
built there. The default install directory can be changed with
`--install-dir`.

- **ai-context-bridge** — shared context/memory, file operations, indexing
- **swift-terminals** — persistent named shell sessions
- **swiftmaestro-mcp** — inspect and message SwiftMaestro agents (built from source with `swift build -c release`)
- **vision-bridge** — image analysis via a vision model, plus agent bridge
- **xcodebuildmcp** — Xcode builds, simulators, logs, UI automation
- **playwright** — real browser automation with network/PDF/vision caps
- **read-website-fast** — fast URL → clean Markdown
- **firecrawl-mcp** — local-only scrape/search/crawl, no API key or subscription
- **browse** — drive your own Chrome-family browser through its extension
- **webclaw** — local-first Rust scraper
- **whatsapp-mcp** — WhatsApp messaging via the Go bridge

## Firecrawl backend

Selecting `firecrawl-mcp` automatically:

1. installs missing tools with Homebrew (`colima`, `docker`)
2. starts Colima
3. starts the six-container local Firecrawl stack from
   `assets/firecrawl/docker-compose.yaml`
4. waits for `http://127.0.0.1:3002` to answer

The compose file is vendored, scrubbed and used as-is. `whatsapp-mcp` needs
its Go bridge started separately; the installer prints the command.

## How it protects you (the person installing)

The installer assumes the code it downloads is untrusted and the machine it
runs on is yours. These checks happen automatically — you do not have to turn
them on or understand them to install safely.

| Protection | What it does for you |
|---|---|
| **Scans code before running it** | Every downloaded server gets a quick pattern/symlink scan and a deep scan with binary signature checks, optional SHA-256 verification and a real **ClamAV** antivirus scan. If anything fails, that server is not built or run. |
| **Backs up your config first** | Before touching `opencode.jsonc` or any other agent config, it writes a timestamped `.bak` file and verifies it. If you don't like the result, you can roll back. |
| **Merges instead of overwriting** | Your existing MCP servers and settings are left alone. The installer only adds its own entries. |
| **Won't run destructive commands** | Dangerous commands (`rm -rf /`, `mkfs`, `dd`, `kill -9`, `shutdown`, …) are blocked; risky ones require confirmation. Nothing can quietly wipe your machine during an install. |
| **Doesn't ask for your secrets** | No API key or subscription is needed for the local-only Firecrawl setup, and nothing in the repo contains keys. Credentials stay in your Keychain or environment variables. |
| **Skips what your machine can't support** | Missing prerequisites (Swift toolchain, Chrome extension, Rust, Go bridge) cause that server to be skipped with an explanation — not a broken half-install. |
| **No telemetry** | Local-first tools and models. No analytics, tracking or data collection. |
| **Tools for your own files** | The same safety tools are available for anything *you* download or edit — see the commands below. |

You can use them yourself at any time:

```bash
python3 lib/safety.py scrub --fix <path>       # remove secrets/PII from your own files, with backup
python3 lib/safety.py backup <file>            # timestamped, verified backup
python3 lib/scanner.py deep <path> --clamav    # deep scan + antivirus on any folder
python3 lib/safety.py guard "<command>"        # check whether a command is destructive
```

No hooks need enabling to install. Commit/push hooks and publishing checks are
for people *developing* this repo — see `MAINTAINING.md`.

These are best-effort local checks, not a guarantee. A human should still
review code before executing it.

## Customising

Edit `manifest.json` to add a server. Each entry has `kind` (`vendored`, `git`
or `cli`), `profiles`, `command`, optional `setup` commands, `env`, `requires`,
and optional `backend`. `{{INSTALL_DIR}}` and `{{HOME}}` are expanded at install
time. Add a `sha256` to enable digest verification in the deep scan.

## Licence

This repository is licensed under PolyForm Noncommercial 1.0.0 (see `LICENSE`).
Vendored forks keep their own upstream licences; check each server's directory
before redistributing.
