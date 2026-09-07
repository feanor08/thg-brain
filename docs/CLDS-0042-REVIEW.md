# CLDS-0042 preparation evidence

Status: local implementation and automated TEST pass. Independent REVIEW is **pending/blocking**, not accepted. PREPARE_CHANGE, WAITING_FOR_APPROVAL, EXTERNAL_ACTION, live VERIFY, DOCUMENT and COMPLETE have not been reached.

Workspace branch: `clds/clds-0042`. Baseline HEAD: `2855595ae21524f2af0a271c2f35eec83145123c`. No feature commit, accepted Git tree, GitHub PR, deployed artifact, operator action, Inspector verification or human/browser acceptance exists for this increment. The user explicitly prohibited commit, push and deployment; these actions were not performed. A prospective tree can be frozen in a temporary local index without making a commit, but is not an approved artifact.

## TEST evidence

The previous CLDS TEST failed before running tests because `node` was absent from PATH. Earlier evidence used an explicit temporary `NODE_BIN`, which the standard invocation did not retain. Verification now resolves a supported PATH runtime or uses a checksum-pinned workspace-local archive cache. This restricted-network workspace was preseeded from the existing official ARM64 archive; no system installation or production action was performed. Reproduce with Python 3.9.2 and the verified Node v22.16.0 ARM64 runtime:

```sh
scripts/verify.sh
```

- 31 Python tests cover deterministic packaging/all nine schemes/default, contrast, typography/modules/mobile scope, supported note metadata, dry-run, idempotency, partial update recovery, conflict refusal, parent child/template/inheritable rejection, disable/re-enable preservation, exact-source gates, credential file protections, loopback/redirect/proxy constraints, request method/header/body contract, error redaction, baseline assets, syntax and live-plan structure. Runtime regressions cover explicit overrides, `nodejs` discovery, version/executable checks, archive checksums, restricted member extraction, corrupted offline cache and network failure without skipping tests.
- Packaged JavaScript executed successfully in the dependency-free widget harness: all nine choices, default, invalid/prototype-like IDs, reload persistence, denied storage, cross-tab/clear events, literal text rendering, active kind updates, frozen note invariance and event cleanup.
- Fixture first apply: 10 created notes, 29 operations. Identical second apply: 0 created notes, 0 operations. Disable: 9 attribute removals. Repeated disable: 0 operations. Re-enable preserves note identities/content.
- Shell/JS/Python syntax checks and whitespace check passed. All eight original tracked files have unchanged Git blob hashes, including deployment and backup assets.

The editor regression ran in Chromium 120.0.6099.224 against the packaged CSS. Each desktop/narrow run checked 40 combinations (nine schemes plus invalid fallback × native light/dark × focused/unfocused). Real DOM spans retain explicit syntax colors; computed native/drawn selection, active-line, gutter and caret colors remain unchanged, and highlighted text contrast stays ≥4.5:1 on the fixture surfaces. Reintroducing the old background/foreground override is rejected by the same browser test. These are representative CM6 DOM/palette fixtures, not live Trilium or a full CodeMirror runtime.

Chromium required two missing libraries (`libnss3`, `libnspr4`), downloaded from Debian and extracted only into the ignored workspace cache; no system installation occurred. Browser execution needed the process sandbox override. `scripts/verify.sh` passed with the discovered runtime/browser and that cache.

Controller execution took less than 200ms for the nine-choice test loop including harness reloads. This is **not visible browser latency evidence**. Layout checks remain structural; the new browser palette checks are computed-style/contrast tests, not a full accessibility audit. Live Trilium ETAPI and browser integration were not exercised.

## Review attempt and source self-review

The supplied review-cycle-2 result passed the prior verification but blocked on partial CodeMirror recoloring. That diagnosis is correct: replacing the background and inherited foreground cannot recolor explicit syntax spans or native selection/active-line layers. Phase 1 now leaves the entire CodeMirror palette native and applies typography only. All nine THG schemes continue to color the surrounding UI and rich-text surface. The intentional native-editor appearance difference is documented, and Phase 4 mappings remain open.

An independent read-only review was requested for this revision, but the reviewer service failed to start with `no thread with id` before any review ran. The attempt did not mutate the development worktree. Independent review of this revision cannot be reported as passed; a separate reviewer must examine the final prospective/committed tree before approval. The following is an implementation self-review, not a substitute for that gate.

The exact v0.104.1 source was checked for CSS bootstrap, widget exports/placement/lifecycle, tree/tab selectors, ETAPI create/content/search/attributes and attribute reactivation behavior. Linked contracts and known visual limits are documented in `THG-SUBLIME.md`.

A self-review finding was corrected: Trilium `copyChildAttributes` copies `child:*` attributes/templates onto newly created notes, and inheritable attributes can silently add unexpected state. Preflight now refuses these on the target parent before any write; regression tests verify zero mutation on refusal. Global attribute-ID collisions are checked because the upstream create-attribute implementation can upsert an existing ID. Per-note markers alone would be insufficient.

No core patch, backend script, DB/data-directory writer, credential persistence, public ETAPI route, bridge change, Inspector widening, production privilege or deployment/topology change was introduced. The controller uses lifecycle events and a single root theme attribute, with no polling, note mutation or editor monkey-patching. Density styles avoid hiding controls and preserve native tab positions/widths and tree hierarchy. Disable deletes activation attributes only.

Remaining material limits: ETAPI operations are not a cross-request transaction; operators must serialize customization changes. A crash between note creation and marker creation fails closed on retry and needs human inspection. Initial activation/update/disable needs client reload. The complete CodeMirror palette remains native, so Soda Light can surround a native dark editor and dark THG schemes can surround a native light editor. Live acceptance must check both native settings; the fixture test does not cover every third-party editor theme. Native legacy/Next layout, splits, search, protected-note and narrow/mobile flows require human browser acceptance. Theme storage is per origin/browser profile, not device-synchronized. UTF-8/LF/Spaces are informational; line/column is omitted.

## Next authorized stages

1. Obtain a successful independent read-only review of the final tree and resolve material findings.
2. In a later commit/push-authorized preparation stage, create the exact feature commit/tree and GitHub PR and present test/review evidence plus the proposed Mac/human action.
3. Wait for later explicit `clds approve` bound to that artifact. The current task is not approval.
4. Mac/human operator applies the approved repo-backed path, retains the compact report, and exercises non-destructive rollback ability.
5. Run the actual deployed Inspector plan and human/browser acceptance; record canonical Lore evidence before DOCUMENT/COMPLETE.

Phase 1 is implemented locally, not delivered to production. Phases 2–5 remain open.
