"""Real-browser CSS regression, including a mutation that recreates review cycle 2.

No npm dependencies or browser downloads. CHROMIUM_BIN can select an installed
Chromium. The local disposable library cache is used only when present.
"""
import json
from pathlib import Path
import sys
import unittest

from browser_runner import render

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/sublime'))
from package import package, THEME_IDS


class EditorBrowser(unittest.TestCase):
    def render(self, css, width):
        html = (ROOT / 'tests/editor-browser.html').read_text().replace(
            '/*__PACKAGE_CSS__*/', css).replace('/*__THEME_IDS__*/ []', json.dumps(THEME_IDS))
        html = html.replace('/*__WIDTH__*/ 0', str(width))
        return render(html, width)

    def test_native_palettes_preserved_and_old_override_detected(self):
        css = '\n'.join(n['content'] for n in package() if n['activation'] == 'appCss')
        for width in (1280, 800):
            with self.subTest(width=width):
                self.assertEqual(f'PASS 40 palette cases; width={width}', self.render(css, width))
        # Prove the regression test rejects the previous implementation rather
        # than just checking that a browser launches or expected files exist.
        broken = css + '''
        :root[data-thg-sublime] .cm-editor {
            background-color: var(--thg-editor-bg) !important;
            color: var(--thg-editor-text) !important;
        }
        '''
        self.assertRegex(self.render(broken, 1280), r'^FAIL [a-z-]+: native [01] colors changed')
