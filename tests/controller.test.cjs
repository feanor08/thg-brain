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
        prop(key, value) { this[key] = value; return this; }
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
        location: { origin: "https://fixture.invalid" },
        glob: { baseApiUrl: "/lore/api/", csrfToken: "FIXTURE_CSRF" },
        localStorage: {
            getItem(key) { if (denied) throw Error('denied'); return store.get(key) ?? null; },
            setItem(key, value) { if (denied) throw Error('denied'); store.set(key, value); }
        },
        addEventListener(key, cb) { listeners.set(key, cb); },
        removeEventListener(key, cb) { assert.equal(listeners.get(key), cb); listeners.delete(key); }
    };
    const document = { baseURI: "https://fixture.invalid/lore/", documentElement: {
        setAttribute(key, val) { attrs.set(key, val); },
        removeAttribute(key) { attrs.delete(key); }
    }};
    const scriptApi = { NoteContextAwareWidget: Base };
    const timers = new Map();
    let timerId = 0;
    const transport = { fetch: async () => { throw Error("Unexpected transport"); } };
    const context = vm.createContext({ api: scriptApi, URL, AbortSignal,
        fetch: (...args) => transport.fetch(...args),
        setTimeout(cb) { timers.set(++timerId, cb); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        $: html => new Element(html), window, document, module: { exports: {} } });
    new vm.Script(source, { filename: 'packaged-controller.js' }).runInContext(context, { timeout: 1000 });
    const widget = context.module.exports;
    // A frozen note catches attempted type/MIME/language mutations during switches.
    widget.note = Object.freeze({ type: 'code', mime: 'text/x-python', noteId: 'knowledge' });
    widget.doRender();
    return { widget, store, attrs, listeners, scriptApi, timers, transport, window };
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
    // Backend scripting stays disabled; exercise native requests against a separate durable store.
    const h = harness();
    let content = 'import os\ndef main():\n    print(os.getcwd())';
    const labels = new Map();
    const makeNote = () => Object.freeze({ noteId: 'per-note', type: 'code', mime: 'text/plain',
        title: 'example', getContent: async () => content,
        getOwnedLabelValue: name => labels.get(name),
        getOwnedLabels: name => labels.has(name) ? [{attributeId: 'lock-id', value: labels.get(name), isInheritable: false}] : [] });
    let attributeWrites = 0;
    h.scriptApi.runOnBackend = async () => { throw Error('Backend scripting disabled'); };
    h.transport.fetch = async (url, options) => {
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.mode, 'same-origin');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers['x-csrf-token'], 'FIXTURE_CSRF');
        assert.equal(options.headers.Authorization, undefined);
        assert.ok(options.signal instanceof AbortSignal);
        if (options.method === 'PUT') {
            assert.equal(url, 'https://fixture.invalid/lore/api/notes/per-note/set-attribute');
            const body = JSON.parse(options.body);
            assert.deepEqual(Object.keys(body).sort(), ['isInheritable', 'name', 'type', 'value']);
            assert.equal(body.name, 'thgSublimeLanguage');
            assert.equal(body.type, 'label');
            assert.equal(body.isInheritable, false);
            labels.set(body.name, body.value);
        } else {
            assert.equal(options.method, 'DELETE');
            assert.equal(url, 'https://fixture.invalid/lore/api/notes/per-note/attributes/lock-id');
            assert.equal(options.body, undefined);
            labels.delete('thgSublimeLanguage');
        }
        attributeWrites++;
        return {ok: true};
    };
    h.scriptApi.reloadNotes = async () => {};
    h.scriptApi.getNote = async () => makeNote();
    h.widget.note = makeNote();
    await h.widget.refreshWithNote(h.widget.note);
    assert.match(h.widget.$language.textContent, /Python.*Unlocked/);
    const original = content;
    await h.widget.setLanguageLock('rust');
    assert.equal(labels.get('thgSublimeLanguage'), 'rust');
    assert.match(h.widget.$language.textContent, /Rust · Locked/);
    assert.equal(content, original);
    assert.equal(h.widget.note.mime, 'text/plain');
    const reopened = harness();
    await reopened.widget.refreshWithNote(makeNote());
    assert.match(reopened.widget.$language.textContent, /Rust · Locked/);
    await h.widget.refreshWithNote(Object.freeze({ ...makeNote(), noteId: 'other', getOwnedLabelValue: () => null }));
    assert.match(h.widget.$language.textContent, /Python.*Unlocked/);
    await h.widget.refreshWithNote(makeNote());
    await h.widget.setLanguageLock('');
    assert.equal(labels.size, 0);
    assert.match(h.widget.$language.textContent, /Python.*Unlocked/);
    const writes = attributeWrites;
    await h.widget.refreshWithNote({ ...makeNote(), type: 'text' });
    await h.widget.setLanguageLock('python');
    assert.equal(attributeWrites, writes);
    assert.match(h.widget.$language.textContent, /Unknown/);
    await h.widget.refreshWithNote(makeNote());
    const workingTransport = h.transport.fetch;
    h.transport.fetch = async () => ({ok: false, status: 403});
    await h.widget.setLanguageLock('go');
    assert.match(h.widget.$language.textContent, /not confirmed/);
    assert.equal(labels.size, 0);
    // No retries on HTTP/auth/timeout failures; no leakage to another origin.
    for (const failure of [async () => ({ok:false, status:401}),
        async () => { throw Error('timeout'); }, async () => { throw Error('redirect'); }]) {
        let requests = 0;
        h.transport.fetch = async (...args) => { requests++; return failure(...args); };
        await h.widget.setLanguageLock('go');
        assert.equal(requests, 1);
        assert.match(h.widget.$language.textContent, /not confirmed/);
        assert.equal(labels.size, 0);
    }
    h.transport.fetch = workingTransport;
    for (const base of ['https://other.invalid/api/', '/etapi/', '/lore/api/?token=x', '/lore/api/#x']) {
        h.window.glob.baseApiUrl = base;
        const before = attributeWrites;
        await h.widget.setLanguageLock('go');
        assert.equal(attributeWrites, before);
        assert.match(h.widget.$language.textContent, /not confirmed/);
    }
    h.window.glob.baseApiUrl = '/lore/api/';
    h.window.glob.csrfToken = '';
    await h.widget.setLanguageLock('go');
    assert.equal(labels.size, 0);
    h.window.glob.csrfToken = 'FIXTURE_CSRF';
    // Refresh must recheck changed type/protection before any mutation.
    for (const changed of [{type:'text'}, {isProtected:true}]) {
        h.scriptApi.getNote = async () => ({...makeNote(), ...changed});
        await h.widget.setLanguageLock('go');
        assert.equal(labels.size, 0);
        assert.match(h.widget.$language.textContent, /not confirmed/);
    }
    h.scriptApi.getNote = async () => makeNote();
    // Native set-attribute cannot repair inheritance or duplicates: explicit clear required.
    for (const locks of [[{attributeId:'lock-id', isInheritable:true}],
        [{attributeId:'lock-id'}, {attributeId:'second-id'}]]) {
        h.scriptApi.getNote = async () => ({...makeNote(), getOwnedLabels: () => locks});
        const before = attributeWrites;
        await h.widget.setLanguageLock('go');
        assert.equal(attributeWrites, before);
        assert.match(h.widget.$language.textContent, /not confirmed/);
    }
    h.scriptApi.getNote = async () => makeNote();
    // Failed replacement must retain the previous durable override.
    labels.set('thgSublimeLanguage', 'rust');
    h.transport.fetch = async () => ({ok:false, status:403});
    await h.widget.setLanguageLock('go');
    assert.equal(labels.get('thgSublimeLanguage'), 'rust');
    await h.widget.refreshWithNote(makeNote());
    assert.match(h.widget.$language.textContent, /Rust · Locked/);
    // Clear removes all and only owned lock IDs, including malformed duplicates.
    const attributes = [
        {attributeId:'first', name:'thgSublimeLanguage'},
        {attributeId:'second', name:'thgSublimeLanguage', isInheritable:true},
        {attributeId:'unrelated', name:'other'}
    ];
    h.scriptApi.getNote = async () => ({...makeNote(), getOwnedLabels: name =>
        attributes.filter(attr => attr.name === name)});
    const deleted = [];
    h.transport.fetch = async (url, options) => {
        assert.equal(options.method, 'DELETE');
        const id = url.split('/').pop(); deleted.push(id);
        const index = attributes.findIndex(attr => attr.attributeId === id);
        assert.ok(index >= 0); attributes.splice(index, 1);
        labels.delete('thgSublimeLanguage');
        return {ok:true};
    };
    await h.widget.setLanguageLock('');
    assert.deepEqual(deleted, ['first', 'second']);
    assert.deepEqual(attributes, [{attributeId:'unrelated', name:'other'}]);
    h.scriptApi.getNote = async () => makeNote();
    h.transport.fetch = workingTransport;
    labels.set('thgSublimeLanguage', 'invalid');
    await h.widget.refreshWithNote(makeNote());
    assert.match(h.widget.$language.textContent, /Invalid language lock/);
    assert.equal(h.widget.$languagePicker.val(), 'invalid-lock');
    h.transport.fetch = workingTransport;
    h.widget.$languagePicker.val('');
    await h.widget.$languagePicker.handlers.get('change')();
    assert.equal(labels.has('thgSublimeLanguage'), false);
    assert.match(h.widget.$language.textContent, /Python.*Unlocked/);
    assert.equal(content, original);
    await h.widget.setLanguageLock('rust');
    content = '';
    await h.widget.refreshWithNote(makeNote());
    assert.match(h.widget.$language.textContent, /Rust · Locked/);
    await h.widget.setLanguageLock('');
    for (let refresh = 0; refresh < 5; refresh++) {
        await h.widget.refreshWithNote(makeNote());
        assert.equal(h.widget.$language.textContent, 'Plain Text / Unknown · 0% · Unlocked');
    }
    content = original;
    await h.widget.refreshWithNote(makeNote());
    content = original + '\n';
    await h.widget.refreshWithNote(makeNote());
    assert.match(h.widget.$language.textContent, /Python.*Unlocked/);
    content = 'x';
    for (let refresh = 0; refresh < 5; refresh++) {
        await h.widget.refreshWithNote(makeNote());
        assert.equal(h.widget.$language.textContent, 'Plain Text / Unknown · 0% · Unlocked');
    }
    await reopened.widget.refreshWithNote(makeNote());
    assert.equal(reopened.widget.$language.textContent, 'Plain Text / Unknown · 0% · Unlocked');
    await h.widget.setLanguageLock('python');
    await h.widget.refreshWithNote(makeNote());
    assert.match(h.widget.$language.textContent, /Python · Locked/);
    await h.widget.setLanguageLock('');
    assert.equal(h.widget.$language.textContent, 'Plain Text / Unknown · 0% · Unlocked');
    assert.equal(content, 'x');
    content = original;
    let resolveContent;
    const pending = h.widget.refreshWithNote({ ...makeNote(), getContent: () => new Promise(resolve => { resolveContent = resolve; }) });
    await h.widget.refreshWithNote(null);
    resolveContent(original);
    await pending;
    assert.match(h.widget.$language.textContent, /Unknown/);
    await h.widget.refreshWithNote(makeNote());
    for (let i = 0; i < 50; i++) h.widget.entitiesReloadedEvent({ loadResults: {
        isNoteReloaded: () => false, isNoteContentReloaded: () => true } });
    assert.equal(h.timers.size, 1);
    h.timers.clear();
    labels.set('thgSublimeLanguage', 'swift');
    h.widget.entitiesReloadedEvent({ loadResults: {
        isNoteReloaded: () => false, isNoteContentReloaded: () => false,
        getAttributeRows: () => [{ noteId: 'per-note' }] } });
    assert.equal(h.timers.size, 1);
    const refreshRemoteLock = [...h.timers.values()][0];
    h.timers.clear();
    await refreshRemoteLock();
    assert.match(h.widget.$language.textContent, /Swift · Locked/);
    h.widget.entitiesReloadedEvent({ loadResults: {
        isNoteReloaded: () => false, isNoteContentReloaded: () => false,
        getAttributeRows: () => [{ noteId: 'unrelated' }] } });
    assert.equal(h.timers.size, 0);
    await h.widget.refreshWithNote({ ...makeNote(), isProtected: true });
    assert.equal(h.widget.$languagePicker.disabled, true);
    const protectedWrites = attributeWrites;
    await h.widget.setLanguageLock('python');
    assert.equal(attributeWrites, protectedWrites);
    // Real deployed fixture metadata, followed by Python ETAPI update/disable.
    if (process.argv[3]) {
        const deployed = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        for (const record of Object.values(deployed).filter(n => n.type === 'code')) {
            const getOwnedLabelValue = name => record.attributes.find(a => a.name === name)?.value;
            const frontend = { ...record, getOwnedLabelValue, getContent: async () => record.content };
            let calls = 0;
            h.transport.fetch = async () => { calls++; throw Error('Unexpected managed write'); };
            h.scriptApi.getNote = async () => frontend;
            await h.widget.refreshWithNote(frontend);
            assert.equal(h.widget.$languagePicker.disabled, true);
            for (const id of ['python', '']) await h.widget.setLanguageLock(id);
            assert.equal(calls, 0, 'Managed note must be blocked before native request');
            // Stale frontend cache lacks marker: fresh metadata must refuse before a request.
            await h.widget.refreshWithNote({ ...frontend, getOwnedLabelValue: () => null });
            await h.widget.setLanguageLock('rust');
            assert.equal(calls, 0);
            assert.match(h.widget.$language.textContent, /not confirmed/);
            assert.equal(getOwnedLabelValue('thgSublimeLanguage'), undefined);
        }
        fs.writeFileSync(process.argv[3], JSON.stringify(deployed));
    }
    for (const owner of ['', 'foreign-owner', 'thg-sublime-phase1-v1']) {
        await h.widget.refreshWithNote({ ...makeNote(), getOwnedLabelValue: name =>
            name === 'thgSublimeOwner' ? owner : null });
        assert.equal(h.widget.$languagePicker.disabled, true);
        await h.widget.setLanguageLock('python');
        assert.equal(attributeWrites, protectedWrites);
    }
    h.widget.cleanup();
    assert.equal(h.timers.size, 0);
    reopened.widget.cleanup();
    console.log(`Controller: nine schemes, persistence/fallback, events, lifecycle, no note mutation passed (${elapsed.toFixed(1)}ms harness time).`);
})().catch(error => { console.error(error); process.exit(1); });
