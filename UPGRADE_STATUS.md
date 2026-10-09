# Intelligence upgrade 0.20.4 — implementation status

0.20.4 aligns the JavaScript HTTP, updater, process and opener plugins with their native dependencies. A regression test compares all installed Tauri frontend plugin versions with Cargo.lock; installer builds also use the locked Cargo dependencies.

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
