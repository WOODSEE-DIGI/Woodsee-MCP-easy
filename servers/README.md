# Why only four folders are here

This directory contains only the **four vendored private bridges**:

- `ai-context-bridge`
- `swift-terminals`
- `swiftmaestro-mcp`
- `vision-bridge`

They have no public upstream repo, so their scrubbed source ships with this
kit and is copied into `~/.local/share/woodsee-mcp/servers/` at install time.

**Dependency warning:** `vision-bridge` and `swiftmaestro-mcp` both rely on
SwiftMaestro being installed and configured. Without it their agent tools load
but have no data, and `analyze_image` only returns image data for a
vision-capable calling agent to process. See the main README for details.

The other **seven servers are not stored here** — `manifest.json` defines them
and the installer fetches them when you run it:

### Pulled from public git repos during installation

| Server | Repository | Ref | Built with |
|---|---|---|---|
| `xcodebuildmcp` | https://github.com/getsentry/XcodeBuildMCP.git | `v2.6.2` | `npm install` + `npm run build` |
| `playwright` | https://github.com/microsoft/playwright-mcp.git | `main` | `npm install` + `npm run build` |
| `read-website-fast` | https://github.com/just-every/mcp-read-website-fast.git | `main` | `npm install` + `npm run build` |
| `firecrawl-mcp` | https://github.com/WOODSEE-DIGI/firecrawl-mcp-server.git | `main` | `npm install` + `npm run build` |
| `webclaw` | https://github.com/0xMassi/webclaw.git | `main` | `cargo build -p webclaw-mcp --release` |
| `whatsapp-mcp` | https://github.com/lharries/whatsapp-mcp.git | `main` | Python via `uv` (Go bridge started separately) |

### Not cloned — local CLI

| Server | Source |
|---|---|
| `browse` | Your existing `~/.local/bin/browse` installation. If missing, the installer prints the install instructions (https://anoma.ly) and skips it. |

Every git server is cloned into `~/.local/share/woodsee-mcp/servers/<name>`,
passed through the quick and deep scans, and only then built.

Everything — vendored, cloned or CLI — ends up under
`~/.local/share/woodsee-mcp/servers/` after installation. To see the full list
without installing, run:

```bash
./install.sh --list
```

This keeps the repository small, avoids redistributing upstream forks with
their own licences, and means every public server is downloaded fresh and
scanned on the machine that will actually run it.
