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

You can install everything, only the public open-source servers (for friends),
or only the four custom Woodsee bridges — see Profiles below.

## Quick start

```bash
git clone <this-repo-url> ~/GitHub/Woodsee-MCP-easy
cd ~/GitHub/Woodsee-MCP-easy
chmod +x install.sh
./install.sh --profile full --clients opencode,warp,lmstudio,claude,qwen,swiftmaestro
```

For a friend who only wants the public, open-source servers:

```bash
./install.sh --profile public --clients opencode
```

Non-interactive / scripting: add `--yes`.

List what the installer knows about:

```bash
./install.sh --list
```

## Profiles

| Profile | Contains |
|---|---|
| `public` | Open-source servers: XcodeBuildMCP, Playwright, read-website-fast, local-only Firecrawl MCP, browse CLI, webclaw, whatsapp-mcp |
| `private` | The four custom Woodsee bridges: ai-context-bridge, swift-terminals, swiftmaestro-mcp, vision-bridge |
| `full` | Everything (default) |

**Sharing note:** the `private` bridges are included in this repository. Before
pushing to a public remote, run your own PII/secret scrub — the installer
already refuses to copy vendored source that still contains home-directory
paths, machine names, key-shaped strings or private IPs.

## Clients

`--clients` accepts any combination of:

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
| **Vendored source scrub** | Before copying the four private bridges, the installer refuses any source containing home-directory paths, machine names, key-shaped strings, private IPs or email addresses. Your identity does not leak into a shared file. |
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
