"""Real-browser CSS regression, including a mutation that recreates review cycle 2.

No npm dependencies or browser downloads. CHROMIUM_BIN can select an installed
Chromium. The local disposable library cache is used only when present.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/sublime'))
from package import package, THEME_IDS


class EditorBrowser(unittest.TestCase):
    def render(self, css, width):
        browser = os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('chromium-browser')
        if not browser and Path('/usr/local/chromium/bin/chrome').is_file():
            browser = '/usr/local/chromium/bin/chrome'
        self.assertTrue(browser, 'Chromium required for editor regression; set CHROMIUM_BIN')
        html = (ROOT / 'tests/editor-browser.html').read_text().replace(
            '/*__PACKAGE_CSS__*/', css).replace('/*__THEME_IDS__*/ []', json.dumps(THEME_IDS))
        env = dict(os.environ)
        cached_libs = ROOT / '.verify-runtime/browser-libs/usr/lib/aarch64-linux-gnu'
        if cached_libs.is_dir():
            env['LD_LIBRARY_PATH'] = str(cached_libs) + ':' + env.get('LD_LIBRARY_PATH', '')
        cache = ROOT / '.verify-runtime'
        cache.mkdir(exist_ok=True)
        (cache / '.gitignore').write_text('*\n')
        with tempfile.TemporaryDirectory(prefix='editor-browser-', dir=cache) as directory:
            fixture = Path(directory) / 'fixture.html'
            fixture.write_text(html)
            result = subprocess.run([browser, '--headless', '--no-sandbox', '--disable-gpu',
                '--disable-background-networking', '--disable-component-update', '--no-first-run',
                '--no-default-browser-check', '--disable-sync', '--disable-extensions',
                '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-dev-shm-usage',
                '--user-data-dir=' + str(Path(directory) / 'profile'),
                '--window-size=' + str(width) + ',800', '--dump-dom', fixture.as_uri()],
                env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, 'Chromium failed: ' + result.stderr[-2000:])
        return result.stdout

    def test_native_palettes_preserved_and_old_override_detected(self):
        css = '\n'.join(n['content'] for n in package() if n['activation'] == 'appCss')
        for width in (1280, 800):
            with self.subTest(width=width):
                self.assertIn('>PASS 40 palette cases;', self.render(css, width))
        # Prove the regression test rejects the previous implementation rather
        # than just checking that a browser launches or expected files exist.
        broken = css + '''
        :root[data-thg-sublime] .cm-editor {
            background-color: var(--thg-editor-bg) !important;
            color: var(--thg-editor-text) !important;
        }
        '''
        self.assertIn('>FAIL ', self.render(broken, 1280))
