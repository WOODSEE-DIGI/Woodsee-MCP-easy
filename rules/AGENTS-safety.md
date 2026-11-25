# Agent Safety Rules — Woodsee MCP Easy

Copy this file into any project's rules folder, or point your agent at it.
These are protective defaults, not suggestions.

## Downloads and code execution

1. **Two-stage malware scan, minimum.** Every downloaded file or repo gets a
   quick scan, then a deep scan, before it is built, installed or run. In this
   kit: `python3 lib/scanner.py quick <path>` then `deep <path>`.
2. **Never run unverified downloaded code.** If either scan fails, stop and
   report. Do not bypass it to save time.
3. **Scrub vendored sources.** Before sharing or copying source between
   machines, check for home paths, machine names, API keys, tokens, private IPs
   and email addresses. The name `woodsee` is explicitly allowed.

## Secrets and privacy

4. **Secrets live in the macOS Keychain** (or environment variables at the
   HTTP boundary), never in source, JSON config, UserDefaults, logs, chat
   history or shared memory.
5. **No telemetry, analytics or data collection.** Prefer local/offline tools
   and local models.
6. **Deep scrub before any public push.** Scan all staged files for secrets and
   personally identifiable information. Remove anything that could be used
   maliciously; `woodsee` may remain.
7. **Reference, never inline.** Use `secret://<name>` style references and
   redact values before anything is written to memory or logs.

## Destructive operations

8. **Backup before destructive work.** Never delete, overwrite or reset user
   data, preferences, keychain items, model files or project configuration
   without first making a recoverable backup and confirming it succeeded.
9. **Deny-list is absolute.** Never run `rm -rf /`, `mkfs`, `newfs`, `dd`,
   `shred`, `srm`, `diskutil erase/partition`, `chmod -R 000`, `chown -R`,
   `kill -9`, `killall`, `pkill -9`, `shutdown`, `reboot` or `halt`.
10. **Confirm other destructive commands.** `rm`, `mv`, `kill`, `pkill`,
    `rmdir`, `unlink`, `trash` require explicit user confirmation.
11. **Merge, never clobber.** When editing config, merge your entries and keep
    everything the user already had. Back up the file first.

## Verification and app handling

12. **Never launch the app.** Do not open, relaunch, kill, screenshot or
    UI-drive the app under development. Verification ends at a successful
    build; the user tests and reports back.
13. **Verify every build** after code changes, using the project's generate +
    build pipeline. Do not claim success without it.

## Repository hygiene

14. **Offline-first repos.** Private/personal repos start local-only with no
    remote. Do not put git repos inside iCloud-synced folders.
15. **Commit only when explicitly asked.** Never push without explicit
    instruction. Tag only after upload succeeds.
16. **Licence.** New original WOODSEE-DIGI repos use PolyForm Noncommercial
    1.0.0. Forks keep their upstream licence.
17. **Read context first, save context last.** Check shared context at session
    start; save decisions, errors and state before ending the session.

## Quick commands

```bash
python3 lib/safety.py check                 # full gate: secrets, licence, scans, hooks
python3 lib/safety.py secrets               # staged files
python3 lib/safety.py guard "rm -rf /"      # policy classification
python3 lib/safety.py backup <file>         # verified timestamped backup
python3 lib/safety.py install-hooks         # enable pre-commit / pre-push gates
./install.sh --policy-check                 # same gate via the installer
```
