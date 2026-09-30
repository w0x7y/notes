#!/usr/bin/env python3
"""Run the isolated GTK 4 build using local WebKit and disposable app data."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', type=Path, default=Path(__file__).resolve().parents[1] / 'src-tauri/target/release/notes')
parser.add_argument('--test-root', type=Path)
parser.add_argument('--debug', action='store_true')
args = parser.parse_args()
cache = Path.home() / '.cache/notes-gtk4-experiment'
sysroot = cache / 'sysroot'
test_root = args.test_root or Path(tempfile.mkdtemp(prefix='notes-gtk4-smoke-'))
test_root = test_root.resolve()
for name in ['config', 'data', 'cache', 'workspace']:
    (test_root / name).mkdir(parents=True, exist_ok=True)
settings = test_root / 'config/dev.idan.notes/notes.json'
if not settings.exists():
    settings.parent.mkdir(parents=True, exist_ok=True)
    (test_root / 'workspace/smoke.md').write_text('# GTK 4 experiment\n\nEnglish and שלום.\n\n#smoke\n')
    settings.write_text(json.dumps({
        'workspaces': [{'id': 'smoke', 'name': 'GTK 4 test', 'path': str(test_root / 'workspace'), 'color': '#e6b450', 'icon': 'book'}],
        'activeWorkspaceId': 'smoke',
        'sessions': {'smoke': {'tabs': ['smoke.md'], 'primary': 'smoke.md', 'secondary': None, 'split': False}},
    }))
env = dict(os.environ)
env['SHELL'] = '/bin/bash'
env['LD_LIBRARY_PATH'] = str(sysroot / 'usr/lib') + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
for name in ['CONFIG', 'DATA', 'CACHE']:
    env[f'XDG_{name}_HOME'] = str(test_root / name.lower())
# The distribution library uses an absolute path for its helper executables.
# Supply that path in a private mount namespace without installing system files.
command = ['bwrap', '--die-with-parent', '--ro-bind', '/', '/',
           '--overlay-src', '/usr/lib', '--overlay-src', str(sysroot / 'usr/lib'),
           '--ro-overlay', '/usr/lib',
           '--dev-bind', '/dev', '/dev', '--proc', '/proc',
           '--bind', '/tmp', '/tmp',
           '--bind', os.environ['XDG_RUNTIME_DIR'], os.environ['XDG_RUNTIME_DIR'],
           '--bind', str(test_root), str(test_root), '--']
command += (['gdb', '--batch', '-ex', 'run', '-ex', 'thread apply all bt 8', '--args'] if args.debug else [])
command += [str(args.binary.resolve())]
print(f'Temporary notes and settings: {test_root}', flush=True)
raise SystemExit(subprocess.call(command, env=env))
