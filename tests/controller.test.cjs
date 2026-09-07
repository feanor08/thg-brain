/* Dependency-free contract harness: executes the exact packaged widget, not a copy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const notes = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const source = notes.find(n => n.key === 'controller').content;
const expected = ['materialize', 'spacegray', 'soda-dark', 'soda-light', 'guna', 'mariana',
    'cyberpunk-umbra', 'cyberpunk-scarlet', 'thg-sublime'];
const storageKey = 'thg.sublime.phase1.theme.v1';

function harness(saved, denied = false) {
    const store = new Map(saved === undefined ? [] : [[storageKey, saved]]);
    const attrs = new Map();
    const listeners = new Map();
    class Element {
        constructor(html) { this.html = html; this.children = []; this.handlers = new Map(); }
        text(value) { this.textContent = value; return this; }
        val(value) { if (arguments.length) { this.value = value; return this; } return this.value; }
        append(...children) { this.children.push(...children); return this; }
        on(event, cb) { this.handlers.set(event, cb); return this; }
        off(event) { this.handlers.delete(event); return this; }
    }
    class Base {
        contentSized() { this.sized = true; }
        cleanup() { this.cleaned = true; }
    }
    const window = {
        localStorage: {
            getItem(key) { if (denied) throw Error('denied'); return store.get(key) ?? null; },
            setItem(key, value) { if (denied) throw Error('denied'); store.set(key, value); }
        },
        addEventListener(key, cb) { listeners.set(key, cb); },
        removeEventListener(key, cb) { assert.equal(listeners.get(key), cb); listeners.delete(key); }
    };
    const document = { documentElement: {
        setAttribute(key, val) { attrs.set(key, val); },
        removeAttribute(key) { attrs.delete(key); }
    }};
    const context = vm.createContext({ api: { NoteContextAwareWidget: Base },
        $: html => new Element(html), window, document, module: { exports: {} } });
    new vm.Script(source, { filename: 'packaged-controller.js' }).runInContext(context, { timeout: 1000 });
    const widget = context.module.exports;
    // A frozen note catches attempted type/MIME/language mutations during switches.
    widget.note = Object.freeze({ type: 'code', mime: 'text/x-python', noteId: 'knowledge' });
    widget.doRender();
    return { widget, store, attrs, listeners };
}

(async () => {
    const { widget, store, attrs, listeners } = harness();
    assert.equal(widget.parentWidget, 'center-pane');
    assert.equal(widget.position, 10000);
    assert.equal(widget.sized, true);
    assert.equal(widget.isEnabled(), true);
    assert.match(widget.$widget.html, /aria-label/);
    assert.match(widget.$picker.html, /aria-label/);
    assert.deepEqual(widget.$picker.children.map(n => n.value), expected);
    assert.equal(attrs.get('data-thg-sublime'), 'thg-sublime');
    assert.equal(widget.$kind.textContent, 'Type: code');
    const start = performance.now();
    for (const id of expected) {
        widget.$picker.val(id);
        widget.$picker.handlers.get('change')();
        assert.equal(attrs.get('data-thg-sublime'), id);
        assert.equal(store.get(storageKey), id);
        assert.equal(harness(store.get(storageKey)).attrs.get('data-thg-sublime'), id);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 200, `Controller round-trip took ${elapsed}ms (not a pixel timing test)`);
    for (const invalid of [null, '', 'broken', '__proto__', 'toString', {}, 4]) {
        widget.applyTheme(invalid, true);
        assert.equal(attrs.get('data-thg-sublime'), 'thg-sublime');
    }
    assert.equal(harness('broken').attrs.get('data-thg-sublime'), 'thg-sublime');
    assert.equal(harness('mariana', true).attrs.get('data-thg-sublime'), 'thg-sublime');
    const blocked = harness(null, true);
    blocked.widget.applyTheme('soda-light', true);
    assert.equal(blocked.attrs.get('data-thg-sublime'), 'soda-light');
    listeners.get('storage')({ key: storageKey, newValue: 'mariana' });
    assert.equal(attrs.get('data-thg-sublime'), 'mariana');
    listeners.get('storage')({ key: 'unrelated', newValue: 'soda-dark' });
    assert.equal(attrs.get('data-thg-sublime'), 'mariana');
    listeners.get('storage')({ key: null, newValue: null });
    assert.equal(attrs.get('data-thg-sublime'), 'thg-sublime');
    await widget.refreshWithNote({ type: '<script>literal</script>' });
    assert.equal(widget.$kind.textContent, 'Type: <script>literal</script>');
    await widget.refreshWithNote(null);
    assert.equal(widget.$kind.textContent, 'No active note');
    assert.equal(widget.note.type, 'code');
    assert.equal(widget.note.mime, 'text/x-python');
    widget.cleanup();
    assert.equal(widget.cleaned, true);
    assert.equal(listeners.size, 0);
    assert.equal(widget.$picker.handlers.size, 0);
    assert.equal(attrs.size, 0);
    // No timers, editor global or note-writing API is supplied: accessing one fails execution.
    console.log(`Controller: nine schemes, persistence/fallback, events, lifecycle, no note mutation passed (${elapsed.toFixed(1)}ms harness time).`);
})().catch(error => { console.error(error); process.exit(1); });
