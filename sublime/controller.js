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

// Native v0.104.1 session transport; see docs/CLDS-0047-REVIEW.md.
async function thgRequest(noteId, suffix, method, body) {
    const config = window.glob;
    const base = new URL(config?.baseApiUrl, document.baseURI);
    if (!config?.baseApiUrl || !config.csrfToken ||
        base.origin !== window.location.origin || !/^https?:$/.test(base.protocol) ||
        base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/api/'))
        throw new Error('Unsupported frontend transport');
    if (!/^[a-zA-Z0-9_-]+$/.test(noteId)) throw new Error('Invalid metadata identifier');
    const response = await fetch(new URL(`notes/${noteId}/${suffix}`, base).href, {
        method, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': config.csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    // Never log response bodies or retry an uncertain write.
    if (!response.ok) throw new Error('Metadata request failed');
    if (method === 'GET') return response.json();
}
async function thgWriteAttribute(noteId, attributeId, language) {
    if (attributeId !== null && !/^[a-zA-Z0-9_-]+$/.test(attributeId))
        throw new Error('Invalid metadata identifier');
    return thgRequest(noteId, attributeId === null ? 'set-attribute' : `attributes/${attributeId}`,
        attributeId === null ? 'PUT' : 'DELETE', attributeId === null ? {
            type: 'label', name: 'thgSublimeLanguage', value: language, isInheritable: false
        } : undefined);
}
function thgEligible(note) {
    return note?.type === 'code' && !note.isProtected && !thgManagedNote(note) &&
        typeof note.getContent === 'function' && typeof note.getOwnedLabels === 'function';
}
function thgLanguage(id) { return THG_LANGUAGES.find(language => language[0] === id); }
function thgHighlightName(mime) {
    const language = THG_LANGUAGES.find(language => language[2] === mime);
    return language?.[0] === 'plain' ? 'Plain text' : language?.[1] || 'Other language';
}
// Shared by widget instances. A session marker survives reload/reopen after uncertain writes.
// Contains only note identifiers and a boolean; never content or authentication data.
const THG_WRITING = new Set();
const THG_UNCONFIRMED = new Set();
function thgUnconfirmed(noteId, value) {
    const key = `thg.sublime.unconfirmed.${noteId}`;
    if (value !== undefined) {
        if (value) THG_UNCONFIRMED.add(noteId); else THG_UNCONFIRMED.delete(noteId);
        try {
            if (value) window.sessionStorage.setItem(key, '1'); else window.sessionStorage.removeItem(key);
        } catch (_) { /* In-memory guard remains when storage is unavailable. */ }
    }
    try { return THG_UNCONFIRMED.has(noteId) || window.sessionStorage.getItem(key) === '1'; }
    catch (_) { return THG_UNCONFIRMED.has(noteId); }
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
        const help = 'Auto detects from code content. Manual overrides it until Auto is selected again. Language controls syntax highlighting and never rewrites code. Scores measure heuristic evidence.';
        this.$language = $('<span aria-live="polite"></span>').prop('title', help);
        this.$highlighting = $('<span aria-live="polite"></span>');
        this.$languagePicker = $('<select aria-label="Language mode and syntax highlighting"></select>');
        this.$languagePicker.prop('title', help);
        this.$languagePicker.append($('<option></option>').val('').text('Auto-detect language'));
        this.$languagePicker.append($('<option></option>').val('invalid-lock').text('Invalid override — choose Auto').prop('disabled', true));
        for (const [id, name] of THG_LANGUAGES) {
            this.$languagePicker.append($('<option></option>').val(id).text(name).prop('title', 'Manual override until Auto is selected again'));
        }
        this.$languagePicker.append($('<option></option>').val('retry-language').text('Choose language to retry').prop('disabled', true));
        this.$languagePicker.on("change", () => this.setLanguageLock(this.$languagePicker.val()));
        this.$widget.append(this.$kind, this.$language, this.$languagePicker, this.$highlighting, $info, this.$picker);
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

    current(generation, noteId) {
        return !this.disposed && generation === this.generation && this.activeNote?.noteId === noteId;
    }

    async authoritative(noteId, generation) {
        if (!this.current(generation, noteId)) throw new Error('Navigation changed');
        await api.reloadNotes([noteId]);
        const note = await api.getNote(noteId);
        if (!this.current(generation, noteId) || note?.noteId !== noteId || !thgEligible(note)) throw new Error('Unavailable note');
        // froca merges attributes on reload; deleted rows can remain cached until sync.
        const attributes = await thgRequest(noteId, 'attributes', 'GET');
        if (!Array.isArray(attributes) || !this.current(generation, noteId)) throw new Error('Unavailable metadata');
        const owned = name => attributes.filter(a => a.noteId === noteId && a.type === 'label' && a.name === name);
        const target = Object.create(note);
        Object.defineProperties(target, {
            getOwnedLabels: { value: owned },
            getOwnedLabelValue: { value: name => owned(name)[0]?.value }
        });
        if (!thgEligible(target)) throw new Error('Unavailable note');
        return target;
    }

    async languageState(note) {
        const override = note.getOwnedLabelValue('thgSublimeLanguage');
        if (override != null && !thgLanguage(override)) return { invalid: true };
        if (override) return { id: override, manual: true };
        const content = await note.getContent();
        const sample = typeof content === 'string' ? content.slice(0, 32769) : '';
        const state = thgAdvance(this.states.get(note.noteId), sample, note.title);
        this.states.delete(note.noteId);
        this.states.set(note.noteId, state);
        if (this.states.size > 64) this.states.delete(this.states.keys().next().value);
        return { ...state.current, pending: !!state.pending };
    }

    showLanguage(note, state, error = false, updating = false) {
        const desired = !state.invalid && (state.manual || (state.id !== 'plain' && state.confidence > 0 && !state.pending))
            ? thgLanguage(state.id) : null;
        this.$languagePicker.val(state.invalid ? 'invalid-lock' : state.manual ? state.id : '');
        this.$language.text(state.invalid ? 'Language: Invalid override · choose Auto' :
            `Language: ${state.id === 'plain' && !state.manual ? 'Unknown' : thgLanguage(state.id)[1]} · ${state.manual ? 'Manual' : 'Auto'}${!state.manual && state.confidence ? ` · ${state.confidence}%` : ''}`);
        const actual = thgHighlightName(note.mime);
        this.$highlighting.text(desired ? `Highlighting: ${actual}${note.mime !== desired[2] ? ` → ${thgHighlightName(desired[2])}` : ''}` : 'Highlighting unchanged');
        if (!updating && (error || thgUnconfirmed(note.noteId))) {
            this.$languagePicker.val('retry-language');
            this.$highlighting.text(`${this.$highlighting.text()} · Update not confirmed; choose language to retry`);
        }
        else if (!updating && desired && note.mime !== desired[2] && state.manual)
            this.$highlighting.text(`Highlighting: ${actual} → ${thgHighlightName(desired[2])} · choose language to apply`);
        return desired;
    }

    async refreshWithNote(note) {
        if (this.disposed) return;
        // Own reload events must not cancel or recursively restart a write operation.
        if (this.lockBusy && this.activeNote?.noteId === note?.noteId) return;
        const generation = this.generation = (this.generation || 0) + 1;
        this.activeNote = note;
        if (this.$kind) this.$kind.text(note?.type ? `Type: ${note.type}` : 'No active note');
        if (!this.$language) return;
        this.$language.text('Language: Unknown · Auto');
        this.$highlighting.text('Highlighting unchanged');
        this.$languagePicker.val('').prop('disabled', !thgEligible(note) || this.lockBusy === true);
        if (!thgEligible(note)) return;
        try {
            this.reading = (this.reading || 0) + 1;
            const target = await this.authoritative(note.noteId, generation);
            const state = await this.languageState(target);
            if (!this.current(generation, note.noteId)) return;
            this.activeNote = target;
            const desired = this.showLanguage(target, state);
            // Manual mismatches require explicit intent; reopening never retries partial writes.
            if (desired && !state.manual && target.mime !== desired[2] && !thgUnconfirmed(note.noteId))
                await this.reconcile(target, desired, generation);
        } catch (_) {
            if (this.current(generation, note.noteId)) {
                this.$language.text('Language unavailable');
                this.$highlighting.text('Highlighting update not confirmed');
                this.$languagePicker.prop('disabled', true);
            }
        } finally { this.reading--; this.flushLanguageEvents(); }
    }

    async reconcile(note, desired, generation) {
        if (this.lockBusy || THG_WRITING.has(note.noteId)) return;
        THG_WRITING.add(note.noteId);
        this.lockBusy = true;
        this.$languagePicker.prop('disabled', true);
        try {
            // Recheck ownership, protection, type, mode and evidence immediately before mutation.
            const target = await this.authoritative(note.noteId, generation);
            const state = await this.languageState(target);
            if (!this.current(generation, note.noteId)) throw new Error('Navigation changed');
            if (state.manual || state.invalid || state.pending || !state.confidence || state.id !== desired[0]) return;
            if (target.mime !== desired[2]) {
                thgUnconfirmed(note.noteId, true);
                await thgRequest(note.noteId, 'type', 'PUT', { type: 'code', mime: desired[2] });
                const confirmed = await this.authoritative(note.noteId, generation);
                if (confirmed.mime !== desired[2]) throw new Error('Highlighting not confirmed');
                thgUnconfirmed(note.noteId, false);
                const finalState = await this.languageState(confirmed);
                if (this.current(generation, note.noteId)) this.showLanguage(confirmed, finalState);
            }
        } catch (_) {
            thgUnconfirmed(note.noteId, true);
            await this.recover(note.noteId, generation);
        } finally {
            THG_WRITING.delete(note.noteId);
            this.lockBusy = false;
            this.flushLanguageEvents();
            if (!this.disposed) {
                this.$languagePicker.prop('disabled', !thgEligible(this.activeNote));
                if (generation !== this.generation && thgEligible(this.activeNote))
                    await this.refreshWithNote(this.activeNote);
            }
        }
    }

    async recover(noteId, generation) {
        try {
            const actual = await this.authoritative(noteId, generation);
            const state = await this.languageState(actual);
            if (this.current(generation, noteId)) {
                this.activeNote = actual;
                this.showLanguage(actual, state, true);
            }
        } catch (_) {
            if (this.current(generation, noteId)) {
                this.$language.text('Language unavailable');
                this.$highlighting.text('Highlighting update not confirmed');
            }
        }
    }

    flushLanguageEvents() {
        if (this.disposed || this.lockBusy || this.reading || !this.pendingLanguageEvent) return;
        const id = this.pendingLanguageEvent;
        this.pendingLanguageEvent = null;
        if (this.activeNote?.noteId !== id) return;
        clearTimeout(this.languageTimer);
        this.languageTimer = setTimeout(() => {
            if (!this.disposed && this.activeNote?.noteId === id) return this.refreshWithNote(this.activeNote);
        }, 650);
    }

    entitiesReloadedEvent({ loadResults }) {
        if (this.disposed || !this.activeNote) return;
        const id = this.activeNote.noteId;
        if (!loadResults.isNoteReloaded(id) && !loadResults.isNoteContentReloaded(id) &&
            !loadResults.getAttributeRows().some(row => row.noteId === id)) return;
        this.pendingLanguageEvent = id;
        this.flushLanguageEvents();
    }

    async setLanguageLock(id) {
        const note = this.activeNote;
        if (this.lockBusy || !thgEligible(note) || THG_WRITING.has(note.noteId) || (id && !thgLanguage(id))) return;
        this.lockBusy = true;
        THG_WRITING.add(note.noteId);
        const generation = this.generation = (this.generation || 0) + 1;
        this.$languagePicker.prop('disabled', true);
        try {
            let target = await this.authoritative(note.noteId, generation);
            const locks = target.getOwnedLabels('thgSublimeLanguage');
            thgUnconfirmed(note.noteId, true);
            if (id) {
                if (locks.length > 1 || locks.some(attr => attr.isInheritable)) throw new Error('Malformed override');
                if (locks[0]?.value !== id) {
                    await thgWriteAttribute(note.noteId, null, id);
                    target = await this.authoritative(note.noteId, generation);
                }
                if (target.getOwnedLabelValue('thgSublimeLanguage') !== id) throw new Error('Override not confirmed');
            } else {
                for (const attr of locks) {
                    target = await this.authoritative(note.noteId, generation);
                    if (!target.getOwnedLabels('thgSublimeLanguage').some(a => a.attributeId === attr.attributeId))
                        throw new Error('Override changed');
                    await thgWriteAttribute(note.noteId, attr.attributeId, '');
                    target = await this.authoritative(note.noteId, generation);
                    if (target.getOwnedLabels('thgSublimeLanguage').some(a => a.attributeId === attr.attributeId))
                        throw new Error('Removal not confirmed');
                }
                if (target.getOwnedLabels('thgSublimeLanguage').length) throw new Error('Override remains');
            }
            this.states.delete(note.noteId);
            const state = await this.languageState(target);
            if (!this.current(generation, note.noteId)) throw new Error('Navigation changed');
            const desired = id ? thgLanguage(id) : state.id !== 'plain' && state.confidence > 0 ? thgLanguage(state.id) : null;
            this.showLanguage(target, state, false, true);
            if (desired && target.mime !== desired[2]) {
                target = await this.authoritative(note.noteId, generation);
                if ((target.getOwnedLabelValue('thgSublimeLanguage') || '') !== id) throw new Error('Mode changed');
                if (!id) {
                    const latest = await this.languageState(target);
                    if (latest.pending || !latest.confidence || latest.id !== desired[0]) throw new Error('Evidence changed');
                }
                if (!this.current(generation, note.noteId)) throw new Error('Navigation changed');
                if (target.mime !== desired[2]) {
                    await thgRequest(note.noteId, 'type', 'PUT', { type: 'code', mime: desired[2] });
                    target = await this.authoritative(note.noteId, generation);
                }
                if (target.mime !== desired[2]) throw new Error('Highlighting not confirmed');
            }
            if ((target.getOwnedLabelValue('thgSublimeLanguage') || '') !== id) throw new Error('Mode changed');
            thgUnconfirmed(note.noteId, false);
            this.activeNote = target;
            const finalState = await this.languageState(target);
            if (this.current(generation, note.noteId)) this.showLanguage(target, finalState);
        } catch (_) {
            thgUnconfirmed(note.noteId, true);
            await this.recover(note.noteId, generation);
        } finally {
            THG_WRITING.delete(note.noteId);
            this.lockBusy = false;
            this.flushLanguageEvents();
            if (!this.disposed) {
                this.$languagePicker.prop('disabled', !thgEligible(this.activeNote));
                if (generation !== this.generation && thgEligible(this.activeNote))
                    await this.refreshWithNote(this.activeNote);
            }
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
