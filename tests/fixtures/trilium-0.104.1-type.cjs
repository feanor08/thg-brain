/* TriliumNext/Trilium 744646d07bff459d1db305b1c0a8ea0c99b9c27c
 * packages/trilium-core/src/routes/api/notes.ts, AGPL-3.0-or-later.
 * Unmodified handler body; only Request parameter type erased. */
module.exports = becca => (function setNoteTypeMime(req) {
    // can't use [] destructuring because req.params is not iterable
    const { noteId } = req.params;
    const { type, mime } = req.body;

    const note = becca.getNoteOrThrow(noteId);
    note.type = type;
    note.mime = mime;
    note.save();
});
