/* Packager injects validated, repo-owned theme data; no note content is evaluated. */
const THG_THEMES = /*__THG_THEMES__*/ [];
const THG_DEFAULT = "thg-sublime";
const THG_STORAGE = "thg.sublime.phase1.theme.v1";

function normalizeTheme(value) {
    return THG_THEMES.some(theme => theme.id === value) ? value : THG_DEFAULT;
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
        this.$widget.append(this.$kind, $info, this.$picker);
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
        if (this.$kind) this.$kind.text(note?.type ? `Type: ${note.type}` : "No active note");
    }

    cleanup() {
        if (this.onStorage) window.removeEventListener("storage", this.onStorage);
        if (this.$picker) this.$picker.off("change");
        document.documentElement.removeAttribute("data-thg-sublime");
        super.cleanup();
    }
}
module.exports = new ThgSublimeStatus();
