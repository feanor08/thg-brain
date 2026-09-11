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
        this.$languagePicker.prop('disabled', true);
        try {
            // Public frontend bridge to transactional BNote label methods. No content/type/MIME writes.
            await api.runOnBackend((noteId, language) => {
                const target = api.getNote(noteId);
                if (!target || target.type !== 'code' || target.isProtected ||
                    target.getOwnedLabelValue('thgSublimeOwner') != null) throw new Error('Unsupported note');
                const name = 'thgSublimeLanguage';
                target.removeLabel(name);
                if (language) target.setLabel(name, language);
            }, [note.noteId, id]);
            await api.reloadNotes([note.noteId]);
            this.states.delete(note.noteId);
            if (!this.disposed && this.activeNote?.noteId === note.noteId) await this.refreshWithNote(await api.getNote(note.noteId));
        } catch (_) {
            if (!this.disposed && this.activeNote?.noteId === note.noteId)
                this.$language.text('Language lock not saved — check scripting/access');
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
