# Maintaining this repo

Only relevant if you publish changes to this repository. Installing the kit
does not involve any of this.

## PII / secret scrub before a public push

The four private bridges have no public upstream, so their source is stored in
`servers/`. Before publishing, check that no home paths, machine names, API
keys, private IPs or emails remain in any file. The name `woodsee` is allowed.

One command does it all — PII scrub, full safety gate, and a mandatory ClamAV
deep scan:

```bash
scripts/final-scrub.sh
```

If it reports something, redact it for real (backs up each file first):

```bash
python3 lib/safety.py scrub --fix <path>
python3 lib/safety.py secrets <path>       # confirm clean afterwards
```

The pre-push hook runs the full check automatically. A separate global
deep-scrub hook also runs on push.

## Hooks (once per clone)

```bash
python3 lib/safety.py install-hooks
```

- `pre-commit` — blocks staged secrets and personal identifiers
- `pre-push` — full gate: PII/secret scan, licence, both scan stages on every
  vendored server, hook status

## Repo rules

- New original repos use PolyForm Noncommercial 1.0.0 (`LICENSE`); forks keep
  their upstream licence.
- Private/personal repos start local-only with no remote. Do not put git repos
  inside iCloud-synced folders.
- Commit and push only when explicitly asked. Tag only after upload succeeds.
- `policy.json` is the single source of truth for the safety rules. The
  installer, hooks and `lib/safety.py` all read it.
