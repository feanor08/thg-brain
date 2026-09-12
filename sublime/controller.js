/* Packager injects validated, repo-owned theme data; no note content is evaluated. */
const THG_THEMES = /*__THG_THEMES__*/ [];
const THG_DEFAULT = "thg-sublime";
const THG_STORAGE = "thg.sublime.phase1.theme.v1";

function normalizeTheme(value) {
    return THG_THEMES.some(theme => theme.id === value) ? value : THG_DEFAULT;
}

function thgManagedNote(note) {
    // Any owned marker value is reserved, including malformed/foreign ownership.
    return note?.getOwnedLabelValue?.('thgSublimeOwner') != null;
}

// Pinned v0.104.1 native frontend attribute routes (not ETAPI or scripting).
// Only explicit lock actions call this transport; the detector never does.
async function thgWriteAttribute(noteId, attributeId, language) {
    const config = window.glob;
    const base = new URL(config?.baseApiUrl, document.baseURI);
    if (!config?.baseApiUrl || !config.csrfToken ||
        base.origin !== window.location.origin || !/^https?:$/.test(base.protocol) ||
        base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/api/'))
        throw new Error('Unsupported frontend transport');
    if (!/^[a-zA-Z0-9_-]+$/.test(noteId) ||
        (attributeId !== null && !/^[a-zA-Z0-9_-]+$/.test(attributeId)))
        throw new Error('Invalid metadata identifier');
    const path = `notes/${noteId}/` + (attributeId === null ? 'set-attribute' : `attributes/${attributeId}`);
    const response = await fetch(new URL(path, base).href, {
        method: attributeId === null ? 'PUT' : 'DELETE',
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': config.csrfToken },
        ...(attributeId === null ? { body: JSON.stringify({
            type: 'label', name: 'thgSublimeLanguage', value: language, isInheritable: false
        }) } : {})
    });
    // Do not consume/log error bodies or retry writes with an uncertain outcome.
    if (!response.ok) throw new Error('Attribute request failed');
}

class ThgSublimeStatus extends api.NoteContextAwareWidget {
    get parentWidget() { return "center-pane"; }
    get position() { return 10000; }
    isEnabled() { return true; }

    doRender() {
        this.contentSized();
        this.$widget = $('<div class="thg-sublime-status" aria-label="THG Sublime editor status"></div>');
        this.$kind = $('<span></span>').text("No active note");
        const $info = $('<span class="thg-sublime-info" title="Informational defaults; Trilium manages encoding, line endings and indentation."></span>')
            .text("UTF-8 · LF · Spaces: 4");
        this.$picker = $('<select aria-label="THG Sublime theme"></select>');
        for (const theme of THG_THEMES) {
            this.$picker.append($('<option></option>').val(theme.id).text(theme.name));
        }
        this.states = new Map();
        this.$language = $('<span aria-live="polite" title="Heuristic evidence score, not statistical certainty. Language does not change note contents or MIME."></span>');
        this.$languagePicker = $('<select aria-label="THG note language lock"></select>');
        this.$languagePicker.append($('<option></option>').val('').text('Auto (clear lock)'));
        this.$languagePicker.append($('<option></option>').val('invalid-lock').text('Invalid lock — choose Auto').prop('disabled', true));
        for (const [id, name] of THG_LANGUAGES) {
            this.$languagePicker.append($('<option></option>').val(id).text(name));
        }
        this.$languagePicker.on("change", () => this.setLanguageLock(this.$languagePicker.val()));
        this.$widget.append(this.$kind, this.$language, this.$languagePicker, $info, this.$picker);
        this.$picker.on("change", () => this.applyTheme(this.$picker.val(), true));
        let saved;
        try { saved = window.localStorage.getItem(THG_STORAGE); } catch (_) { /* Storage may be denied. */ }
        this.applyTheme(saved, false);
        this.onStorage = event => {
            if (event.key === THG_STORAGE || event.key === null) this.applyTheme(event.newValue, false);
        };
        window.addEventListener("storage", this.onStorage);
        this.refreshWithNote(this.note);
        return this.$widget;
    }

    applyTheme(value, persist) {
        const id = normalizeTheme(value);
        // One synchronous attribute update. No editor APIs, MIME changes or polling.
        document.documentElement.setAttribute("data-thg-sublime", id);
        this.$picker.val(id);
        if (persist) {
            try { window.localStorage.setItem(THG_STORAGE, id); } catch (_) { /* Session-only fallback. */ }
        }
    }

    async refreshWithNote(note) {
        if (this.disposed) return;
        const generation = this.generation = (this.generation || 0) + 1;
        this.activeNote = note;
        if (this.$kind) this.$kind.text(note?.type ? `Type: ${note.type}` : "No active note");
        if (!this.$language) return;
        this.$language.text('Plain Text / Unknown · 0% · Unlocked');
        this.$languagePicker.val('');
        const supported = note?.type === 'code' && !note.isProtected && !thgManagedNote(note) && typeof note.getContent === 'function';
        this.$languagePicker.prop('disabled', !supported || this.lockBusy === true);
        if (!supported) return;
        try {
            const lock = note.getOwnedLabelValue('thgSublimeLanguage');
            if (lock && !THG_LANGUAGES.some(l => l[0] === lock)) {
                this.$language.text('Invalid language lock — clear to detect');
                this.$languagePicker.val('invalid-lock');
                return;
            }
            if (lock) {
                this.$language.text(`${THG_LANGUAGES.find(l => l[0] === lock)[1]} · Locked`);
                this.$languagePicker.val(lock);
                return;
            }
            const content = await note.getContent();
            if (this.disposed || generation !== this.generation) return;
            const sample = typeof content === 'string' ? content.slice(0, 32769) : '';
            const state = thgAdvance(this.states.get(note.noteId), sample, note.title);
            this.states.delete(note.noteId);
            this.states.set(note.noteId, state);
            if (this.states.size > 64) this.states.delete(this.states.keys().next().value);
            const result = state.current;
            this.$language.text(`${result.name} · ${result.confidence}% · Unlocked${state.pending ? ' (held)' : ''}`);
        } catch (_) {
            if (!this.disposed && generation === this.generation) this.$language.text('Language unavailable');
        }
    }

    entitiesReloadedEvent({ loadResults }) {
        if (this.disposed || !this.activeNote) return;
        const id = this.activeNote.noteId;
        if (!loadResults.isNoteReloaded(id) && !loadResults.isNoteContentReloaded(id) &&
            !loadResults.getAttributeRows().some(row => row.noteId === id)) return;
        clearTimeout(this.languageTimer);
        this.languageTimer = setTimeout(() => this.refreshWithNote(this.note), 650);
    }

    async setLanguageLock(id) {
        const note = this.activeNote;
        if (this.lockBusy || !note || note.type !== 'code' || note.isProtected || thgManagedNote(note) ||
            (id && !THG_LANGUAGES.some(l => l[0] === id))) return;
        this.lockBusy = true;
        this.generation = (this.generation || 0) + 1;
        this.$languagePicker.prop('disabled', true);
        try {
            // Refresh before writing: api.getNote alone can return stale cached metadata.
            await api.reloadNotes([note.noteId]);
            const target = await api.getNote(note.noteId);
            if (this.disposed || !target || target.type !== 'code' || target.isProtected || thgManagedNote(target))
                throw new Error('Unsupported note');
            const locks = target.getOwnedLabels('thgSublimeLanguage');
            if (id) {
                // Native set-attribute updates one existing value, not its inheritance.
                // Malformed/duplicate labels must be explicitly cleared first.
                if (locks.length > 1 || locks.some(attr => attr.isInheritable))
                    throw new Error('Clear malformed lock first');
                await thgWriteAttribute(note.noteId, null, id);
            } else {
                for (const attr of locks) {
                    if (this.disposed) throw new Error('Disposed');
                    await thgWriteAttribute(note.noteId, attr.attributeId, '');
                }
            }
            await api.reloadNotes([note.noteId]);
            this.states.delete(note.noteId);
            if (!this.disposed && this.activeNote?.noteId === note.noteId) await this.refreshWithNote(await api.getNote(note.noteId));
        } catch (_) {
            if (!this.disposed && this.activeNote?.noteId === note.noteId)
                this.$language.text('Language lock not confirmed — reload or clear and retry');
        } finally {
            this.lockBusy = false;
            if (!this.disposed) this.$languagePicker.prop('disabled',
                !this.activeNote || this.activeNote.type !== 'code' || !!this.activeNote.isProtected || thgManagedNote(this.activeNote));
        }
    }

    cleanup() {
        this.disposed = true;
        this.generation = (this.generation || 0) + 1;
        if (this.languageTimer) clearTimeout(this.languageTimer);
        if (this.$languagePicker) this.$languagePicker.off("change");
        if (this.states) this.states.clear();
        if (this.onStorage) window.removeEventListener("storage", this.onStorage);
        if (this.$picker) this.$picker.off("change");
        document.documentElement.removeAttribute("data-thg-sublime");
        super.cleanup();
    }
}
module.exports = new ThgSublimeStatus();
