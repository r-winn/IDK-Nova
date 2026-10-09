# Intelligence upgrade 0.21.1 — implementation status

## 0.24.0 — real local tools and credential recovery

Four audited executable extensions run via the existing Responses/Chat Completions function-calling loop in main and temporary chats: arithmetic, text metrics, JSON validation and Gregorian date intervals. Tool results are shown separately from supplied prompt-pack badges. Only installed/selected tools are offered; explicit mentions activate installed tools. Config bundles carry their allowlisted IDs, never arbitrary code. Prompt-only packages remain clearly labelled and preserve existing installations. Live caret-aware @ suggestions support keyboard selection and ignore email addresses. Removal actions are red in both themes. Deleting all visible conversations starts a normal draft while keeping archived history.

Credential hydration preserves saved-key markers even for NoEntry results; autosave cannot silently erase that reference. Persisted vault identifiers survive connection edits. User-initiated recovery can request macOS Keychain authorization; startup/autosave remain non-interactive. This does not solve missing Developer ID signing or recover secrets physically absent from all storage. The affected user's actual update/vault scenario still needs device retesting; no physical Windows end-to-end result is claimed.

Verification: automated frontend regression tests include actual tool-loop output, arithmetic/input validation, portable extensions, caret suggestions, locked/missing vault reads and identifier continuity. Local macOS native checks and UI smoke tests complement CI installer builds; live third-party model behavior is not guaranteed by local mock-provider tests.

## 0.23.1 polish

Selective configuration export supports independent appearance, model connections, personal prompts, installed prompt packs, Intelligence, prices and optional personal memory. Omitted sections do not overwrite destination settings. Provider keys remain opt-in. Marketplace actions are aligned and themed; plugin pickers dismiss on selection/outside click. Sent messages record the exact pack snapshot whose instructions are supplied to the request, including temporary side chats. This records input provenance, not guaranteed model adherence. Last-conversation deletion starts a fresh normal chat; Work-context deletion remains supported when other conversations exist. Intelligence content transitions preserve its sticky navigation and recovery actions have consistent spacing. Regression coverage adds selective export/import and both deletion paths. Full physical-device end-to-end testing remains separate from frontend checks and CI installer validation.

0.21.1: macOS vault operations suppress optional password prompts and fail closed when the existing item requires authorization. Failed reads preserve stored-key markers and do not block other providers. No Keychain item is deleted to repair permissions. A user may enter a key for the current session; saving can still fail if the system vault is unavailable. The actual rejected-password scenario requires retesting on the affected Mac. Intelligence selectors use theme-aware popovers and its section navigation remains sticky while the settings body scrolls.

UI refresh: removed the redundant settings footer message, separated the tool catalog into its own menu, added capability search and risk filtering, restyled Intelligence tabs and text fields, and fixed checkbox sizing and footer alignment. Search was verified in the local UI.

0.21.1 aligns the JavaScript HTTP, updater, process and opener plugins with their native dependencies. A regression test compares all installed Tauri frontend plugin versions with Cargo.lock; installer builds also use the locked Cargo dependencies.

Release repair: native tests now use the explicit Cargo manifest on both platforms. Installers stay in a draft until both platforms pass and expected assets exist. Settings tool groups and routing labels have been simplified. Local validation: 12 JavaScript tests, 2 native recovery tests, production UI build, and dependency audit. UI smoke checks cover model-test failure visibility and Intelligence navigation; full desktop end-to-end verification is still required.

This incremental upgrade is not a completed implementation of the twelve-part product roadmap. Do not describe it as feature-complete or production-verified on all operating systems.

## Implemented in this change

- Cooperative pause/resume at tool boundaries and stop controls. An in-flight operation finishes before pause takes effect.
- Agent plan reporting and native workspace checkpoint creation before large changes.
- Correct failure reporting when a tool returns `ok: false`.
- No-progress fingerprints ignore volatile timing and call identifiers.
- Settings center for personal/work memory, pinned notes, message context selection, context-size estimates, model routing, task activity and the existing tool catalog.
- Portable Work memory notes persisted through the existing workspace history format.
- Rule-based fast/strong/vision/private routing. Explicitly private requests fail closed unless a local route is configured.
- Fix for the moved Ollama executable path that broke the previous desktop build.
- Desktop checkpoint listing and confirmed restore with a recovery backup; newer files are retained.
- Automatic checkpoint before the first native file mutation, required plan before mutating/external tools, and validation of tool arguments against their declared schemas.
- Provider-reported token usage, first-visible-text and total timing, daily/monthly records, and configurable future-response cost estimates.
- Keychain/Credential Manager storage for desktop provider keys, migration after successful vault writes, and credential commands restricted to the main webview.
- Best-effort secret redaction in new activity records and displayed provider failures.
- Responses compatibility negotiation handles multiple unsupported options; streaming usage options have a compatibility fallback.
- KaTeX and source-map-js updated to patched releases after dependency advisory checks. Installer publication for 0.20.0 was cancelled before producing a public release.

## 0.22.0 — implemented and verified scope

- Response style is in Intelligence; memory and reserved storage settings have one home. About and Updates are anchored at the bottom of Settings.
- Registered `@tool_name` commands run through the normal desktop Work runtime and approval policy. Both Responses and Chat Completions enforce requested tool execution and reject unverified completion; normal chats do not silently pretend to execute tools.
- Model tests show inline authentication, access, quota, server, request and ambiguous-network guidance. A passing test is labelled with its actual timestamp, not continuous connectivity.
- File write/patch approval includes before/after text. Reviewed content is checked again before writing; concurrent edits cause a new review rather than silent replacement. Full-access Work follows its existing no-approval policy. Recovery includes confirmed undo of the last recorded file operation, not arbitrary historical per-file rollback.
- Interrupted tasks retain their goal and recorded events. Recovery prepares an explicit continuation in the original chat; the user must send it. This is state reinspection and continuation, **not** a restored process, browser session, or exact durable runtime replay.
- Personal prompt library with validated import/export and `@shortcut` expansion. A separate Marketplace installs/uninstalls three bundled declarative prompt packs with source/version/permission labels. This is **not** an executable third-party plugin marketplace or MCP installer.
- A local-model-only Work policy fails closed before chat/project context is sent to a remote model. It does not sandbox browser/terminal networking.
- Desktop live voice preview uses native ephemeral-token minting and WebRTC, explicit microphone start, mute/end, audio playback retry and cleanup. It requires a provider with `/realtime/client_secrets` and `/realtime/calls` plus an accessible Realtime model. It does not inherit Work tools or save voice history. Web voice requires a secure token service. A real paid-provider call and physical microphone tests on Windows/macOS are still required.
- Verification: frontend regression suite, native reviewed-write/patch/undo tests, macOS debug compilation and local Settings UI inspection. Installer CI must still pass on both platforms before public release.

## 0.23.0 — settings, voice and portable prompt packs

- Settings share the application state and save automatically with debounced writes plus a close-time flush. Unchanged credentials are not rewritten to the native vault. Save/Cancel footer removed.
- Intelligence tabs keep their initial top spacing while content scrolls.
- Marketplace streams bundled pack files and reports measured bytes, validates manifests, and supports removal. Packs are selectable in each main or temporary side-chat composer and supply instructions to that request. They remain text-only and grant no permissions.
- Versioned config bundles carry installed prompt content, personal prompts, routing/context settings, model pricing, branding and main preferences. Imported provider IDs are remapped by endpoint, existing models are preserved, and invalid extensions fail before mutation. API keys and personal notes require explicit opt-in; project data is not included.
- Live voice checks the selected model using native token negotiation without microphone access. The same selected model powers the in-chat voice screen with animated orb, mute, stop and cancel. Closing/changing chats releases microphone and peer resources. Web voice still needs a secure token service. A successful token check does not guarantee WebRTC network connectivity; physical microphone/paid-provider end-to-end tests are pending.

## Still required before claiming the requested roadmap is complete

1. Reliable agent: complete provenance presentation, native child-process cancellation, durable task resume/recovery and end-to-end verification.
2. Context: automatic summarization/compaction, file inclusion controls and complete artifact migration tests.
3. Router: health-based fallback, richer classification and sensitive-data review.
4. Usage: per-message presentation, hard spending budgets, richer comparisons and quality evaluations. First visible text is tracked, not the provider's internal first-token timestamp.
5. Skills: installation lifecycle, verified manifests, MCP integration and connector permissions.
6. Git: integrated diff/branch/commit/conflict/PR/review workflow.
7. Artifacts: complete spreadsheet, annotation, diagram and export workflows.
8. Browser: tested DOM/accessibility control, profiles, downloads, replay and human-intervention flows.
9. Security: vault end-to-end tests on both operating systems, encrypted Work storage, richer policy enforcement and app lock.
10. Organization: identity, roles, shared workspaces, centralized enforced policy and internal updates.
11. Multimodal: live voice, screen sharing and audio/video workflows.
12. Setup: guided onboarding with verified connection and first-task completion.

Existing features must be audited rather than assumed to satisfy these requirements. Automated unit tests and local builds are not a substitute for Windows/macOS end-to-end tests.
