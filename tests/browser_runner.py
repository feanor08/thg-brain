"""Dependency-free installed-Chromium runner for offline CSS fixtures.

Collect the fixture's explicit result rather than waiting for --dump-dom/browser
shutdown. Each run owns a disposable profile and a bounded process lifetime.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def resolve_browser():
    override = os.environ.get('CHROMIUM_BIN')
    if override is not None:
        candidate = shutil.which(override) if override else None
        if not candidate:
            raise RuntimeError('CHROMIUM_BIN must identify an executable Chrome/Chromium binary')
        return candidate
    for name in ('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'):
        candidate = shutil.which(name)
        if candidate:
            return candidate
    paths = ['/usr/local/chromium/bin/chrome']
    if platform.system() == 'Darwin':
        paths = [str(base / app / 'Contents/MacOS' / binary)
                 for base in (Path('/Applications'), Path.home() / 'Applications')
                 for app, binary in (('Google Chrome.app', 'Google Chrome'),
                                     ('Chromium.app', 'Chromium'),
                                     ('Google Chrome for Testing.app', 'Google Chrome for Testing'))]
    for candidate in paths:
        if Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError('Chrome/Chromium required; install it or set CHROMIUM_BIN to its executable')


def stop_browser(process):
    # A new POSIX session isolates this run from the operator's normal browser.
    # Kill its process group even if the parent has already exited.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        if sig == signal.SIGTERM:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
    process.wait(timeout=3)


def render(html, width, timeout=45, api_handler=None, keyboard=False):
    browser = resolve_browser()
    outcome = []

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(2)
            super().setup()

        def log_message(self, *args):
            pass

        def do_PUT(self):
            if not api_handler or not api_handler(self):
                self.send_error(404)

        do_DELETE = do_PUT

        def do_GET(self):
            if api_handler and api_handler(self):
                return
            if self.path != '/fixture':
                self.send_error(404)
                return
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if keyboard and self.path in ('/keyboard/rust', '/keyboard/auto'):
                node = subprocess.check_output([sys.executable, str(ROOT / 'scripts/sublime/runtime.py')], text=True).strip()
                subprocess.run([node, str(ROOT / 'tests/chromium_keys.cjs'),
                                str(Path(directory) / 'profile'), self.path.split('/')[-1]],
                               check=True, timeout=10, capture_output=True)
                self.send_response(204)
                self.end_headers()
                return
            length = int(self.headers.get('Content-Length', '0'))
            if self.path != '/result' or not 0 < length <= 4096:
                self.send_error(400)
                return
            outcome.append(self.rfile.read(length).decode('utf-8'))
            self.send_response(204)
            self.end_headers()

    env = dict(os.environ)
    cached_libs = ROOT / '.verify-runtime/browser-libs/usr/lib/aarch64-linux-gnu'
    if platform.system() == 'Linux' and cached_libs.is_dir():
        env['LD_LIBRARY_PATH'] = str(cached_libs) + ':' + env.get('LD_LIBRARY_PATH', '')
    cache = ROOT / '.verify-runtime'
    cache.mkdir(exist_ok=True)
    (cache / '.gitignore').write_text('*\n')
    with tempfile.TemporaryDirectory(prefix='thg-editor-browser-', dir=cache) as directory, \
            ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        server.timeout = .2
        args = [browser, '--headless=new', '--disable-gpu', '--disable-background-networking',
                '--disable-component-update', '--no-first-run', '--no-default-browser-check',
                '--disable-sync', '--disable-extensions', '--disable-dev-shm-usage',
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                '--no-proxy-server', '--user-data-dir=' + str(Path(directory) / 'profile'),
                '--window-size=' + str(width) + ',800',
                f'http://127.0.0.1:{server.server_port}/fixture']
        if keyboard:
            args.insert(2, '--remote-debugging-port=0')
        if platform.system() == 'Linux':
            args.insert(2, '--no-sandbox')
        # File output cannot fill a pipe and deadlock Chrome startup/shutdown.
        with open(Path(directory) / 'browser.log', 'w+b') as log:
            process = subprocess.Popen(args, env=env, stdout=log, stderr=log, start_new_session=True)
            try:
                deadline = time.monotonic() + timeout
                while not outcome and process.poll() is None and time.monotonic() < deadline:
                    server.handle_request()
                if not outcome:
                    log.seek(0, 2)
                    log.seek(max(0, log.tell() - 2000))
                    details = log.read().decode('utf-8', errors='replace')
                    raise RuntimeError(f'Browser fixture did not complete within {timeout}s '
                                       f'(exit={process.poll()}); {details}')
                return outcome[0]
            finally:
                stop_browser(process)
