const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('sublime/language.js', 'utf8') + '\nthis.languages = THG_LANGUAGES; this.detect = thgDetect; this.advance = thgAdvance;', context);
const corpus = {
 python: 'import os\ndef main():\n    print(os.getcwd())',
 javascript: 'const greet = (name) => { console.log(name); };',
 typescript: 'interface User { name: string; }\nconst user: User = {name: "Ada"};',
 json: '{"name":"Ada", "count":42}',
 shell: '#!/bin/bash\nexport HOME_DIR=/tmp\necho "$HOME_DIR"',
 c: '#include <stdio.h>\nint main(void) { printf("hello"); }',
 cpp: '#include <iostream>\nint main() { std::cout << "hello"; }',
 java: 'package example;\npublic class Main { public static void main(String[] args) { System.out.println("hello"); } }',
 kotlin: 'fun main() { val name = "Ada"; println(name) }',
 swift: 'import Foundation\nfunc greet() { let name: String = "Ada"; print(name) }',
 rust: 'use std::io;\nfn main() { let mut count = 0; println!("{}", count); }',
 go: 'package main\nfunc main() { count := 1; fmt.Println(count) }',
 yaml: 'services:\n  web:\n    image: example\n    ports:\n      - 8080',
 sql: 'SELECT name, id FROM users WHERE id = 1 ORDER BY name;',
 html: '<!doctype html>\n<html><body><p>Hello</p></body></html>',
 css: '.hello { color: red; padding: 4px; }',
 markdown: '# Project\n\n- Read the [guide](https://example.org)',
 dockerfile: 'FROM alpine:3\nRUN echo hello\nWORKDIR /app'
};
for (const [id, content] of Object.entries(corpus)) {
 const result = context.detect(content);
 assert.equal(result.id, id, JSON.stringify(result) + ' expected ' + id);
 assert.ok(result.confidence >= 0 && result.confidence <= 100);
 assert.deepEqual(context.detect(content), result);
}
for (const content of ['', 'x', 'return true;', '{}', '[]', '{"x":1}', 'echo hello world',
 'We select products from suppliers where possible.', '# Heading only without other markup',
 '# import os\n# def main():\n#     print(42)',
 '/* # Heading\n- [link](somewhere) */',
 '// const value = () => console.log(42);', '/* package main\nfunc main() { fmt.Println(42) } */',
 '-- SELECT name FROM users WHERE id = 1;',
 '<!-- <html><body>Hello</body></html> -->',
 '<!--\n<!doctype html>\n<html><body>Hello</body></html>\n-->',
 '-- SELECT name FROM users\n-- WHERE id = 1;',
 'echo the work is done', 'echo then we are done', 'printf the work is done',
 'This is a long ordinary paragraph about Python and JavaScript.',
 corpus.python + '\n' + corpus.go]) assert.equal(context.detect(content).id, 'plain', content);
assert.notEqual(context.detect('{name: "Ada", count: 42}').id, 'json');
assert.equal(context.detect('-- SELECT name FROM users WHERE id = 1;\n' + corpus.python).id, 'python');
assert.equal(context.detect('<!-- <html><body>Hello</body></html> -->\n' + corpus.go).id, 'go');
assert.equal(context.detect('if [ -n "$HOME" ]; then\n echo "$HOME"\nfi').id, 'shell');
let state = context.advance(null, corpus.python);
state = context.advance(state, corpus.go);
assert.equal(state.current.id, 'python');
state = context.advance(state, corpus.go); // reload cannot manufacture evidence
assert.equal(state.current.id, 'python');
state = context.advance(state, corpus.go + '\n// edit');
assert.equal(state.current.id, 'go');
state = context.advance(state, '');
assert.equal(state.current.id, 'plain');
state = context.advance(state, ' ');
assert.equal(state.current.id, 'plain');
for (const empty of ['', ' \n\t ']) {
 let deleted = context.advance(null, corpus.python);
 for (let refresh = 0; refresh < 5; refresh++) {
  deleted = context.advance(deleted, empty);
  assert.equal(deleted.current.id, 'plain');
  assert.equal(deleted.current.confidence, 0);
  assert.equal(deleted.pending, null);
  assert.equal(deleted.repeats, 0);
 }
}
assert.equal(context.detect('x'.repeat(1000000)).id, 'plain');
console.log('Language corpus, ambiguity, bounded deterministic scores and hysteresis passed.');

// Ambiguous cross-language grammar must not be resolved by ordering the rules.
for (const pair of [['c','cpp'], ['java','kotlin'], ['javascript','typescript']]) {
 const mixed = corpus[pair[0]] + '\n' + corpus[pair[1]];
 assert.equal(context.detect(mixed).id, 'plain', pair.join('/'));
}
assert.equal(context.detect('const data = {"name":"Ada", "count":42};\nconsole.log(data);').id, 'javascript');
for (const value of [' '.repeat(32768), 'a'.repeat(32768), ('a '.repeat(16000)) + '{'])
 assert.equal(context.detect(value).id, 'plain');
let alternating = context.advance(null, corpus.python);
for (let i=0; i<20; i++) {
 alternating = context.advance(alternating, i % 2 ? corpus.python : corpus.go);
 assert.equal(alternating.current.id, 'python');
}

// Pinned native reference MIME catalogue; executable script MIME variants excluded.
const mimes = ['text/plain','text/x-python','text/javascript','application/typescript',
 'application/json','text/x-sh','text/x-csrc','text/x-c++src','text/x-java','text/x-kotlin',
 'text/x-swift','text/x-rustsrc','text/x-go','text/x-yaml','text/x-sql','text/html',
 'text/css','text/x-markdown','text/x-dockerfile'];
assert.deepEqual(Array.from(context.languages, row => row[2]), mimes);
assert.equal(new Set(Array.from(context.languages, row => row[0])).size, 19);
