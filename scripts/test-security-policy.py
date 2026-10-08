"""Regression checks for shipped policy changes and the guard's CLI contract."""

import copy
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / "scripts/check-security-policy.py"
check_policy = runpy.run_path(str(GUARD))["check_policy"]


class SecurityPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
        self.capability = json.loads(
            (ROOT / "src-tauri/capabilities/default.json").read_text()
        )

    def test_shipped_policy_retains_required_native_operations(self):
        check_policy(self.config, self.capability)

    def test_unreviewed_override_directives_are_rejected(self):
        for directive in ("script-src-elem", "script-src-attr", "worker-src"):
            with self.subTest(directive=directive):
                config = copy.deepcopy(self.config)
                config["app"]["security"]["csp"][directive] = "'unsafe-inline' https:"
                with self.assertRaises(ValueError):
                    check_policy(config, self.capability)

    def test_widened_script_and_cleartext_image_sources_are_rejected(self):
        for directive, source in (("script-src", "'unsafe-inline'"), ("img-src", "http:")):
            with self.subTest(directive=directive):
                config = copy.deepcopy(self.config)
                config["app"]["security"]["csp"][directive] += f" {source}"
                with self.assertRaises(ValueError):
                    check_policy(config, self.capability)

    def test_remote_window_and_extra_permission_grants_are_rejected(self):
        variants = (
            {"remote": {"urls": ["https://*"]}},
            {"windows": ["*"]},
            {"permissions": self.capability["permissions"] + ["core:event:allow-emit"]},
        )
        for changes in variants:
            with self.subTest(changes=changes):
                capability = {**self.capability, **changes}
                with self.assertRaises(ValueError):
                    check_policy(self.config, capability)

    def test_non_http_external_link_grants_are_rejected(self):
        capability = copy.deepcopy(self.capability)
        opener = next(p for p in capability["permissions"] if isinstance(p, dict))
        opener["allow"].append({"url": "file://*"})
        with self.assertRaises(ValueError):
            check_policy(self.config, capability)

    def test_cli_fails_closed_and_accepts_the_shipped_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "src-tauri/capabilities").mkdir(parents=True)
            shutil.copyfile(GUARD, root / "scripts/check-security-policy.py")
            (root / "src-tauri/capabilities/default.json").write_text(
                json.dumps(self.capability)
            )
            config_path = root / "src-tauri/tauri.conf.json"
            override = copy.deepcopy(self.config)
            override["app"]["security"]["csp"]["script-src-elem"] = "https:"
            for label, content, expected_success in (
                ("valid", json.dumps(self.config), True),
                ("override", json.dumps(override), False),
                ("invalid JSON", "{", False),
                ("invalid shape", "null", False),
            ):
                with self.subTest(case=label):
                    config_path.write_text(content)
                    result = subprocess.run(
                        [sys.executable, str(root / "scripts/check-security-policy.py")],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(result.returncode == 0, expected_success)
                    self.assertEqual("Verified shipped CSP" in result.stdout, expected_success)


if __name__ == "__main__":
    unittest.main()
