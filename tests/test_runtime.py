"""Behavioral coverage of verification on hosts without Node on PATH."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/sublime"))
import runtime


class Runtime(unittest.TestCase):
    def test_explicit_override_is_authoritative(self):
        with patch.dict(os.environ, {"NODE_BIN": "/operator/node"}, clear=True), \
             patch("runtime.shutil.which", return_value="/operator/node"), \
             patch("runtime.supported_node", return_value=True):
            self.assertEqual(runtime.resolve(), "/operator/node")
        with patch.dict(os.environ, {"NODE_BIN": "missing"}, clear=True), \
             patch("runtime.shutil.which", return_value=None), \
             patch("runtime.urllib.request.urlopen") as network:
            with self.assertRaises(RuntimeError): runtime.resolve()
            network.assert_not_called()

    def test_nodejs_path_fallback(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch("runtime.shutil.which", side_effect=[None, "/usr/bin/nodejs"]), \
             patch("runtime.supported_node", return_value=True):
            self.assertEqual(runtime.resolve(), "/usr/bin/nodejs")

    def test_versions_and_unexecutable_runtime(self):
        for version, accepted in (("18.0.0", True), ("22.16.0", True), ("16.0.0", False), ("bad", False)):
            with patch("runtime.subprocess.run", return_value=subprocess.CompletedProcess([], 0, version)):
                self.assertEqual(runtime.supported_node("node"), accepted)
        with patch("runtime.subprocess.run", side_effect=OSError):
            self.assertFalse(runtime.supported_node("node"))

    def test_archive_hash_and_regular_member_only(self):
        target = "linux-arm64"
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w:xz") as archive:
            member = tarfile.TarInfo(f"node-v{runtime.VERSION}-{target}/bin/node")
            member.size = 7
            archive.addfile(member, io.BytesIO(b"fixture"))
            # Unrelated traversal entries must never be extracted.
            other = tarfile.TarInfo("../../escape")
            archive.addfile(other, io.BytesIO())
        raw = stream.getvalue()
        with self.assertRaises(RuntimeError): runtime.binary_from_archive(raw, target)
        with patch.dict(runtime.DIGESTS, {target: hashlib.sha256(raw).hexdigest()}):
            self.assertEqual(runtime.binary_from_archive(raw, target), b"fixture")

    def test_offline_cache_checked_each_time(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch("runtime.CACHE", Path(directory)), \
             patch.dict(os.environ, {}, clear=True), \
             patch("runtime.shutil.which", return_value=None), \
             patch("runtime.platform.system", return_value="Linux"), \
             patch("runtime.platform.machine", return_value="aarch64"), \
             patch("runtime.urllib.request.urlopen") as network:
            archive = Path(directory) / f"node-v{runtime.VERSION}-linux-arm64.tar.xz"
            archive.write_bytes(b"corrupted")
            with self.assertRaisesRegex(RuntimeError, "checksum"):
                runtime.resolve()
            network.assert_not_called()
            self.assertEqual(list(Path(directory).glob("node-*")), [archive])

    def test_missing_runtime_network_failure_does_not_skip(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch("runtime.CACHE", Path(directory)), \
             patch.dict(os.environ, {}, clear=True), \
             patch("runtime.shutil.which", return_value=None), \
             patch("runtime.platform.system", return_value="Linux"), \
             patch("runtime.platform.machine", return_value="aarch64"), \
             patch("runtime.urllib.request.urlopen", side_effect=OSError):
            with self.assertRaisesRegex(RuntimeError, "Node unavailable"):
                runtime.resolve()


if __name__ == "__main__": unittest.main()
