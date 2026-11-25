#!/usr/bin/env python3
"""Two-stage local malware scan for downloaded MCP server source.

Stage 1 (quick): suspicious-pattern and symlink scan over text files.
Stage 2 (deep):  full pattern scan, Mach-O code-signature check, optional
                 SHA-256 verification against a pinned digest.

Both stages must pass before setup/build runs. This is a best-effort local
check, not a substitute for reading code you intend to execute.
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys

SKIP_DIRS = {'.git', 'node_modules', '.build', 'dist', 'target', '__pycache__',
             '.venv', 'DerivedData', 'Modules', '.swiftpm'}
TEXT_EXT = {'.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.zsh', '.swift',
            '.json', '.md', '.txt', '.yml', '.yaml', '.rb', '.go'}
# Documentation describes denied commands as text; it is not executable code.
DOC_FILES = {'policy.json', 'README.md', 'rules/AGENTS-safety.md',
             'servers/README.md', 'lib/safety.py', 'lib/installer.py'}

BLOCK = [
    (re.compile(r'curl[^\n|]*\|\s*(ba)?sh'), 'curl-pipe-shell'),
    (re.compile(r'wget[^\n|]*\|\s*(ba)?sh'), 'wget-pipe-shell'),
    (re.compile(r'\beval\s*\(?\s*(req|request|input|buffer|atob)'), 'dynamic-eval'),
    (re.compile(r'base64\s+(-D|--decode)'), 'base64-decode'),
    (re.compile(r'\bnc\s+-[a-z]*e\b'), 'netcat-exec'),
    (re.compile(r'bash\s+-i\s+>&\s*/dev/tcp'), 'reverse-shell'),
    (re.compile(r'rm\s+-rf\s+/(\s|$|\*)'), 'rm-root'),
    (re.compile(r'chmod\s+-R\s+000'), 'chmod-zero'),
    (re.compile(r'>\s*/etc/(passwd|sudoers|hosts)'), 'system-file-write'),
]

WARN = [
    (re.compile(r'child_process\.exec\s*\('), 'shell-exec'),
    (re.compile(r'os\.system\s*\('), 'os-system'),
    (re.compile(r'\bosascript\b'), 'osascript'),
    (re.compile(r'process\.env\.[A-Z_]*(TOKEN|KEY|SECRET)'), 'env-secret-access'),
]


def files(path):
    for dp, dn, fn in os.walk(path):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for name in fn:
            yield os.path.join(dp, name)


def scan_patterns(path, strict):
    findings = []
    for p in files(path):
        if os.path.islink(p):
            target = os.path.realpath(p)
            if not target.startswith(os.path.realpath(path)):
                findings.append(('HIGH', 'symlink-outside', os.path.relpath(p, path)))
            continue
        rel = os.path.relpath(p, path).replace(os.sep, '/')
        if rel in DOC_FILES:
            continue
        ext = os.path.splitext(p)[1].lower()
        if ext not in TEXT_EXT and os.path.basename(p) not in ('Dockerfile', 'Makefile'):
            continue
        try:
            text = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            for pat, label in BLOCK:
                if pat.search(line):
                    findings.append(('HIGH', label, f'{os.path.relpath(p, path)}:{i}'))
            if strict:
                for pat, label in WARN:
                    if pat.search(line):
                        findings.append(('LOW', label, f'{os.path.relpath(p, path)}:{i}'))
    return findings


def check_binaries(path):
    findings = []
    for p in files(path):
        try:
            with open(p, 'rb') as f:
                head = f.read(4)
        except OSError:
            continue
        if head == b'\xcf\xfa\xed\xfe' or head == b'\xca\xfe\xba\xbe':
            try:
                r = subprocess.run(['codesign', '--verify', '--deep', '--strict', p],
                                   capture_output=True, text=True, timeout=30)
                if r.returncode != 0:
                    findings.append(('MEDIUM', 'unsigned-binary', os.path.relpath(p, path)))
            except (OSError, subprocess.TimeoutExpired):
                pass
    return findings


def sha256(path):
    h = hashlib.sha256()
    for p in sorted(files(path)):
        h.update(os.path.relpath(p, path).encode())
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=['quick', 'deep'])
    ap.add_argument('path')
    ap.add_argument('--sha256', help='expected digest for the deep stage')
    ap.add_argument('--clamav', action='store_true', help='require ClamAV in the deep stage')
    args = ap.parse_args()

    if not os.path.isdir(args.path):
        print(f'SCAN FAIL: not a directory: {args.path}')
        return 2

    findings = scan_patterns(args.path, strict=(args.stage == 'deep'))
    if args.stage == 'deep':
        findings += check_binaries(args.path)
        if args.sha256:
            actual = sha256(args.path)
            if actual != args.sha256:
                findings.append(('HIGH', 'sha256-mismatch', f'expected {args.sha256} got {actual}'))
        if shutil.which('clamscan'):
            cmd = ['clamscan', '-r', '--infected', '--no-summary']
            for d in ('.git', 'node_modules', '.build', 'dist', 'target', '__pycache__'):
                cmd.append(f'--exclude-dir={d}')
            cmd.append(args.path)
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
                for line in r.stdout.splitlines():
                    if ': FOUND' in line:
                        findings.append(('HIGH', 'clamav-infection', line.split(': FOUND')[0]))
                if r.returncode == 2:
                    findings.append(('HIGH', 'clamav-error', r.stderr.strip()[:200] or 'unknown error'))
                else:
                    print('DEEP ClamAV scan completed')
            except subprocess.TimeoutExpired:
                findings.append(('HIGH', 'clamav-timeout', args.path))
        elif args.clamav:
            findings.append(('HIGH', 'clamav-missing', 'clamscan not installed'))

    highs = [f for f in findings if f[0] == 'HIGH']
    for sev, label, where in findings:
        print(f'{args.stage.upper()} {sev}: {label} at {where}')
    if highs:
        print(f'{args.stage.upper()} FAILED: {len(highs)} high-severity finding(s)')
        return 1
    print(f'{args.stage.upper()} PASSED: {len(findings)} advisory finding(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
