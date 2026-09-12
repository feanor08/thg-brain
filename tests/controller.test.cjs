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

function harness(saved, denied = false, sessionStore = new Map()) {
    const store = new Map(saved === undefined ? [] : [[storageKey, saved]]);
    const attrs = new Map();
    const listeners = new Map();
    class Element {
        constructor(html) { this.html = html; this.children = []; this.handlers = new Map(); }
        prop(key, value) { this[key] = value; return this; }
        text(value) { if (!arguments.length) return this.textContent; this.textContent = value; return this; }
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
        sessionStorage: { getItem: key => sessionStore.get(key), setItem: (key,value) => sessionStore.set(key,value), removeItem: key => sessionStore.delete(key) },
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
    return { widget, store, attrs, listeners, scriptApi, timers, transport, window, sessionStore };
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
    // Separate durable server state; only the exact native routes can mutate it.
    function fixture() {
        const h = harness();
        const db = { noteId: 'per-note', type: 'code', mime: 'text/plain', isProtected: false,
            content: 'import os\ndef main():\n    print(os.getcwd())', attributes: [{attributeId:'other', name:'other', value:'keep'}] };
        const snapshot = () => {
            const row = JSON.parse(JSON.stringify(db));
            return Object.freeze({...row, getContent: async () => row.content,
                getOwnedLabelValue: name => row.attributes.find(a => a.name === name)?.value,
                getOwnedLabels: name => row.attributes.filter(a => a.name === name)});
        };
        const writes = [];
        h.scriptApi.reloadNotes = async () => {};
        h.scriptApi.getNote = async () => snapshot();
        h.scriptApi.runOnBackend = async () => { throw Error('Backend scripting disabled'); };
        h.transport.fetch = async (url, options) => {
            assert.equal(options.credentials, 'same-origin');
            assert.equal(options.mode, 'same-origin');
            assert.equal(options.redirect, 'error');
            assert.equal(options.headers['x-csrf-token'], 'FIXTURE_CSRF');
            assert.equal(options.headers.Authorization, undefined);
            assert.ok(options.signal instanceof AbortSignal);
            const body = options.body && JSON.parse(options.body);
            if (options.method === 'GET') {
                if (url.endsWith('/notes/other/attributes')) return {ok:true,json:async()=>[]};
                assert.equal(url, 'https://fixture.invalid/lore/api/notes/per-note/attributes');
                return {ok:true, json:async()=>JSON.parse(JSON.stringify(db.attributes.map(a=>({noteId:db.noteId,type:'label',...a}))))};
            }
            writes.push({url, method: options.method, body});
            if (url.endsWith('/type')) {
                assert.equal(url, 'https://fixture.invalid/lore/api/notes/per-note/type');
                assert.equal(options.method, 'PUT');
                assert.deepEqual(Object.keys(body).sort(), ['mime', 'type']);
                assert.equal(body.type, 'code');
                // Pinned setNoteTypeMime assigns both fields; it does NOT merge a MIME-only body.
                const nativeHandler = require('./fixtures/trilium-0.104.1-type.cjs')({getNoteOrThrow: id => {
                    assert.equal(id, db.noteId);
                    return Object.assign(db, {save() {delete db.save;}});
                }});
                nativeHandler({params:{noteId:db.noteId},body});
            } else if (options.method === 'PUT') {
                assert.equal(url, 'https://fixture.invalid/lore/api/notes/per-note/set-attribute');
                assert.deepEqual(Object.keys(body).sort(), ['isInheritable','name','type','value']);
                assert.equal(body.name, 'thgSublimeLanguage');
                assert.equal(body.type, 'label'); assert.equal(body.isInheritable, false);
                const attr = db.attributes.find(a => a.name === body.name);
                if (attr) attr.value = body.value;
                else db.attributes.push({attributeId:'override', ...body});
            } else {
                assert.equal(options.method, 'DELETE');
                const id = url.split('/').pop();
                assert.equal(url, `https://fixture.invalid/lore/api/notes/per-note/attributes/${id}`);
                assert.equal(body, undefined);
                db.attributes = db.attributes.filter(a => a.attributeId !== id);
            }
            return {ok:true};
        };
        const refresh = async () => { h.widget.note = snapshot(); await h.widget.refreshWithNote(h.widget.note); };
        const override = () => db.attributes.find(a => a.name === 'thgSublimeLanguage')?.value;
        const mimeWrites = () => writes.filter(w => w.url.endsWith('/type')).length;
        return {...h, db, snapshot, writes, refresh, override, mimeWrites};
    }
    const h = fixture();
    const original = h.db.content;
    await h.refresh();
    assert.match(h.widget.$language.textContent, /Language: Python · Auto · 90%/);
    assert.equal(h.widget.$highlighting.textContent, 'Highlighting: Python');
    assert.equal(h.db.mime, 'text/x-python'); assert.equal(h.mimeWrites(), 1);
    for (let i=0; i<5; i++) await h.refresh();
    assert.equal(h.mimeWrites(), 1);
    const autoReopen=harness();
    autoReopen.scriptApi.reloadNotes=h.scriptApi.reloadNotes; autoReopen.scriptApi.getNote=h.scriptApi.getNote;
    autoReopen.transport.fetch=h.transport.fetch;
    await autoReopen.widget.refreshWithNote(h.snapshot());
    assert.equal(h.mimeWrites(),1); assert.equal(h.writes.length,1);
    assert.equal(autoReopen.widget.$highlighting.textContent,'Highlighting: Python');
    autoReopen.widget.cleanup();
    const hysteresis=fixture(); await hysteresis.refresh();
    hysteresis.db.content='package main\nfunc main() { count := 1; fmt.Println(count) }';
    await hysteresis.refresh(); await hysteresis.refresh(); assert.equal(hysteresis.mimeWrites(),1);
    hysteresis.db.content+='\n// distinct edit'; await hysteresis.refresh();
    assert.equal(hysteresis.mimeWrites(),2); assert.equal(hysteresis.db.mime,'text/x-go');
    assert.equal(h.widget.$languagePicker.children[0].textContent, 'Auto-detect language');
    assert.match(h.widget.$languagePicker.html, /Language mode and syntax highlighting/);
    assert.match(h.widget.$languagePicker.title, /never rewrites code/);
    for (const option of h.widget.$languagePicker.children.slice(2, -1)) assert.match(option.title, /Manual override/);
    const languageContext = vm.createContext({});
    vm.runInContext(fs.readFileSync('sublime/language.js','utf8') + ';this.rows=THG_LANGUAGES;', languageContext);
    for (const [id, name, mime] of languageContext.rows) {
        await h.widget.setLanguageLock(id);
        assert.equal(h.override(), id); assert.equal(h.db.mime, mime);
        assert.equal(h.widget.$language.textContent, `Language: ${name} · Manual`);
        assert.doesNotMatch(h.widget.$highlighting.textContent, /confirmed|→/);
        assert.equal(h.db.content, original); assert.equal(h.db.type, 'code');
        const before = h.writes.length;
        await h.refresh(); assert.equal(h.writes.length, before);
    }
    await h.widget.setLanguageLock('rust');
    await h.widget.setLanguageLock('');
    assert.equal(h.override(), undefined); assert.equal(h.db.mime, 'text/x-python');
    assert.deepEqual(h.db.attributes, [{attributeId:'other', name:'other', value:'keep'}]);
    assert.match(h.widget.$language.textContent, /Python · Auto/);
    h.db.content = 'x';
    const beforeUnknown = h.writes.length;
    for (let i=0; i<5; i++) await h.refresh();
    assert.equal(h.writes.length, beforeUnknown); assert.equal(h.db.mime, 'text/x-python');
    assert.equal(h.widget.$language.textContent, 'Language: Unknown · Auto');
    assert.equal(h.widget.$highlighting.textContent, 'Highlighting unchanged');
    await h.widget.setLanguageLock('plain');
    assert.equal(h.db.mime, 'text/plain'); assert.equal(h.db.content, 'x');
    await h.widget.setLanguageLock('');
    assert.equal(h.db.mime, 'text/plain');
    const bytes = fixture();
    bytes.db.content='α café\r\n\t<literal>\u0000'; await bytes.refresh();
    const exact=Buffer.from(bytes.db.content,'utf8');
    for(const id of ['python','rust','plain','']) {
        await bytes.widget.setLanguageLock(id);
        assert.deepEqual(Buffer.from(bytes.db.content,'utf8'),exact);
        assert.equal(bytes.db.type,'code');
    }
    // Every unsafe fresh metadata variant blocks both writes despite stale eligible cache.
    for (const changed of [{type:'text'}, {type:'canvas'}, {type:'file'}, {type:'search'}, {isProtected:true},
        ...['', 'foreign', 'thg-sublime-phase1-v1'].map(value => ({attributes:[{name:'thgSublimeOwner',value}]}))]) {
        const f = fixture(); const stale = f.snapshot(); Object.assign(f.db, changed);
        f.widget.activeNote = stale; await f.widget.setLanguageLock('rust');
        assert.equal(f.writes.length, 0);
        await f.widget.refreshWithNote(stale); assert.equal(f.writes.length, 0);
    }
    // Partial failures: label-only, durable writes followed by lost responses, and failed auth.
    for (const failure of ['label-only', 'label-timeout', 'mime-timeout', 'http', 'csrf', 'timeout', 'unconfirmed']) {
        const f = fixture(); f.db.content = 'x'; await f.refresh();
        const working = f.transport.fetch; let calls = 0;
        f.transport.fetch = async (url, options) => {
            if (options.method === 'GET') return working(url, options);
            calls++;
            if (failure === 'label-only' && url.endsWith('/type')) return {ok:false};
            if (failure === 'label-timeout' && url.endsWith('/set-attribute')) { await working(url,options); throw Error('timeout'); }
            if (failure === 'mime-timeout' && url.endsWith('/type')) { await working(url,options); throw Error('timeout'); }
            if (failure === 'http' || failure === 'csrf') return {ok:false, status:403};
            if (failure === 'timeout') throw Error('timeout');
            if (failure === 'unconfirmed') return {ok:true};
            return working(url, options);
        };
        await f.widget.setLanguageLock('rust');
        assert.match(f.widget.$highlighting.textContent, /not confirmed/i);
        const manual = ['label-only','label-timeout','mime-timeout'].includes(failure);
        assert.equal(f.override(), manual ? 'rust' : undefined);
        assert.match(f.widget.$language.textContent, manual ? /Rust · Manual/ : /Unknown · Auto/);
        assert.equal(f.db.mime, failure === 'mime-timeout' ? 'text/x-rustsrc' : 'text/plain');
        const attempts = calls;
        for (let i=0;i<5;i++) await f.refresh();
        assert.equal(calls, attempts, 'uncertain writes are never retried on refresh');
        const reopened = harness(undefined, false, f.sessionStore);
        reopened.scriptApi.reloadNotes = f.scriptApi.reloadNotes;
        reopened.scriptApi.getNote = f.scriptApi.getNote;
        reopened.transport.fetch = f.transport.fetch;
        await reopened.widget.refreshWithNote(f.snapshot());
        assert.equal(calls, attempts, 'a fresh bundle with session storage must not retry');
        assert.match(reopened.widget.$language.textContent, manual ? /Rust · Manual/ : /Unknown · Auto/);
        assert.match(reopened.widget.$highlighting.textContent, /not confirmed/i);
        assert.equal(reopened.widget.$languagePicker.val(), 'retry-language');
        reopened.widget.cleanup();
        assert.equal(f.db.content, 'x'); assert.equal(f.db.type, 'code');
    }
    // MIME-only durable state with missing override is Auto, including reopening.
    const partial = fixture(); partial.db.mime = 'text/x-rustsrc'; partial.db.content = 'x';
    await partial.refresh(); assert.match(partial.widget.$language.textContent, /Unknown · Auto/);
    assert.equal(partial.writes.length, 0);
    // Auto errors do not loop even with repeated metadata events or new content.
    const failed = fixture(); let attempts = 0;
    const failedTransport = failed.transport.fetch;
    failed.transport.fetch = async (url, options) => {if(options.method === 'GET') return failedTransport(url,options); attempts++; throw Error('timeout');};
    await failed.refresh();
    for (let i=0;i<5;i++) await failed.refresh();
    assert.equal(attempts, 1); assert.match(failed.widget.$highlighting.textContent, /not confirmed/i);
    const fresh = harness(undefined, false, failed.sessionStore);
    fresh.scriptApi.reloadNotes = failed.scriptApi.reloadNotes; fresh.scriptApi.getNote = failed.scriptApi.getNote;
    fresh.transport.fetch = failed.transport.fetch;
    await fresh.widget.refreshWithNote(failed.snapshot()); assert.equal(attempts, 1);
    fresh.widget.cleanup();
    // A concurrent loss of the override after the MIME write must never fabricate Manual.
    const mimeOnly = fixture(); mimeOnly.db.content='x'; await mimeOnly.refresh();
    const commit = mimeOnly.transport.fetch;
    mimeOnly.transport.fetch = async (url,options) => {
        const result = await commit(url,options);
        if (url.endsWith('/type')) {
            mimeOnly.db.attributes = mimeOnly.db.attributes.filter(a=>a.name!=='thgSublimeLanguage');
            throw Error('Lost response after concurrent override removal');
        }
        return result;
    };
    await mimeOnly.widget.setLanguageLock('rust');
    assert.equal(mimeOnly.db.mime,'text/x-rustsrc'); assert.equal(mimeOnly.override(),undefined);
    assert.match(mimeOnly.widget.$language.textContent,/Unknown · Auto/);
    assert.match(mimeOnly.widget.$highlighting.textContent,/not confirmed/i);
    assert.equal(mimeOnly.db.content,'x');
    // Failed authoritative reload cannot leave an optimistic language in the UI.
    const reloadFailure = fixture(); reloadFailure.db.content='x'; await reloadFailure.refresh();
    let reads=0;
    reloadFailure.scriptApi.reloadNotes=async()=>{if(++reads>1) throw Error('offline');};
    await reloadFailure.widget.setLanguageLock('rust');
    assert.equal(reloadFailure.override(),'rust'); assert.equal(reloadFailure.mimeWrites(),0);
    assert.equal(reloadFailure.widget.$language.textContent,'Language unavailable');
    reloadFailure.scriptApi.reloadNotes=async()=>{}; await reloadFailure.refresh();
    assert.match(reloadFailure.widget.$language.textContent,/Rust · Manual/);
    assert.match(reloadFailure.widget.$highlighting.textContent,/Plain text → Rust.*not confirmed/i);
    // Fresh metadata events generated synchronously by our own reload cannot create a loop.
    const events = fixture();
    // Native reloadNotes emits notesReloaded, not entitiesReloaded.
    events.scriptApi.reloadNotes = async () => {};
    await events.refresh();
    assert.equal(events.mimeWrites(), 1); assert.equal(events.timers.size, 0);
    for(let i=0;i<50;i++) events.widget.entitiesReloadedEvent({loadResults:{isNoteReloaded:()=>true}});
    assert.equal(events.timers.size, 1);
    await [...events.timers.values()][0](); events.timers.clear();
    assert.equal(events.mimeWrites(), 1);
    // Native cache merges returned attributes; deletion sync is delivered later.
    const delayed = fixture(); await delayed.refresh(); await delayed.widget.setLanguageLock('rust');
    const cachedRust = delayed.snapshot();
    delayed.scriptApi.getNote = async () => Object.freeze({...delayed.snapshot(),
        getOwnedLabels: cachedRust.getOwnedLabels, getOwnedLabelValue: cachedRust.getOwnedLabelValue});
    await delayed.widget.setLanguageLock('');
    assert.equal(delayed.override(), undefined);
    assert.equal(delayed.db.mime, 'text/x-python');
    assert.match(delayed.widget.$language.textContent, /Python · Auto/);
    assert.doesNotMatch(delayed.widget.$highlighting.textContent, /not confirmed/);
    const converged = delayed.writes.length;
    delayed.scriptApi.getNote = async () => delayed.snapshot();
    delayed.widget.entitiesReloadedEvent({loadResults:{isNoteReloaded:()=>true}});
    const deliver = [...delayed.timers.values()][0]; delayed.timers.clear(); await deliver();
    assert.equal(delayed.writes.length, converged);
    assert.equal(delayed.timers.size, 0);
    assert.equal(delayed.db.content, original);
    // An external edit after the last content snapshot must survive busy/read guards.
    for (const manual of [false, true]) {
        const f = fixture(); f.db.content='x'; await f.refresh();
        let injected=false;
        f.scriptApi.getNote=async()=>{
            const snapshot=f.snapshot();
            return Object.freeze({...snapshot,getContent:async()=>{
                const content=await snapshot.getContent();
                if(!injected) {
                    injected=true;
                    f.db.content=original;
                    f.db.attributes=[];
                    f.widget.entitiesReloadedEvent({loadResults:{isNoteReloaded:()=>false,
                        isNoteContentReloaded:()=>true}});
                }
                return content;
            }});
        };
        if(manual) await f.widget.setLanguageLock(''); else await f.refresh();
        assert.equal(f.timers.size,1);
        const follow=[...f.timers.values()][0]; f.timers.clear(); await follow();
        // Existing hysteresis requires a second distinct Python sample.
        assert.equal(f.widget.states.get(f.db.noteId).pending, 'python');
        f.db.content += '\n# final edit';
        await f.refresh();
        assert.match(f.widget.$language.textContent,/Python · Auto/);
        assert.equal(f.db.mime,'text/x-python');
        assert.equal(f.timers.size,0);
        assert.equal(f.mimeWrites(),1);
    }
    // Guard a navigation while the preflight read is outstanding.
    const race = fixture(); race.widget.activeNote = race.snapshot();
    let release;
    race.scriptApi.reloadNotes = () => new Promise(resolve => {release = resolve;});
    const pending = race.widget.setLanguageLock('rust');
    await race.widget.refreshWithNote(null); release();
    // Recovery checks navigation before attempting another read.
    await pending;
    assert.equal(race.writes.length, 0); assert.equal(race.widget.$language.textContent, 'Language: Unknown · Auto');
    // Navigation/dispose between the two writes stops the second write and preserves durable truth.
    for (const dispose of [false,true]) {
        const f=fixture(); f.db.content='x'; await f.refresh();
        let resolveWrite; const transport=f.transport.fetch;
        f.transport.fetch=async(url,options)=>{await transport(url,options); if(options.method === 'GET') return {ok:true,json:async()=>f.db.attributes.map(a=>({noteId:f.db.noteId,type:'label',...a}))}; await new Promise(r=>{resolveWrite=r;}); return {ok:true};};
        const action=f.widget.setLanguageLock('rust');
        for(let i=0;!resolveWrite && i<100;i++) await Promise.resolve();
        assert.ok(resolveWrite);
        if(dispose) f.widget.cleanup(); else await f.widget.refreshWithNote(null);
        resolveWrite(); await action;
        assert.equal(f.override(),'rust'); assert.equal(f.mimeWrites(),0); assert.equal(f.db.content,'x');
    }
    // A new code note waits for the old write, then performs its own guarded reconciliation.
    const navigation = fixture(); navigation.db.content='x'; await navigation.refresh();
    let finishOld, otherMime='text/plain', otherWrites=0;
    const other=()=>Object.freeze({...navigation.snapshot(),noteId:'other',mime:otherMime,
        getContent:async()=>original,getOwnedLabelValue:()=>undefined,getOwnedLabels:()=>[]});
    navigation.scriptApi.getNote=async id=>id==='other' ? other() : navigation.snapshot();
    const nativeTransport=navigation.transport.fetch;
    navigation.transport.fetch=async(url,options)=>{
        if(url.endsWith('/notes/other/type')) {
            assert.ok(finishOld, 'old request reached transport');
            otherWrites++; otherMime=JSON.parse(options.body).mime; return {ok:true};
        }
        const result=await nativeTransport(url,options);
        if(options.method === 'GET') return result;
        await new Promise(resolve=>{finishOld=resolve;}); return result;
    };
    const oldAction=navigation.widget.setLanguageLock('rust');
    for(let i=0;!finishOld && i<100;i++)await Promise.resolve();
    assert.ok(finishOld);
    await navigation.widget.refreshWithNote(other()); assert.equal(otherWrites,0);
    finishOld(); await oldAction;
    assert.equal(otherWrites,1); assert.equal(otherMime,'text/x-python');
    assert.match(navigation.widget.$language.textContent,/Python · Auto/);
    assert.equal(navigation.db.mime,'text/plain'); assert.equal(navigation.override(),'rust');
    // Wrong-origin, redirected, malformed transport context never produces a write.
    for (const base of ['https://other.invalid/api/', '/etapi/', '/lore/api/?token=x', '/lore/api/#x']) {
        const f = fixture(); f.db.content='x'; await f.refresh(); f.window.glob.baseApiUrl=base;
        await f.widget.setLanguageLock('rust'); assert.equal(f.writes.length,0);
        assert.match(f.widget.$highlighting.textContent,/not confirmed/i);
    }
    for (const locks of [[{attributeId:'a',name:'thgSublimeLanguage',value:'rust',isInheritable:true}],
        ['a','b'].map(attributeId=>({attributeId,name:'thgSublimeLanguage',value:'rust'}))]) {
        const f=fixture(); f.db.attributes.push(...locks); await f.refresh();
        await f.widget.setLanguageLock('go'); assert.equal(f.writes.length,0);
        await f.widget.setLanguageLock(''); assert.equal(f.override(),undefined);
        assert.deepEqual(f.db.attributes,[{attributeId:'other',name:'other',value:'keep'}]);
    }
    if (process.argv[3]) {
        const deployed = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        for (const record of Object.values(deployed).filter(n=>n.type==='code')) {
            const f=fixture(); Object.assign(f.db,record);
            const stale={...f.snapshot(),getOwnedLabelValue:()=>null};
            await f.widget.refreshWithNote(stale); await f.widget.setLanguageLock('rust');
            assert.equal(f.writes.length,0);
        }
        fs.writeFileSync(process.argv[3],JSON.stringify(deployed));
    }
    h.widget.cleanup(); events.widget.cleanup(); assert.equal(events.timers.size,0);
    console.log(`Controller: themes, native MIME/override durability, safety, partial failures and races passed (${elapsed.toFixed(1)}ms theme harness).`);
})().catch(error => { console.error(error); process.exit(1); });
