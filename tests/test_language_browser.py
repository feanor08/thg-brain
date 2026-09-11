"""Packaged widget interaction and responsive geometry in Chromium; no live Trilium."""
from pathlib import Path
import sys
import unittest
from browser_runner import render
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/sublime'))
from package import package

class LanguageBrowser(unittest.TestCase):
    def test_packaged_language_controls(self):
        notes = package()
        html = (ROOT / 'tests/language-browser.html').read_text().replace(
            '/*__CSS__*/', '\n'.join(n['content'] for n in notes if n['activation'] == 'appCss')).replace(
            '/*__CONTROLLER__*/', notes[-1]['content'])
        for width in (1280, 901, 800):
            with self.subTest(width=width):
                self.assertEqual(render(html, width), 'PASS language controls')
