"""Packaged widget interaction and responsive geometry in Chromium; no live Trilium."""
import json
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
                labels = {}
                writes = []

                def native_attributes(request):
                    if not request.path.startswith('/lore/api/'):
                        return False
                    if request.command == 'GET' and request.path == '/lore/api/fixture-labels':
                        body = json.dumps(labels).encode()
                        request.send_response(200)
                        request.send_header('Content-Type', 'application/json')
                        request.send_header('Content-Length', str(len(body)))
                        request.end_headers()
                        request.wfile.write(body)
                        return True
                    if request.headers.get('x-csrf-token') != 'FIXTURE_CSRF':
                        request.send_error(403)
                        return True
                    self.assertIsNone(request.headers.get('Authorization'))
                    if request.command == 'PUT':
                        self.assertEqual(request.path, '/lore/api/notes/example/set-attribute')
                        body = json.loads(request.rfile.read(int(request.headers['Content-Length'])))
                        self.assertEqual(set(body), {'type', 'name', 'value', 'isInheritable'})
                        self.assertEqual((body['type'], body['name'], body['isInheritable']),
                                         ('label', 'thgSublimeLanguage', False))
                        labels[body['name']] = body['value']
                    else:
                        self.assertEqual(request.command, 'DELETE')
                        self.assertEqual(request.path, '/lore/api/notes/example/attributes/lock-id')
                        labels.pop('thgSublimeLanguage', None)
                    writes.append(request.command)
                    request.send_response(204)
                    request.end_headers()
                    return True

                self.assertEqual(render(html, width, api_handler=native_attributes), 'PASS language controls')
                self.assertEqual(writes, ['PUT', 'DELETE', 'PUT', 'DELETE'])
                self.assertEqual(labels, {})
