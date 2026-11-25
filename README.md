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

**Sharing note:** the `private` bridges are included in this repository. Before
pushing to a public remote, run your own PII/secret scrub — the installer
already refuses to copy vendored source that still contains home-directory
paths, machine names, key-shaped strings or private IPs.

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

## How it protects you

The kit treats the machine it runs on as untrusted territory. Every protective
default used while building it is encoded in `policy.json` and enforced by
code, so it survives being copied to a new machine or handed to a friend — it
does not depend on an agent remembering to be careful.

| Protection | What it does for you |
|---|---|
| **Two-stage download scan** | `lib/scanner.py` runs a suspicious-pattern/symlink quick scan, then a deep scan with binary signature checks, optional SHA-256 verification and a real **ClamAV** antivirus scan when `clamscan` is installed (`--clamav` makes it mandatory), **before** any downloaded source is built or executed. If any stage fails, the install stops. |
| **Check on the four bundled bridges** | The four private bridges have no public repo, so their source is stored inside this kit. Before copying them onto a new machine, the installer scans that copy for your home path, machine names, API keys, private network addresses and emails. If it finds any, it refuses the copy — so nothing identifying you ends up in a file you share. It checks the copy; it never changes files on your original machine. |
| **Scrub tool with actual redaction** | `lib/safety.py scrub` reports PII/secret hits; `scrub --fix` **rewrites** them to safe placeholders (`~`, `<email>`, `<REDACTED>`, …) after making a verified backup of each file. It is a working tool, not just advice. |
| **Verified backups before writes** | Every config file is copied to `<name>.bak-<timestamp>` and the copy is verified before modification. You can always roll back. |
| **Merge, never clobber** | Managed entries are merged into existing configs. Servers you added yourself are preserved — the installer never replaces a whole config file. |
| **Command guard** | Every shell command the installer runs is classified against a deny-list (`rm -rf /`, `mkfs`, `dd`, `kill -9`, `killall`, `shutdown`, …) and a confirm-list (`rm`, `mv`, `kill`, `rmdir`, …). Dangerous commands cannot run silently. |
| **Commit gate** | A `pre-commit` hook scans staged files for API keys, tokens, passwords, personal paths, machine names, private IPs and emails. The name `woodsee` is allowed; `${VAR:-default}` env defaults are correctly ignored. |
| **Push gate** | A `pre-push` hook runs the full check: secret/PII scan, licence check, both scan stages on every vendored server, and hook status. A bad push is blocked before it leaves the machine. |
| **Portable agent rules** | `rules/AGENTS-safety.md` carries the same behaviour to any AI agent working in a repo on a new machine: scan downloads, back up before destructive work, never inline secrets, never launch the app being developed, commit only when asked. |
| **Secrets stay out of band** | Nothing in the repo contains keys or tokens. Servers read credentials from Keychain or environment variables; Firecrawl needs no API key or subscription. |
| **Local-first by default** | Prefer offline/local tools and local models. No telemetry, analytics or data collection. |

Enable the hooks once per clone, then run the full gate whenever you like:

```bash
python3 lib/safety.py install-hooks        # enable commit/push gates once per clone
python3 lib/safety.py check                # full gate, any time
python3 lib/safety.py scrub                # report PII/secrets in working tree
python3 lib/safety.py scrub --fix          # actually redact them (backs up first)
python3 lib/scanner.py deep . --clamav     # deep scan with mandatory AV
scripts/final-scrub.sh                     # all three in one command, before a push
./install.sh --policy-check                # same gate through the installer
python3 lib/safety.py guard "rm -rf /"     # see the policy classify a command
python3 lib/safety.py backup <file>        # verified timestamped backup
```

Policy rules are declarative: edit `policy.json` to add a pattern, an exempt
path, or a new rule. The installer, hooks and `lib/safety.py` all read that same
file, so one edit updates every gate.

These tools do the work — scan, detect, redact, back up and block — rather than
just telling you to be careful. They are still best-effort local checks: a
human should review code before executing it and eyeball the final diff before
a public push.

## Customising

Edit `manifest.json` to add a server. Each entry has `kind` (`vendored`, `git`
or `cli`), `profiles`, `command`, optional `setup` commands, `env`, `requires`,
and optional `backend`. `{{INSTALL_DIR}}` and `{{HOME}}` are expanded at install
time. Add a `sha256` to enable digest verification in the deep scan.

## Licence

This repository is licensed under PolyForm Noncommercial 1.0.0 (see `LICENSE`).
Vendored forks keep their own upstream licences; check each server's directory
before redistributing.
