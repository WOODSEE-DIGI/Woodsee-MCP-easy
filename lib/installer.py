#!/usr/bin/env python3
"""Woodsee MCP Easy - install the Woodsee MCP server stack on a new Mac."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(HERE, 'manifest.json')
sys.path.insert(0, os.path.join(HERE, 'lib'))
import safety  # noqa: E402

NON_INTERACTIVE = False


def run(cmd, cwd=None, check=True, capture=False):
    verdict, matched = safety.classify(cmd)
    if verdict == 'deny':
        raise RuntimeError(f'policy denied command ({matched}): {cmd}')
    if verdict == 'confirm' and not NON_INTERACTIVE:
        answer = input(f'  policy confirmation needed for "{cmd}" [y/N] ')
        if answer.lower() != 'y':
            raise RuntimeError(f'user declined command: {cmd}')
    print(f'  $ {cmd}')
    r = subprocess.run(cmd, shell=True, cwd=cwd, text=True,
                       capture_output=capture)
    if check and r.returncode != 0:
        raise RuntimeError(f'command failed ({r.returncode}): {cmd}')
    return r


def have(binary):
    return shutil.which(binary) is not None


def expand(value, install_dir, home):
    if isinstance(value, str):
        return (value.replace('{{INSTALL_DIR}}', install_dir)
                     .replace('{{HOME}}', home))
    if isinstance(value, list):
        return [expand(x, install_dir, home) for x in value]
    if isinstance(value, dict):
        return {k: expand(v, install_dir, home) for k, v in value.items()}
    return value


def scrub_vendored(path):
    """Fail if vendored private source still contains personal identifiers."""
    names = 'Shoot' + 'yUltra|Shoot' + 'yMax'
    bad = re.compile(r'/Users/[A-Za-z0-9_.-]+|' + names +
                     r'|sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
                     r'|\b(?:192\.168|10\.|169\.254)\.\d+\.\d+\b')
    hits = []
    for dp, dn, fn in os.walk(path):
        dn[:] = [d for d in dn if d not in ('.git', 'node_modules', '.build', 'dist')]
        for name in fn:
            if not name.endswith(('.js', '.mjs', '.ts', '.swift', '.json', '.md', '.sh', '.py')):
                continue
            p = os.path.join(dp, name)
            for i, line in enumerate(open(p, encoding='utf-8', errors='ignore'), 1):
                if bad.search(line):
                    hits.append(f'{os.path.relpath(p, path)}:{i}')
    if hits:
        print('  SCRUB FAILED - personal identifiers found:')
        for h in hits[:15]:
            print(f'    {h}')
        raise RuntimeError('vendored source is not safe to share')
    print('  scrub check passed')


def scan(path, stage, sha=None):
    r = run(f'python3 "{HERE}/lib/scanner.py" {stage} "{path}"' +
            (f' --sha256 "{sha}"' if sha else ''), check=False)
    if r.returncode != 0:
        raise RuntimeError(f'{stage} scan failed for {path}')


def fetch_server(name, server, install_dir, home, yes):
    dest = os.path.join(install_dir, 'servers', name)
    kind = server['kind']
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    if kind == 'vendored':
        src = os.path.join(HERE, expand(server['path'], install_dir, home))
        print(f'[{name}] vendored source -> {dest}')
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns('.git', 'node_modules', '.build'))
        scrub_vendored(dest)
        return dest

    if kind == 'git':
        repo = server['repo']
        ref = server.get('ref', 'main')
        if os.path.isdir(os.path.join(dest, '.git')):
            print(f'[{name}] already cloned, pulling')
            run(f'git -C "{dest}" fetch --all --tags', check=False)
            run(f'git -C "{dest}" checkout "{ref}"', check=False)
        else:
            print(f'[{name}] cloning {repo} ({ref})')
            run(f'git clone --branch "{ref}" --depth 1 "{repo}" "{dest}"', check=False)
            if not os.path.isdir(os.path.join(dest, '.git')):
                run(f'git clone "{repo}" "{dest}"')
                run(f'git -C "{dest}" checkout "{ref}"')
        scan(dest, 'quick')
        scan(dest, 'deep', server.get('sha256'))
        return dest

    if kind == 'cli':
        binary = os.path.expanduser(server['binary'])
        if not os.path.exists(binary):
            print(f'[{name}] NOT INSTALLED. {server.get("install_hint", "")}')
            return None
        print(f'[{name}] CLI found at {binary}')
        return dest

    print(f'[{name}] unknown kind {kind}')
    return None


def setup_server(name, server, dest, install_dir, home):
    if not dest or not server.get('setup'):
        return
    print(f'[{name}] building')
    for cmd in server['setup']:
        run(expand(cmd, install_dir, home), cwd=dest)


def ensure_backend(name, server, install_dir, home, yes):
    backend = server.get('backend')
    if not backend:
        return
    if 'requires' in backend:
        missing = [b for b in backend['requires'] if not have(b)]
        if missing:
            if not have('brew'):
                raise RuntimeError(f'missing prerequisites for {name}: {missing} '
                                   '(Homebrew is required to install them)')
            if not yes:
                answer = input(f'  install missing backend tools {missing} with Homebrew? [y/N] ')
                if answer.lower() != 'y':
                    raise RuntimeError(f'missing prerequisites for {name}: {missing}')
            run(f'brew install {" ".join(missing)}')
    compose = backend.get('compose')
    if compose:
        src = os.path.join(HERE, compose)
        dst = os.path.join(install_dir, 'assets/firecrawl/docker-compose.yaml')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    health = backend.get('health_url')
    if health:
        print(f'[{name}] starting backend')
        for cmd in backend.get('start', []):
            run(expand(cmd, install_dir, home), check=False)
        deadline = time.time() + backend.get('timeout', 180)
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(health, timeout=3) as r:
                    if r.status == 200:
                        print(f'[{name}] backend healthy ({health})')
                        return
            except Exception:
                time.sleep(3)
        raise RuntimeError(f'{name} backend did not become healthy at {health}')
    if backend.get('note'):
        print(f'[{name}] NOTE: {expand(backend["note"], install_dir, home)}')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--profile', default=None, help='public, private or full')
    ap.add_argument('--clients', default=None, help='comma-separated: opencode,warp,lmstudio,claude,qwen,swiftmaestro')
    ap.add_argument('--install-dir', default=None)
    ap.add_argument('--only', default=None, help='comma-separated server names')
    ap.add_argument('--yes', action='store_true', help='non-interactive; assume yes')
    ap.add_argument('--list', action='store_true', help='list servers and exit')
    ap.add_argument('--policy-check', action='store_true', help='run full safety check and exit')
    args = ap.parse_args()

    global NON_INTERACTIVE
    NON_INTERACTIVE = args.yes

    if args.policy_check:
        return safety.check()

    manifest = json.load(open(MANIFEST))
    defaults = manifest['defaults']
    profile = args.profile or defaults['profile']
    clients = [c.strip() for c in args.clients.split(',')] if args.clients else defaults['clients']
    home = os.path.expanduser('~')
    install_dir = os.path.expanduser(args.install_dir or defaults['install_dir'])
    servers = manifest['servers']

    if args.list:
        for name, s in servers.items():
            print(f'{name:24} {",".join(s["profiles"]):14} {s["label"]}')
        return 0

    selected = {n: s for n, s in servers.items() if profile in s.get('profiles', [])}
    if args.only:
        only = set(args.only.split(','))
        selected = {n: s for n, s in selected.items() if n in only}
    print(f'Profile: {profile} | clients: {", ".join(clients)}')
    print(f'Servers: {", ".join(selected)}')
    print(f'Install dir: {install_dir}\n')

    installed = {}
    for name, server in selected.items():
        missing = [b for b in server.get('requires', []) if not have(b)]
        if missing:
            print(f'[{name}] SKIP - missing prerequisites: {", ".join(missing)}')
            continue
        try:
            dest = fetch_server(name, server, install_dir, home, args.yes)
            setup_server(name, server, dest, install_dir, home)
            ensure_backend(name, server, install_dir, home, args.yes)
            for note in server.get('notes', []):
                print(f'[{name}] NOTE: {note}')
            installed[name] = server
        except Exception as e:
            print(f'[{name}] FAILED: {e}', file=sys.stderr)
            if not args.yes:
                answer = input('  continue with remaining servers? [y/N] ')
                if answer.lower() != 'y':
                    return 1

    spec = {
        'clients': clients,
        'servers': installed,
        'install_dir': install_dir,
        'home': home,
    }
    spec_path = os.path.join(install_dir, 'config-spec.json')
    os.makedirs(install_dir, exist_ok=True)
    with open(spec_path, 'w') as f:
        json.dump(spec, f, indent=2)
    run(f'python3 "{HERE}/lib/config_writer.py" --spec "{spec_path}"')
    print(f'\nDone. {len(installed)} servers configured. Restart your agents to pick them up.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
