#!/usr/bin/env python3
"""Idempotently merge MCP server entries into each client's config.

Every file is backed up before modification. Existing entries that are not
managed by this installer are left untouched.
"""
import argparse
import datetime
import json
import os
import re
import sys

MANAGED_TAG = '_woodsee_mcp_easy_managed'


def strip_jsonc(text):
    text = re.sub(r'(?m)^\s*//.*$', '', text)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    return text


def load(path):
    if not os.path.exists(path):
        return {}
    raw = open(path, encoding='utf-8').read()
    try:
        return json.loads(strip_jsonc(raw))
    except json.JSONDecodeError as e:
        print(f'ERROR: cannot parse {path}: {e}', file=sys.stderr)
        return None


def backup(path):
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = f'{path}.bak-{ts}'
    with open(bak, 'wb') as out, open(path, 'rb') as src:
        out.write(src.read())
    return bak


def deep_set(doc, path, value):
    cur = doc
    for key in path[:-1]:
        cur = cur.setdefault(key, {})
    cur[path[-1]] = value


def write_config(path, root_key, entries, nested_paths):
    doc = load(path)
    if doc is None:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        print(f'  backup: {backup(path)}')
    target = doc.setdefault(root_key, {})
    for name, entry in entries.items():
        entry = dict(entry)
        entry[MANAGED_TAG] = True
        np = nested_paths.get(name)
        if np:
            holder = target
            for key in np[:-1]:
                holder = holder.setdefault(key, {})
            holder[np[-1]] = entry
        else:
            target[name] = entry
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=2)
        f.write('\n')
    print(f'  wrote {len(entries)} entries to {path}')
    return True


def opencode_entry(server):
    cmd = server['command']
    return {
        'type': 'local',
        'command': cmd,
        'environment': server.get('env', {}),
        'enabled': True,
        '_comment': server.get('label', ''),
    }


def generic_entry(server):
    cmd = server['command']
    return {
        'command': cmd[0],
        'args': cmd[1:],
        'env': server.get('env', {}),
        '_comment': server.get('label', ''),
    }


def swiftmaestro_entry(server):
    e = generic_entry(server)
    return {
        'description': server.get('label', ''),
        'command': e['command'],
        'args': e['args'],
        'env': e['env'],
        'local_path': '',
        'warp': False,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', required=True, help='JSON file: {clients, servers, install_dir, home}')
    args = ap.parse_args()
    spec = json.load(open(args.spec))
    servers = spec['servers']
    install_dir = spec['install_dir']
    home = spec['home']
    nested = {n: s['opencode_path'] for n, s in servers.items() if s.get('opencode_path')}

    def expand(obj):
        if isinstance(obj, str):
            return obj.replace('{{INSTALL_DIR}}', install_dir).replace('{{HOME}}', home)
        if isinstance(obj, list):
            return [expand(x) for x in obj]
        if isinstance(obj, dict):
            return {k: expand(v) for k, v in obj.items()}
        return obj

    opencode = {n: expand(opencode_entry(s)) for n, s in servers.items()}
    generic = {n: expand(generic_entry(s)) for n, s in servers.items()}
    swift = {n: expand(swiftmaestro_entry(s)) for n, s in servers.items()}

    paths = {
        'opencode': (os.path.join(home, '.config/opencode/opencode.jsonc'), 'mcp', opencode),
        'warp': (os.path.join(home, '.warp/.mcp.json'), 'mcpServers', generic),
        'lmstudio': (os.path.join(home, '.lmstudio/mcp.json'), 'mcpServers', generic),
        'claude': (os.path.join(home, '.claude.json'), 'mcpServers', generic),
        'qwen': (os.path.join(home, '.qwen/settings.json'), 'mcpServers', generic),
        'swiftmaestro': (os.path.join(home, '.ai-context/mcp-registry/mcp-servers.json'), 'servers', swift),
    }

    ok = True
    for client in spec['clients']:
        if client not in paths:
            print(f'WARNING: unknown client {client}', file=sys.stderr)
            continue
        path, root, entries = paths[client]
        print(f'[{client}]')
        # The nested "servers" path is an OpenCode quirk only. Other clients
        # use a flat name -> server map.
        client_nested = nested if client == 'opencode' else {}
        if not write_config(path, root, entries, client_nested):
            ok = False
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
