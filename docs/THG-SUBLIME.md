# THG Sublime for Trilium — Phase 1

This repository prepares Phase 1: Sublime-inspired typography, desktop density, nine schemes and a bottom theme/status widget using Trilium v0.104.1 supported customization. **Production deployment and visual acceptance are pending. Phases 2–5 remain open.** Scheme names describe original, variable-driven approximations; this package does not redistribute upstream theme packages or fonts.

Run local verification with Python 3.9+, Node 18+ and Chromium (no npm packages):

```sh
scripts/verify.sh
scripts/thg-sublime.sh apply --fixture
```

Verification needs Node 18+ to execute the JavaScript tests. `NODE_BIN=/path/to/node scripts/verify.sh` selects a standalone runtime; an invalid explicit override fails without silently substituting another runtime. Otherwise the resolver checks `node`, then `nodejs` on PATH. If neither is usable, it downloads the official Node **22.16.0** archive for Linux/macOS ARM64/x64 over HTTPS into the ignored workspace-local `.verify-runtime/` directory. The archive SHA-256 must match the platform digest pinned in `scripts/sublime/runtime.py` before any executable is written or run. Only the regular `bin/node` member is copied; npm and other archive paths are not extracted. No system installation or shell configuration changes occur. This pinned runtime is only for local verification, not the deployed product.

For offline/restricted-network hosts, either set `NODE_BIN` or preseed `.verify-runtime/node-v22.16.0-PLATFORM-ARCH.tar.xz` with the matching official archive from `https://nodejs.org/dist/v22.16.0/` (for example, `linux-arm64`). The resolver checks the archive on every run and reconstructs the executable from verified bytes. Removing `.verify-runtime/` removes the disposable runtime; a future run needs network or an explicitly supplied runtime again. Binaries are ignored and must not be included in the review/commit artifact. A missing or incompatible runtime is an error, never a skipped JavaScript suite.

The real-browser editor regression requires installed Google Chrome/Chromium 112+ on Linux or macOS. Discovery checks PATH, then standard macOS system/user Applications bundles (Google Chrome, Chromium and Chrome for Testing), or the existing Linux workspace browser. `CHROMIUM_BIN` overrides discovery and must name the executable, not the `.app` directory; invalid overrides fail explicitly. For example:

```sh
CHROMIUM_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" scripts/verify.sh
```

The runner uses [unified Chrome headless mode](https://developer.chrome.com/docs/automation-and-testing/headless) (`--headless=new`, including older supported Chromium). The offline fixture reports its computed-style result to a temporary server bound only to `127.0.0.1` on an ephemeral port. There is no ETAPI connection, browser download, npm dependency or remote debugging port. An explicit result replaces `--dump-dom` and waiting for Chrome shutdown, which timed out in the previous Mac preflight. Completion has a 45-second deadline; missing results, early exit and incorrect viewport sizes fail. The runner terminates/reaps its own process group and removes the temporary profile/log on success or failure. It never opens the operator's normal browser profile. Linux uses `--no-sandbox` for this disposable offline fixture; macOS keeps Chrome's sandbox.

On this ARM64 workspace Chromium is at `/usr/local/chromium/bin/chrome`; its missing Debian libraries were previously extracted into the ignored `.verify-runtime/browser-libs/` cache, without system installation. Only Linux uses that cache. Restricted execution environments need permission for browser processes and the temporary loopback server. Browser tests fail rather than skip when unavailable. macOS discovery and process handling have automated regression coverage; an actual Mac Chrome run remains an operator preflight requirement, not an asserted result from this Linux workspace.

Tests execute the packaged controller in a minimal DOM/widget contract harness and reconcile an in-memory ETAPI fixture, including second apply, disable/re-enable, partial update recovery and ownership conflicts. They check palette contrast (4.5:1 body/muted/accent text), module/breakpoint structure, baseline assets and Python/shell/JS syntax. The browser suite checks computed styles of real highlighted spans, native and drawn selections, active lines, gutters and carets for independently selected fixture light/dark editor palettes under all nine THG schemes plus invalid-value fallback, focused/unfocused and desktop/narrow layouts. It also proves the old partial recoloring fails. These are representative CM6 DOM/palette fixtures, not a running Trilium/CodeMirror instance. They do not emulate the whole Trilium browser or prove painted pixels, typing feel, live ETAPI interoperability or <200ms visible switching.

## Supported extension design

The source was inspected at the immutable [Trilium v0.104.1 tag](https://github.com/TriliumNext/Trilium/tree/v0.104.1). Relevant implementation contracts:

- [`desktop_layout.tsx`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/client/src/layouts/desktop_layout.tsx): `center-pane` is a vertical container whose custom widgets follow the split-note container. The status bar participates in flex layout, not a fixed overlay. Native split controls remain reachable.
- [`note_context_aware_widget.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/client/src/widgets/note_context_aware_widget.ts), [`basic_widget.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/client/src/widgets/basic_widget.ts), [`bundle.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/client/src/services/bundle.ts): `api.NoteContextAwareWidget`, `doRender`, `refreshWithNote`, `cleanup`, `parentWidget`, `position`, `contentSized()` and an exported instance. Events update the active type without DOM polling or editor monkey-patching.
- [`bootstrap_utils.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/packages/trilium-core/src/services/bootstrap_utils.ts): `#appCss` supplies application CSS on frontend load. Eight `code` / `text/css` notes hold seven source modules and generated palette definitions. One `code` / `application/javascript;env=frontend` note with `#widget` holds the bundled controller. Labels are owned and non-inheritable. No backend script, custom endpoint or core patch is needed.
- [`tab_row.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/client/src/widgets/tab_row.ts) and [`tree.css`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/client/src/stylesheets/tree.css): selectors use `.note-tab[active]`, `.note-tab-wrapper`, `.fancytree-node` and `.ui-fancytree`. Native tab width/position calculations and drag handles remain in control. Tree hierarchy still has visible indentation.
- [`notes.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/server/src/etapi/notes.ts), [`attributes.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/server/src/etapi/attributes.ts), [`mappers.ts`](https://github.com/TriliumNext/Trilium/blob/v0.104.1/apps/server/src/etapi/mappers.ts): create-note supports caller-specified note IDs; attributes require IDs; content uses PUT; note reads include owned/inherited attributes and parent IDs. The global attribute GET is checked as well as note markers because attribute creation can upsert an existing ID. Deleted activation IDs can be recreated through the same supported endpoint.

Source modules live in `sublime/styles/`; `sublime/themes.json` separates `ui`, `editor` and reserved `syntax` tokens. `scripts/sublime/package.py` validates and deterministically packages them, retaining separate CSS notes. The status controller is in `sublime/controller.js`. No generated bundle needs to be checked into Git. No theme note with `#appTheme` is needed: the app CSS/controller pair owns the nine-scheme switcher, avoiding changes to Trilium's native theme setting or note language.

Default is **THG Sublime**. Other options: Materialize, Spacegray, Soda Dark, Soda Light, Guna, Mariana, Cyberpunk Umbra and Cyberpunk Scarlet. Neon colors are accents, with neutral body text. Phase 1 preserves the complete native CodeMirror palette, including its background, explicitly colored syntax spans, selections, active lines, gutters and caret. The THG switcher changes surrounding UI and rich-text surface colors, but a native dark code editor stays dark under Soda Light, and a native light editor stays light under dark THG schemes. Choose the code editor palette through Trilium’s native editor-theme setting. CodeMirror receives THG typography only; editor tokens color the rich-text surface and syntax tokens remain reserved for Phase 4. This avoids mixing incompatible native syntax colors with a replaced background. No full syntax mapping is claimed.

Typography uses `"Fira Code", "SFMono-Regular", Menlo, Monaco, Consolas, monospace`, 23px editor text, 30px line height and ligatures. Font availability is local to the client; none is bundled or fetched. Existing authored rich-text font choices and specialized/isolated editors may override typography. UI text is smaller for density. Tree rows become 26px; tab faces 30px within Trilium's native row geometry. Header spacing/title size are reduced without hiding actions, ribbons, promoted attributes or metadata. Search, attachments, protected notes, history, note operations, import/export and sync are not replaced.

The bottom bar shows the current note `type`, `UTF-8 · LF · Spaces: 4` and scheme picker. Encoding, line endings and indentation are **informational defaults**, not claims about the underlying note or overrides of native editor settings (also disclosed in the bar tooltip). Line/column is omitted because no cross-editor, split-safe public cursor API was verified. No language detection/confidence/lock is implemented.

Theme switching updates one root attribute synchronously, without rebuild or restart. Choice uses only `localStorage["thg.sublime.phase1.theme.v1"]`: global across notes, same-origin tabs and reload/reopen **within this browser profile**. It is not synchronized across devices/profiles, origins or user accounts sharing an origin. Storage events update other open tabs. Clearing/denying storage returns to THG Sublime on reload; blocked storage still allows session switching. Bad IDs fall back to THG Sublime; missing/malformed palette source fails packaging. The CSS base rule supplies default values for unknown DOM attributes. No per-keystroke work or timers are installed.

Density rules require `body.desktop` and width ≥901px. The bar hides at ≤900px, on `body.mobile`, and in print. Native mobile layout decides tabs/sidebar; no fixed widths or positioning are introduced. Schemes and editor typography may still apply on narrow desktop windows. If widget execution fails before render, scoped UI/editor CSS stays inactive and Lore retains its native layout. A partial CSS failure retains native controls. Initial install/update/disable needs Ctrl+Shift+R in each client; normal scheme changes do not.

## Reviewed operator path (later explicit approval only)

Workbench must not perform production mutation. This task request is not approval. The initial instruction also prohibits commits/pushes, so this workspace cannot create the exact committed artifact or GitHub PR required for PREPARE_CHANGE. A later authorized preparation step must create the reviewed commit/tree and PR, then wait for explicit `clds approve` bound to that artifact. Never treat an uncommitted prospective tree as accepted or deployed.

Canonical target: `archive`, Trilium `triliumnext/trilium:v0.104.1`, public UI `https://lore.thehighground.xyz`, deployment checkout `/opt/workbench/deploy/thg-brain`. The existing `REAME.md` has historical paths; this document records the intake canonical state without changing existing deployment/backup files. Persistent data is managed by Trilium. No direct database/data-directory access is used. Lore bridge, Inspector, networking, auth and other services are out of scope.

After approval, the Mac/human operator uses a clean checkout of the exact approved commit and:

1. Confirms the approved commit/tree against the PR/CLDS artifact and runs `scripts/verify.sh`. Confirms `archive`, image version and intended Lore instance by existing authorized operator access. Runs only one deploy at a time; pause other operators' changes to the customization subtree. ETAPI has no transactional compare-and-swap across these requests.
2. Opens an **existing private operator tunnel** terminating on `127.0.0.1` or `::1` with an explicit port. This package neither creates network exposure nor configures SSH/sudo. Never use the public Lore route for ETAPI. Existing operator authorization must supply this private route; no Workbench privileges are added.
3. In the intended Lore UI selects an existing, unprotected parent note reserved for customizations and copies its unique note ID. Do not use `root`: it cannot distinguish instances. The tool confirms this note exists and refuses activation markers, inheritable attributes and `child:*` copy/template attributes (these could alter newly created children). The dedicated THG Sublime subtree is created below it.
4. Supplies the ETAPI credential through exactly one of protected environment `THG_ETAPI_TOKEN`, owner-only regular file referenced by `THG_ETAPI_TOKEN_FILE`, or piped stdin with `THG_ETAPI_TOKEN_STDIN=1`. Values must never appear in argv, shell history, logs, reports or Lore. Do not use `set -x`. For a file, use a pre-existing credential managed by the operator, outside the repo; this tool writes no credential files. Redirects and environment proxies are disabled, and errors withhold response bodies/URLs.
5. Runs the read-only plan, then the approved action with the same parameters. Example values below are **non-secret placeholders**, not actual target IDs/artifacts:

```sh
# Environment contains only the path to an existing protected credential file.
export THG_ETAPI_TOKEN_FILE=/private/operator/etapi-credential
scripts/thg-sublime.sh apply --url http://127.0.0.1:18080 --parent-note-id PARENT_NOTE_ID
scripts/thg-sublime.sh apply --url http://127.0.0.1:18080 --parent-note-id PARENT_NOTE_ID \
  --execute --approved-commit APPROVED_40_HEX_COMMIT --approved-tree APPROVED_40_HEX_TREE
```

The tool validates v0.104.1, target parent, clean exact source and the entire ownership set before writing. IDs derive from a stable ownership namespace and module key; every note has exactly one owned `#thgSublimeOwner=thg-sublime-phase1-v1`. Foreign markers, duplicate markers, inherited/extra attributes, changed note kind, cloned/moved/protected notes and global attribute ID collisions fail closed. No unrelated notes are deleted or overwritten. Notes manually added below the subtree are not traversed or modified unless they collide with ownership; do not add inheritable markers.

First apply creates ten notes (subtree root, eight CSS notes, widget). A second identical apply performs zero writes. Updates temporarily remove activation labels, reconcile owned contents and then activate CSS and widget last. A failure after a note create but before its marker leaves an unmarked reserved ID: retry refuses it. Inspect that exact note manually; do not remove unrelated data or weaken checks. After an interrupted later update, repeat the same approved artifact. If only some activation labels were restored, retry reconciles them. No automatic retry of ambiguous mutations is attempted. Avoid reloading clients during deployment.

After mutation, the tool verifies that a second plan is empty and prints a compact JSON report of mode, dry-run, source commit/tree and operation/create counts. Retain this non-secret operator output with target-context confirmation and timestamp in the CLDS evidence. Dry-run source IDs describe HEAD, not uncommitted changes; only `--execute` enforces a clean approved tree. The CLI verifies identity, not the approval authority: the operator must first verify the later `clds approve` record.

## Non-destructive disable and rollback

Use the same approved checkout, target and credential indirection. Plan with `disable`; add `--execute` and the exact approved IDs only under the approved operator action:

```sh
scripts/thg-sublime.sh disable --url http://127.0.0.1:18080 --parent-note-id PARENT_NOTE_ID
scripts/thg-sublime.sh disable --url http://127.0.0.1:18080 --parent-note-id PARENT_NOTE_ID \
  --execute --approved-commit APPROVED_40_HEX_COMMIT --approved-tree APPROVED_40_HEX_TREE
```

Disable removes only nine `appCss`/`widget` activation attributes after the same ownership preflight. It preserves every note, source content, ownership marker and all knowledge. Repeat disable is a no-op. Press Ctrl+Shift+R in **every open client**; already loaded CSS/scripts remain until reload. Browser theme choice is harmlessly retained and reused on re-enable. Apply from the same approved release re-enables without duplicate notes. Roll back source by applying a previously reviewed, separately approved compatible release; Phase 1's initial rollback is disable.

If the tool refuses ownership conflicts, do not force it. An authorized human can inspect the dedicated notes in native Lore, remove only their owned `#widget` / `#appCss` labels and reload. Do not delete the subtree or user notes. Source-behavior failures go back through CLDS; no production hot-patches.

## Live verification and human acceptance (pending)

Use the deployed `inspector_readonly` contract and the typed plan in `sublime-live-verify.json` after the operator action. Required steps are `get_service_health({"service":"lore"})` and `get_route_health({"route":"lore"})`, both expecting `status=ok`, both failures classified `action_required`. Inspect the frozen contract before adding bounded Lore-only recent logs; no generic fallback is permitted. The intake's pre-change HTTP 200 checks are historical baseline, not verification of this implementation. Inspector proves infrastructure health, not pixels.

Record each browser check with client/viewport, native theme, chosen scheme and result:

- Existing knowledge opens intact; desktop looks materially Sublime-like; font fallback/23px/30px is usable.
- Compact hierarchy, rectangular selection/tabs, drag/reorder/close, several open notes and splits work.
- Reduced header preserves access to search, create/edit, links, attributes, backlinks, attachments, protected notes, history, import/export and sync; no overlays block controls.
- Status kind follows active notes/splits and type changes; picker is keyboard reachable; all nine themes switch without restart, and selected theme survives reload/reopen.
- Measure visible switching locally (target <200ms). Test native light and dark code editor settings separately while cycling every THG scheme, including focused/unfocused selections and active lines. Code colors must remain native and readable while Soda Light menus change to light; Cyberpunk body text is neutral and neon stays accents.
- Narrow desktop at 900px/600px and mobile/tablet portrait/landscape have no forced tab/sidebar geometry or horizontal overflow; knowledge remains editable. Repeat relevant flows in the native legacy and Next layouts used by the operator.
- Disable/reload returns to usable native Lore without knowledge changes; re-enable restores the customization.

Only after exact approval, operator action, Inspector checks, human acceptance and canonical Lore evidence may CLDS DOCUMENT/COMPLETE. Final production evidence must name deployed commit/tree, operator report, actual Inspector results, human acceptance and limitations. No production or Phase 2–5 completion is asserted by this preparation.
