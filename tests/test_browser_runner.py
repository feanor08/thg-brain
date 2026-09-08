"""Portable discovery and bounded completion/cleanup regressions (no browser needed)."""
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import browser_runner as runner


class BrowserRunner(unittest.TestCase):
    def test_explicit_override_with_spaces_and_invalid_override(self):
        with patch.dict(os.environ, {'CHROMIUM_BIN': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}), \
                patch.object(runner.shutil, 'which', side_effect=lambda value: value):
            self.assertIn('Google Chrome.app', runner.resolve_browser())
        with patch.dict(os.environ, {'CHROMIUM_BIN': ''}):
            with self.assertRaisesRegex(RuntimeError, 'CHROMIUM_BIN'):
                runner.resolve_browser()

    def test_macos_system_and_user_app_discovery(self):
        for base in (Path('/Applications'), Path.home() / 'Applications'):
            expected = str(base / 'Google Chrome.app/Contents/MacOS/Google Chrome')
            with self.subTest(base=base), patch.dict(os.environ, {}, clear=True), \
                    patch.object(runner.platform, 'system', return_value='Darwin'), \
                    patch.object(runner.shutil, 'which', return_value=None), \
                    patch.object(Path, 'is_file', lambda path: str(path) == expected), \
                    patch.object(runner.os, 'access', return_value=True):
                self.assertEqual(runner.resolve_browser(), expected)

    def run_driver(self, code, timeout):
        original = subprocess.Popen
        children = []
        profiles = []

        def launch(args, **kwargs):
            profiles.extend(arg.split('=', 1)[1] for arg in args if arg.startswith('--user-data-dir='))
            child = original([sys.executable, '-c', code, args[-1]], **kwargs)
            children.append(child)
            return child

        with patch.object(runner, 'resolve_browser', return_value='fixture-browser'), \
                patch.object(runner.subprocess, 'Popen', side_effect=launch):
            try:
                return runner.render('<p>fixture</p>', 1280, timeout=timeout)
            finally:
                self.assertTrue(children)
                self.assertIsNotNone(children[0].poll(), 'owned process must be reaped')
                self.assertFalse(Path(profiles[0]).parent.exists(), 'temporary profile must be removed')

    def test_completion_does_not_wait_for_browser_exit(self):
        result = self.run_driver('''
import sys, time, urllib.request
url = sys.argv[1]
assert urllib.request.urlopen(url).read() == b'<p>fixture</p>'
request = urllib.request.Request(url.replace('/fixture', '/result'), data=b'PASS fixture')
urllib.request.urlopen(request).close()
time.sleep(120)
''', timeout=5)
        self.assertEqual(result, 'PASS fixture')

    def test_timeout_and_early_exit_fail_and_cleanup(self):
        for code in ('import time; time.sleep(120)', 'raise SystemExit(7)'):
            with self.subTest(code=code), self.assertRaisesRegex(RuntimeError, 'did not complete'):
                self.run_driver(code, timeout=.4)
