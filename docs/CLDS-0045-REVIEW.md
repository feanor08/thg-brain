# CLDS-0045 local implementation and test evidence

Phase 2 extends the existing owned widget and status CSS. Stable IDs and the Phase-1 ownership namespace remain unchanged. Intake base: `8778028a6b71531e856355c3d022694f3e7e7d48`. This is uncommitted workspace evidence, not independent review or deployment approval.

Implemented: deterministic bounded language rules for the required 19 IDs, conservative Unknown fallback, evidence scores, changed-sample hysteresis, durable owned per-note language labels, explicit clear, status controls and lifecycle cleanup. Theme state remains in the unchanged Phase-1 storage key. User content/type/MIME are never written. Native MIME catalogue entries are reference data only. Unprotected code notes without an owned package marker are the only eligible notes.

Review-cycle-2 repairs: SQL/HTML comments previously supplied executable grammar evidence, and unanchored shell control words matched ordinary echo prose. The detector now filters these comments and requires command boundaries around control words. Regression cases include the exact reported failures, multiline comments, comments mixed with another language, and a valid shell conditional.

Manual locking previously added an unexpected attribute to managed package notes, blocking strict apply/disable preflight. Both the frontend selector/action and fresh metadata preflight now reject any owned `thgSublimeOwner` marker. A test passes deployed fixture records through the exact packaged widget, exercises stale-cache refusal after metadata reload, then performs update, repeat apply, disable and repeat disable without weakening ownership validation.

Review-cycle-3 repairs: empty content previously entered pending Unknown, then identical refreshes preserved the stale language forever. Empty/whitespace samples now immediately discard automatic evidence and pending state. Tests delete detected Python content and repeat the unchanged refresh five times; widget tests also verify that a manual lock still wins on empty content until cleared. Evidenced-language hysteresis remains unchanged.

An invalid durable lock previously left Auto already selected, so selecting Auto could not trigger the native change event. A disabled invalid-lock placeholder now has a distinct selection value. Both the packaged controller harness and Chromium fixture choose Auto from that state and verify durable label removal and restored detection, without first choosing another language.

Validation on 2026-09-11 (rerun after cycle-3 repairs):

- `scripts/verify.sh` passed: 38 Python tests, detector JavaScript tests, exact packaged controller tests, fixture apply/disable and `git diff --check`.
- Real Chromium passed all existing editor palette regressions and packaged language-control interactions at 1280, 901 and 800 pixels. These use a fixture API adapter, not a running Trilium.
- ETAPI fixture second apply and repeated disable each performed zero operations; Phase-1 module upgrade created zero new notes. Ownership conflicts fail before writes.
- The initial sandbox run could not create loopback sockets; the approved rerun passed using a disposable loopback fixture listener and existing cached browser libraries in the ignored verification runtime directory. No container or production service was used.

Review limitations: rule evidence is not statistical certainty; multiline strings, mixed programs and YAML-like prose remain imperfectly distinguishable. Analysis ignores content beyond its prefix bound and declines unusually long non-JSON lines. Hysteresis intentionally may hold a single replacement paste until a second edit. Lock writes now use native session-authenticated attribute requests with backend scripting disabled; concurrent writes use Trilium's transaction ordering. Supported API source was inspected at v0.104.1; actual Trilium typing/save/event interoperability still needs future human acceptance.

No commits, pushes, deployment, secret persistence or production mutations occurred. Independent GitHub-direct review and PREPARE_CHANGE remain future lifecycle steps after separately authorized commit/push. After future approved deployment, require the existing Lore service/route Inspector plan (`status=ok`) plus human detector/lock/status-bar acceptance. See `THG-SUBLIME.md` for supported surfaces, durability semantics, operator path and non-destructive rollback.

## Repair of scripting-disabled live failure (2026-09-12)

Diagnosis: the earlier fixture implemented `api.runOnBackend` as an available bridge, masking the production security configuration. Enabling it would grant server-side scripts filesystem/network/OS access and is not an acceptable dependency. Removed that bridge entirely from the shipped controller. The replacement uses only version-pinned native frontend attribute PUT/DELETE routes with the existing session and CSRF context, plus public note reload/read APIs. No public ETAPI, token provisioning, custom backend endpoint or configuration change is needed. See the linked source contracts and concurrency/timeout limitations in `THG-SUBLIME.md`.

Regression coverage now keeps backend scripting disabled and exercises native request methods, exact label-only payloads, proxy-prefix paths, same-origin/redirect guards, missing CSRF, HTTP denial, timeout/transport failure, no automatic retry, fresh metadata exclusions, malformed inheritance/duplicates, durable reopen and clear. Browser tests use real HTTP against an ephemeral local label fixture; the original harness had simulated a backend scripting capability the deployed instance intentionally lacks. Existing detector, nine-theme, MIME/content preservation, mobile, ownership and ETAPI reconciliation suites remain in the canonical verifier.

Final repair validation (2026-09-12): `scripts/verify.sh` passed all 38 Python tests, detector and packaged-controller JavaScript suites, real Chromium palette/control fixtures (language widths 1280/901/800), fixture reconciliation and diff checks. Failed replacement retains the old lock; malformed duplicate clear preserves unrelated attributes. Reapply and repeated disable each performed zero operations. The restricted first run could not open loopback sockets; the authorized local-browser reruns passed. Live Trilium interaction and human production acceptance remain pending; no commit, push, deployment, container use or secret persistence occurred.

## Review-cycle-5 detector/state repair (2026-09-12)

Diagnosis: only empty content invalidated the incumbent before the identical-content guard. A short nonempty replacement therefore retained obsolete confidence indefinitely. Every Unknown result now immediately clears automatic evidence and pending state, covering tiny, insufficient, comments-only and ambiguous samples. Hysteresis between evidenced languages still requires two distinct changed samples and the existing strength margin; manual locks retain priority.

Hash-prefixed Markdown evidence also ignored explicit script context. A leading shebang now makes hash comments unavailable to Markdown rules. The exact Bash shebang/heading/link failure and an env Python variant return Unknown; ordinary Markdown and executable shell corpus cases still pass.

Added detector repeated-refresh/fresh-session regressions and packaged-widget Python-to-`x`, repeated refresh, reopened-widget, manual-lock and clear regressions. Content remains exactly `x` throughout lock/clear. Updated heuristic documentation to describe immediate Unknown invalidation.

Validation: `scripts/verify.sh` passed all 38 Python tests, JavaScript detector/controller suites, real Chromium palette and language-control fixtures, idempotent fixture apply/disable and diff checks. The restricted run could not create loopback sockets; the permitted local-fixture rerun passed. Existing scripting-disabled transport repair was preserved and tested. No commit, push, deployment, container use, secret persistence or production action occurred. Live Trilium and human acceptance remain pending.
