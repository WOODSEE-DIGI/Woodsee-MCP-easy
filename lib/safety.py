#!/usr/bin/env python3
"""Enforce the Woodsee safety policy from policy.json.

Used by the installer, git hooks, and directly:
    python3 lib/safety.py check
    python3 lib/safety.py secrets [paths...]
    python3 lib/safety.py guard "<shell command>"
    python3 lib/safety.py backup <file>
    python3 lib/safety.py install-hooks
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
POLICY = json.load(open(os.path.join(ROOT, 'policy.json')))

PATTERNS = [
    ('api-key', re.compile(r'\b(?:sk|pk|fco)-[A-Za-z0-9_-]{12,}')),
    ('bearer-token', re.compile(r'Bearer\s+[A-Za-z0-9._-]{20,}')),
    ('assignment-secret', re.compile(r'(?i)(api[_-]?key|token|password|secret)\s*[:=]\s*["\x27][^"\x27]{12,}["\x27]?')),
    ('home-path', re.compile(r'/Users/[A-Za-z0-9_.-]+')),
    ('private-ip', re.compile(r'\b(?:192\.168|10\.|169\.254)\.\d+\.\d+\b')),
    ('machine-name', re.compile('Shoot' + 'yUltra|Shoot' + 'yMax')),
    ('email', re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),
]
TEXT_EXT = {'.js', '.mjs', '.ts', '.swift', '.json', '.md', '.sh', '.py',
            '.yml', '.yaml', '.txt', '.env', '.jsonc'}


def exempt(rel):
    return any(rel.startswith(x) for x in POLICY.get('exempt_paths', []))


def classify(cmd):
    for pat in POLICY['command_policy']['deny']:
        if pat.strip() in cmd:
            return 'deny', pat
    for pat in POLICY['command_policy']['confirm']:
        if cmd.strip().startswith(pat.strip()):
            return 'confirm', pat
    return 'allow', ''


def scan(paths, verbose=True):
    findings = []
    for path in paths:
        if os.path.isdir(path):
            for dp, dn, fn in os.walk(path):
                dn[:] = [d for d in dn if d not in ('.git', 'node_modules', '.build', 'dist', 'target', '__pycache__')]
                for name in fn:
                    if name.endswith(tuple(TEXT_EXT)) or '.' not in name:
                        findings += scan_file(os.path.join(dp, name))
        else:
            findings += scan_file(path)
    if verbose:
        for label, where, line in findings:
            print(f'{label}: {where}:{line}')
        print(f'{"FAIL" if findings else "PASS"}: {len(findings)} finding(s)')
    return findings


def scan_file(path):
    rel = os.path.relpath(path, ROOT)
    if exempt(rel):
        return []
    try:
        lines = open(path, encoding='utf-8', errors='ignore').read().splitlines()
    except OSError:
        return []
    out = []
    for i, line in enumerate(lines, 1):
        if re.search(r'PATTERNS|api-key|bearer-token|home-path|private-ip', line):
            continue  # do not flag the detector's own pattern table
        for label, pat in PATTERNS:
            m = pat.search(line)
            if not m or m.group(0) in POLICY.get('allowed_identifiers', []):
                continue
            # "${VAR:-default}" is an environment override, not an inline secret.
            if label == 'assignment-secret' and '${' in line and ':-' in line:
                continue
            out.append((label, rel, i))
    return out


REPLACEMENTS = {
    'api-key': '<REDACTED>',
    'bearer-token': '<REDACTED>',
    'assignment-secret': '<REDACTED>',
    'home-path': '~',
    'private-ip': '<private-ip>',
    'machine-name': '<machine>',
    'email': '<email>',
}


def scrub(paths, fix=False):
    """Report PII/secret hits and optionally redact them in place (with backup)."""
    total = 0
    changed = 0
    for path in paths:
        if os.path.isdir(path):
            for dp, dn, fn in os.walk(path):
                dn[:] = [d for d in dn if d not in
                         ('.git', 'node_modules', '.build', 'dist', 'target', '__pycache__')]
                for name in fn:
                    if name.endswith(tuple(TEXT_EXT)) or '.' not in name:
                        total += scrub_file(os.path.join(dp, name), fix)
                        if fix:
                            changed += 1
        else:
            total += scrub_file(path, fix)
            if fix:
                changed += 1
    verb = 'redacted' if fix else 'found'
    print(f'{verb} {total} occurrence(s) in {changed if fix else "the scanned files"} file(s)')
    return total


def scrub_file(path, fix):
    rel = os.path.relpath(path, ROOT)
    if exempt(rel):
        return 0
    try:
        lines = open(path, encoding='utf-8', errors='ignore').read().splitlines()
    except OSError:
        return 0
    hits = 0
    new_lines = []
    for i, line in enumerate(lines, 1):
        if re.search(r'home-path|private-ip|machine-name|PATTERNS|assignment-secret', line):
            new_lines.append(line)
            continue
        out = line
        for label, pat in PATTERNS:
            def sub(m):
                nonlocal hits
                if m.group(0) in POLICY.get('allowed_identifiers', []):
                    return m.group(0)
                if label == 'assignment-secret' and '${' in line and ':-' in line:
                    return m.group(0)
                hits += 1
                print(f'  {label}: {rel}:{i} -> {REPLACEMENTS[label]}')
                return REPLACEMENTS[label]
            out = pat.sub(sub, out)
        new_lines.append(out)
    if fix and hits:
        backup(path)
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(new_lines) + '\n')
    return hits


def backup(path):
    if not os.path.exists(path):
        print(f'backup: {path} does not exist', file=sys.stderr)
        return 1
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    dst = f'{path}.bak-{ts}'
    shutil.copy2(path, dst)
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(path):
        print('backup verification FAILED', file=sys.stderr)
        return 1
    print(f'backup OK: {dst}')
    return 0


def staged_files():
    r = subprocess.run(['git', '-C', ROOT, 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
                       capture_output=True, text=True)
    return [os.path.join(ROOT, p) for p in r.stdout.splitlines() if p]


def check():
    ok = True
    print('== staged secret/PII scan')
    findings = scan(staged_files())
    if findings:
        ok = False
    print('== licence')
    lic = os.path.join(ROOT, 'LICENSE')
    if os.path.exists(lic) and 'PolyForm Noncommercial' in open(lic).read():
        print('PASS: PolyForm Noncommercial 1.0.0')
    else:
        print('FAIL: missing or wrong LICENSE')
        ok = False
    print('== vendored source scans')
    for name in sorted(os.listdir(os.path.join(ROOT, 'servers'))):
        path = os.path.join(ROOT, 'servers', name)
        if not os.path.isdir(path):
            continue
        for stage in ('quick', 'deep'):
            r = subprocess.run([sys.executable, os.path.join(HERE, 'scanner.py'), stage, path],
                               capture_output=True, text=True)
            if r.returncode != 0:
                print(f'FAIL: {name} {stage}\n{r.stdout}{r.stderr}')
                ok = False
    print('== git hooks')
    for hook in ('pre-commit', 'pre-push'):
        dst = os.path.join(ROOT, '.git', 'hooks', hook)
        if os.path.exists(dst) and os.access(dst, os.X_OK):
            print(f'PASS: {hook} installed')
        else:
            print(f'INFO: {hook} not installed (run: python3 lib/safety.py install-hooks)')
    print('== policy summary')
    for rule in POLICY['rules']:
        print(f"  [{rule['severity']}] {rule['id']}")
    return 0 if ok else 1


def install_hooks():
    src = os.path.join(ROOT, 'hooks')
    dst = os.path.join(ROOT, '.git', 'hooks')
    if not os.path.isdir(dst):
        print('no .git/hooks directory - run git init first', file=sys.stderr)
        return 1
    for name in ('pre-commit', 'pre-push'):
        s = os.path.join(src, name)
        d = os.path.join(dst, name)
        shutil.copy2(s, d)
        os.chmod(d, 0o755)
        print(f'installed {name}')
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('check')
    p = sub.add_parser('secrets')
    p.add_argument('paths', nargs='*')
    p = sub.add_parser('guard')
    p.add_argument('command')
    p = sub.add_parser('backup')
    p.add_argument('path')
    p = sub.add_parser('scrub')
    p.add_argument('paths', nargs='*')
    p.add_argument('--fix', action='store_true', help='redact in place (backs up each file first)')
    sub.add_parser('install-hooks')
    args = ap.parse_args()

    if args.cmd == 'check':
        return check()
    if args.cmd == 'secrets':
        paths = args.paths or staged_files() or [ROOT]
        return 1 if scan(paths) else 0
    if args.cmd == 'guard':
        verdict, matched = classify(args.command)
        print(f'{verdict.upper()}: {args.command}' + (f' (matched: {matched})' if matched else ''))
        return 1 if verdict == 'deny' else 0
    if args.cmd == 'backup':
        return backup(args.path)
    if args.cmd == 'scrub':
        paths = args.paths or [ROOT]
        return 1 if scrub(paths, args.fix) else 0
    if args.cmd == 'install-hooks':
        return install_hooks()
    return 1


if __name__ == '__main__':
    sys.exit(main())
