#!/usr/bin/env python3
"""Guard the shipped WebView policy and the permissions used by Notes."""

import json
from pathlib import Path


def check_policy(config, capability):
    if config["app"]["security"].get("capabilities") != ["default"]:
        raise ValueError("Only the reviewed default capability may be enabled")
    csp = config["app"]["security"]["csp"]
    required = {
        "default-src": {"'self'"},
        "script-src": {"'self'"},
        "style-src": {"'self'", "'unsafe-inline'"},
        "img-src": {"'self'", "data:", "blob:", "https:"},
        "font-src": {"'self'", "data:"},
        "connect-src": {"ipc:", "http://ipc.localhost"},
        "object-src": {"'none'"},
        "frame-src": {"'none'"},
        "base-uri": {"'self'"},
        "form-action": {"'none'"},
    }
    if set(csp) != set(required):
        raise ValueError("Only the reviewed CSP directives may be enabled")
    for directive, sources in required.items():
        if set(csp.get(directive, "").split()) != sources:
            raise ValueError(f"Unexpected {directive} policy")
    if capability.get("windows") != ["main"] or capability.get("webviews"):
        raise ValueError("Permissions must target only the main window")
    if capability.get("remote") or capability.get("local", True) is not True:
        raise ValueError("Permissions must apply only to local app content")
    permissions = capability.get("permissions", [])
    identifiers = [p if isinstance(p, str) else p["identifier"] for p in permissions]
    expected = {
        "core:event:allow-listen",
        "core:event:allow-unlisten",
        "core:window:allow-destroy",
        "dialog:allow-open",
        "clipboard-manager:allow-write-text",
        "opener:allow-open-url",
    }
    if set(identifiers) != expected or len(identifiers) != len(expected):
        raise ValueError("Unexpected native permission grant")
    opener = next(
        p for p in permissions
        if isinstance(p, dict) and p["identifier"] == "opener:allow-open-url"
    )
    if (
        opener.get("allow") != [{"url": "https://*"}, {"url": "http://*"}]
        or opener.get("deny")
    ):
        raise ValueError("External links must be restricted to HTTP(S)")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    try:
        check_policy(
            json.loads((root / "src-tauri/tauri.conf.json").read_text()),
            json.loads((root / "src-tauri/capabilities/default.json").read_text()),
        )
    except (KeyError, ValueError, StopIteration) as error:
        raise SystemExit(f"Security policy check failed: {error}") from error
    print("Verified shipped CSP, local window scope and required native permissions.")
