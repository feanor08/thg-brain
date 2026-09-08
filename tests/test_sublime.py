import ast
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/sublime"))
from etapi import ETAPI, Refused, credential, validate_url, NoRedirect
from fixture import Fixture
from package import MODULES, MARKER, OWNER, THEME_IDS, package, stable_id, theme_data, theme_css
from reconcile import plan, execute
from cli import approved_source


class Reconciliation(unittest.TestCase):
    def setUp(self):
        self.api = Fixture()

    def apply(self):
        return execute(self.api, plan(self.api, "fixtureParent", "apply"))

    def refuse(self):
        before = deepcopy(self.api.notes)
        writes = len(self.api.writes)
        with self.assertRaises(Refused):
            plan(self.api, "fixtureParent", "apply")
        self.assertEqual(before, self.api.notes)
        self.assertEqual(writes, len(self.api.writes))

    def test_apply_twice_disable_twice_restore(self):
        knowledge = deepcopy(self.api.notes["fixtureParent"])
        self.assertEqual(self.apply()["created"], 10)
        self.assertEqual(self.apply(), dict(operations=0, created=0))
        owned = deepcopy(self.api.notes)
        self.assertEqual(len(plan(self.api, "fixtureParent", "disable")), 9)
        execute(self.api, plan(self.api, "fixtureParent", "disable"))
        self.assertEqual(plan(self.api, "fixtureParent", "disable"), [])
        self.assertEqual(set(owned), set(self.api.notes))
        for id in owned:
            self.assertEqual(owned[id]["content"], self.api.notes[id]["content"])
        self.assertEqual(self.apply()["created"], 0)
        self.assertEqual(owned, self.api.notes)
        self.assertEqual(knowledge, self.api.notes["fixtureParent"])

    def test_dry_run_writes_nothing(self):
        self.assertEqual(len(plan(self.api, "fixtureParent", "apply")), 29)
        self.assertEqual(self.api.writes, [])

    def test_update_only_owned_content(self):
        self.apply()
        self.api.notes[stable_id("editor")]["content"] = "/* previous release */"
        self.assertEqual(self.apply()["created"], 0)
        self.assertEqual(self.apply()["operations"], 0)
        self.assertFalse(any(method == "DELETE" and path.startswith("/notes") for method, path, _ in self.api.writes))

    def test_foreign_marker_anywhere_refused(self):
        self.api.notes["unrelated"] = dict(noteId="unrelated", attributes=[dict(name=MARKER, value=OWNER)])
        self.refuse()

    def test_preflight_late_conflict_causes_no_early_writes(self):
        self.apply()
        self.api.notes[stable_id("root")]["content"] = "old"
        self.api.notes[stable_id("controller")]["attributes"][0]["value"] = "foreign-owner"
        self.refuse()

    def test_missing_marker_or_interrupted_creation_refused(self):
        self.apply()
        note = self.api.notes[stable_id("layout")]
        self.api.attrs.pop(note["attributes"][0]["attributeId"])
        note["attributes"].pop(0)
        self.refuse()

    def test_wrong_kind_protected_moved_cloned_inherited(self):
        for change in (dict(type="file"), dict(isProtected=True), dict(parentNoteIds=["other"]),
                       dict(parentNoteIds=[stable_id("root"), "clone"])):
            self.api = Fixture()
            self.apply()
            self.api.notes[stable_id("tabs")].update(change)
            self.refuse()
        self.api = Fixture()
        self.apply()
        self.api.notes[stable_id("tabs")]["attributes"][0]["isInheritable"] = True
        self.refuse()

    def test_duplicate_or_extra_attributes_refused(self):
        self.apply()
        self.api.notes[stable_id("tabs")]["attributes"].append(
            deepcopy(self.api.notes[stable_id("tabs")]["attributes"][0]))
        self.refuse()

    def test_global_attribute_id_collision(self):
        self.api.attrs[stable_id("root:" + MARKER)] = dict(attributeId=stable_id("root:" + MARKER),
                           noteId="unrelated", name=MARKER, value=OWNER, type="label", isInheritable=False)
        self.refuse()

    def test_wrong_target_version_and_parent(self):
        self.api.version = "0.105.0"
        self.refuse()
        self.api.version = "0.104.1"
        for parent in ("root", "missingNote", "../root"):
            with self.assertRaises(Refused):
                plan(self.api, parent, "apply")
        self.assertEqual(self.api.writes, [])

    def test_parent_child_templates_and_inheritable_attributes_refused(self):
        for attr in (dict(name="child:template", type="relation", value="otherNote"),
                     dict(name="child:widget", type="label", value=""),
                     dict(name="custom", type="label", value="", isInheritable=True)):
            self.api = Fixture()
            self.api.notes["fixtureParent"]["attributes"].append(attr)
            self.refuse()

    def test_partial_update_recovery(self):
        self.apply()
        self.api.notes[stable_id("editor")]["content"] = "old"
        ops = plan(self.api, "fixtureParent", "apply")
        execute(self.api, ops[:10])  # all activations removed, content updated
        self.assertEqual(self.apply()["created"], 0)
        self.assertEqual(self.apply()["operations"], 0)

    def test_owned_ids_without_markers_refused(self):
        self.api.notes[stable_id("root")] = dict(noteId=stable_id("root"), title="User knowledge",
              type="text", mime="text/html", parentNoteIds=["fixtureParent"], attributes=[], isProtected=False)
        self.refuse()


class Security(unittest.TestCase):
    def test_loopback_only_and_no_redirect(self):
        for url in ("https://lore.thehighground.xyz", "http://192.168.0.112:8080", "http://localhost:8080",
                    "http://127.0.0.1:8080/etapi", "http://user:secret@127.0.0.1:8080", "http://127.0.0.1:8080/?token=x"):
            with self.assertRaises(Refused): validate_url(url)
        self.assertEqual(validate_url("http://127.0.0.1:18080"), "http://127.0.0.1:18080/etapi")
        self.assertEqual(validate_url("http://[::1]:18080"), "http://[::1]:18080/etapi")
        with self.assertRaises(Refused): NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_credentials_not_in_transport_url_and_no_proxy(self):
        client = ETAPI("http://127.0.0.1:18080", "FIXTURE_PLACEHOLDER")
        self.assertNotIn("FIXTURE_PLACEHOLDER", client.base)
        self.assertFalse(any(getattr(h, "proxies", {}) for h in client.opener.handlers))

    def test_transport_contract_and_error_redaction(self):
        import io
        import urllib.error
        from unittest.mock import MagicMock
        client = ETAPI("http://127.0.0.1:18080", "FIXTURE_PLACEHOLDER")
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 204
        response.read.return_value = b""
        client.opener = MagicMock()
        client.opener.open.return_value = response
        self.assertIsNone(client.request("PUT", "/notes/exampleNote/content", "body π", text=True))
        req = client.opener.open.call_args[0][0]
        self.assertEqual(req.method, "PUT")
        self.assertEqual(req.full_url, "http://127.0.0.1:18080/etapi/notes/exampleNote/content")
        self.assertEqual(req.get_header("Authorization"), "FIXTURE_PLACEHOLDER")
        self.assertEqual(req.get_header("Content-type"), "text/plain; charset=utf-8")
        self.assertEqual(req.data, "body π".encode())
        client.opener.open.side_effect = urllib.error.HTTPError(
            "private-url", 403, "FIXTURE_PLACEHOLDER", {}, io.BytesIO(b"private body"))
        with self.assertRaises(Refused) as error:
            client.request("GET", "/app-info")
        self.assertEqual(str(error.exception), "ETAPI HTTP 403; response withheld")

    def test_protected_file_and_ambiguous_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "placeholder"
            path.write_text("FIXTURE_PLACEHOLDER")
            path.chmod(0o600)
            with patch.dict(os.environ, {"THG_ETAPI_TOKEN_FILE": str(path)}, clear=True):
                self.assertEqual(credential(), "FIXTURE_PLACEHOLDER")
                path.chmod(0o644)
                with self.assertRaises(Refused): credential()
            with patch.dict(os.environ, {"THG_ETAPI_TOKEN": "FIXTURE_PLACEHOLDER", "THG_ETAPI_TOKEN_FILE": str(path)}, clear=True):
                with self.assertRaises(Refused): credential()
            path.chmod(0o600)
            link = Path(directory) / "symlink"
            link.symlink_to(path)
            with patch.dict(os.environ, {"THG_ETAPI_TOKEN_FILE": str(link)}, clear=True):
                with self.assertRaises(Refused): credential()

    def test_exact_source_gates(self):
        with self.assertRaises(Refused): approved_source(None, None)
        with patch("cli.git", return_value="b" * 40):
            with self.assertRaises(Refused): approved_source("a" * 40, "b" * 40)
        with patch("cli.git", side_effect=["a" * 40, "b" * 40, " M file"]):
            with self.assertRaises(Refused): approved_source("a" * 40, "b" * 40)
        with patch("cli.git", side_effect=["a" * 40, "b" * 40, ""]):
            approved_source("a" * 40, "b" * 40)


class Package(unittest.TestCase):
    def test_themes_and_supported_notes(self):
        notes = package()
        self.assertEqual(notes, package())
        self.assertEqual(len({n["noteId"] for n in notes}), 10)
        data = theme_data()
        self.assertEqual(len(data["themes"]), 9)
        self.assertEqual(data["default"], "thg-sublime")
        self.assertEqual(tuple(t["id"] for t in data["themes"]), THEME_IDS)
        self.assertEqual(len([n for n in notes if n["activation"] == "appCss"]), 8)
        self.assertEqual(notes[-1]["mime"], "application/javascript;env=frontend")
        self.assertEqual(notes[-1]["activation"], "widget")
        self.assertNotIn("/*__THG_THEMES__*/", notes[-1]["content"])

    def test_readable_theme_contrast(self):
        def luminance(color):
            rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
            return sum((c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) * w
                       for c, w in zip(rgb, (0.2126, 0.7152, 0.0722)))
        for theme in theme_data()["themes"]:
            ui = theme["ui"]
            for foreground in ("text", "muted", "accent"):
                for background in ("bg", "panel"):
                    a, b = sorted((luminance(ui[foreground]), luminance(ui[background])))
                    self.assertGreaterEqual((b + 0.05) / (a + 0.05), 4.5, (theme["id"], foreground, background))
            a, b = sorted((luminance(ui["text"]), luminance(ui["selection"])))
            self.assertGreaterEqual((b + .05) / (a + .05), 4.5)

    def test_typography_mobile_and_scope(self):
        typography = (ROOT / "sublime/styles/typography.css").read_text()
        for text in ('"Fira Code"', "23px", "30px", '"liga" 1', '"calt" 1'):
            self.assertIn(text, typography)
        self.assertGreaterEqual(len(MODULES), 7)
        for module in ("layout", "sidebar", "tabs"):
            text = (ROOT / f"sublime/styles/{module}.css").read_text()
            self.assertIn("@media (min-width: 901px)", text)
            self.assertIn("body.desktop", text)
            self.assertIn(":root[data-thg-sublime]", text)
            self.assertNotIn("display: none", text)
        status = (ROOT / "sublime/styles/status.css").read_text()
        for text in ("@media (max-width: 900px)", "body.mobile", "display: none !important", "min-width: 0", "flex: 0 0 auto"):
            self.assertIn(text, status)
        self.assertNotIn("position: fixed", status)

    def test_no_db_or_embedded_credentials_and_compile(self):
        for path in (ROOT / "scripts/sublime").glob("*.py"):
            source = path.read_text()
            compile(source, str(path), "exec")
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    self.assertFalse(any(n.name in ("sqlite3", "psycopg2") for n in node.names))
            self.assertNotIn("/opt/thg-brain-data", source)
            self.assertNotIn("document.db", source)
        for path in [*(ROOT / "sublime").rglob("*"), *(ROOT / "scripts/sublime").glob("*.py")]:
            if path.is_file():
                text = path.read_text()
                self.assertNotRegex(text, r"(?:etapi|trilium)[_-]token\s*[:=]\s*['\"][A-Za-z0-9]{20,}")

    def test_baseline_assets_unchanged(self):
        baseline = json.loads((ROOT / "tests/baseline-assets.json").read_text())
        for filename, expected in baseline.items():
            content = (ROOT / filename).read_bytes()
            self.assertEqual(hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest(), expected, filename)

    def test_disable_documentation_and_live_plan(self):
        doc = (ROOT / "docs/THG-SUBLIME.md").read_text()
        for phrase in ("disable", "Ctrl+Shift+R", "Phases 2–5", "clds approve", "get_service_health", "get_route_health"):
            self.assertIn(phrase, doc)
        steps = json.loads((ROOT / "docs/sublime-live-verify.json").read_text())["steps"]
        self.assertEqual([s["tool"] for s in steps], ["get_service_health", "get_route_health"])
        self.assertTrue(all(s["expect"] == {"status": "ok"} and s["failure_classification"] == "action_required" for s in steps))


if __name__ == "__main__": unittest.main()
