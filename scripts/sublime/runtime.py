"""Resolve Node for local tests, with a checksum-pinned, workspace-only fallback.

No npm, system installation, shell profiles or credentials are involved.
Archive digests: https://nodejs.org/dist/v22.16.0/SHASUMS256.txt
"""
import hashlib
import io
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request

VERSION = "22.16.0"
DIGESTS = {
    "linux-arm64": "eab80cb88f8fda1e65f5e8d0420c9809bdb320b03fd34976ab7161b6e703b910",
    "linux-x64": "f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e",
    "darwin-arm64": "aaf7fc3c936f1b359bc312b63638e41f258689ac2303966ad932cda18c54ea00",
    "darwin-x64": "5c34638f2c0e3f3aaa7b3a94b58304765a169730da1896ebba8515ea4d987a9c",
}
CACHE = Path(__file__).resolve().parents[2] / ".verify-runtime"


def supported_node(candidate):
    try:
        result = subprocess.run([candidate, "-p", "process.versions.node"],
                                capture_output=True, text=True, timeout=10, check=True)
        return int(result.stdout.strip().split(".")[0]) >= 18
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def binary_from_archive(raw, target):
    if hashlib.sha256(raw).hexdigest() != DIGESTS[target]:
        raise RuntimeError("Node archive checksum mismatch")
    # Extract exactly one regular file into a chosen path; never extract archive paths.
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:xz") as archive:
        member = archive.getmember(f"node-v{VERSION}-{target}/bin/node")
        if not member.isfile() or member.size > 150 * 1024 * 1024:
            raise RuntimeError("Invalid Node archive member")
        return archive.extractfile(member).read()


def resolve():
    override = os.environ.get("NODE_BIN")
    if override is not None:
        candidate = shutil.which(override) if override else None
        if not candidate or not supported_node(candidate):
            raise RuntimeError("NODE_BIN must identify an executable Node 18+ runtime")
        return candidate
    for name in ("node", "nodejs"):
        candidate = shutil.which(name)
        if candidate and supported_node(candidate):
            return candidate
    arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    target = f"{platform.system().lower()}-{arch}"
    if target not in DIGESTS:
        raise RuntimeError("No bundled runtime for this platform; set NODE_BIN to Node 18+")
    filename = f"node-v{VERSION}-{target}.tar.xz"
    archive_path = CACHE / filename
    CACHE.mkdir(exist_ok=True)
    # Ignore only this disposable cache, leaving baseline deployment assets unchanged.
    (CACHE / ".gitignore").write_text("*\n")
    if archive_path.exists():
        raw = archive_path.read_bytes()
    else:
        print(f"Verification: fetching checksum-pinned Node {VERSION} ({target})", file=sys.stderr)
        try:
            with urllib.request.urlopen(f"https://nodejs.org/dist/v{VERSION}/{filename}", timeout=30) as response:
                raw = response.read(60 * 1024 * 1024 + 1)
        except OSError:
            raise RuntimeError("Node unavailable: set NODE_BIN to Node 18+ or preseed .verify-runtime/ with the documented official archive (network unavailable)") from None
        if len(raw) > 60 * 1024 * 1024:
            raise RuntimeError("Node archive exceeds size limit")
    binary = binary_from_archive(raw, target)
    archive_path.write_bytes(raw)
    executable = CACHE / f"node-v{VERSION}-{target}"
    # Rebuild from verified bytes every run, rather than trusting a cached executable.
    executable.write_bytes(binary)
    executable.chmod(0o700)
    if not supported_node(str(executable)):
        raise RuntimeError("Pinned Node cannot run on this host; set NODE_BIN to compatible Node 18+")
    return str(executable)


if __name__ == "__main__":
    try:
        print(resolve())
    except (RuntimeError, OSError, tarfile.TarError, KeyError):
        # Do not print paths or arbitrary upstream response/error content.
        print("Verification requires executable Node 18+: use NODE_BIN, or the checksum-pinned .verify-runtime archive cache; see docs/THG-SUBLIME.md.", file=sys.stderr)
        sys.exit(1)
