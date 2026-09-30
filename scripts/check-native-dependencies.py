#!/usr/bin/env python3
"""Verify local backports that cargo-audit cannot assess by registry version."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1] / "src-tauri"
    vendor = root / "vendor"
    expected = json.loads((vendor / "checksums.json").read_text())
    actual = {
        str(path.relative_to(vendor)): hashlib.sha256(path.read_bytes()).hexdigest()
        for directory in vendor.iterdir()
        if directory.is_dir()
        for path in directory.rglob("*")
        if path.is_file()
    }
    if actual != expected:
        changed = sorted(key for key in actual.keys() | expected.keys()
                         if actual.get(key) != expected.get(key))
        sys.exit("Vendored backport changed; review before updating checksums:\n"
                 + "\n".join(changed))

    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--locked", "--format-version", "1",
         "--manifest-path", str(root / "Cargo.toml")], text=True))
    resolved = {node["id"] for node in metadata["resolve"]["nodes"]}
    packages = [package for package in metadata["packages"]
                if package["id"] in resolved]
    for name, version in [("glib", "0.18.5"), ("glib-macros", "0.18.5"),
                          ("gtk3-macros", "0.18.2")]:
        copies = [package for package in packages if package["name"] == name]
        manifest = vendor / f"{name}-{version}" / "Cargo.toml"
        if (len(copies) != 1 or copies[0]["source"] is not None
                or Path(copies[0]["manifest_path"]).resolve() != manifest):
            sys.exit(f"{name} must resolve exclusively to the reviewed local backport")
    abandoned = {"proc-macro-error", "proc-macro-error-attr", "proc-macro-error2"}
    found = sorted({package["name"] for package in packages} & abandoned)
    if found:
        sys.exit("Unmaintained macro dependency returned: " + ", ".join(found))
    print("Verified all three local backports and absence of abandoned macro crates.")


if __name__ == "__main__":
    main()
