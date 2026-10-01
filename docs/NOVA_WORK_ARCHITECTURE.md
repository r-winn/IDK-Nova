# Nova Work architecture

Nova Work is an agent runtime, not a privileged chat mode. Models can only request typed tools. The Nova Agent Core validates and authorizes each request before the native host touches the filesystem, terminal, browser, or desktop.

```text
Nova UI
  └─ Agent Core
      ├─ provider adapter
      ├─ task state and audit
      ├─ tool router
      └─ permission policy
          └─ Tauri native tool host
              ├─ workspace filesystem
              ├─ bounded project shell
              ├─ Nova Workspace Browser
              └─ visible desktop control
```

## Unified tool contract

Every call carries an identifier, semantic tool name, validated arguments, working directory, effect (`read`, `write`, or `external`), risk level, permission scope, and timeout. Every result carries status, duration, structured data, changed files, attachments, and optional screenshots.

Provider adapters only translate this catalog to provider function schemas. Tool implementation and permission behavior are provider-independent.

## Security boundary

- Workspace paths must be relative and remain under the attached project root.
- Hidden paths, symlink traversal, secrets, dependency/build output, unsupported binaries, and oversized context files are excluded.
- Writes and focused patches create content snapshots.
- Delete moves content into recoverable `.nova-work/trash` storage.
- The latest Nova file operation can be undone.
- Shell commands run with the selected project as their working directory and reject known destructive or privilege-elevation patterns.
- Websites and tool output are untrusted data and cannot grant permissions.
- Durable secrets, payment information, critical system changes, and irreversible external actions are blocked.

## Task lifecycle

Tasks persist locally with these states:

```text
created → planning → waiting_permission / waiting_user → running
        → completed / failed / cancelled / paused
```

Each event records its time, tool, call identifier, label, state, and error detail. UI progress is derived from the same activity stream rather than a separate spinner state.

The model/tool loop has no fixed turn count. It continues until the model returns a final answer, the user stops it, an actual provider/tool failure occurs, or the progress watchdog detects a repeated one-, two-, or three-action cycle with unchanged results. Approval and user-input prompts pause the existing run and resume the same run state.

## Current native tools

- `fs_list`, `fs_read`, `fs_read_range`, `fs_search`
- `fs_write`, `fs_apply_patch`, `fs_mkdir`, `fs_move`, `fs_copy`, `fs_delete`, `fs_undo`
- `shell_exec`
- `web_search`, `browser_open`
- `computer_snapshot`, `computer_open_app`, `computer_click`, `computer_type`, `computer_key`, `computer_scroll`
- `ask_user`

## Planned process boundary

The protocol deliberately keeps UI code independent of the host so the current Tauri commands can move into separate `nova-agent-host`, command runner, browser worker, and artifact worker processes. PTY sessions, Playwright semantic automation, MCP, artifact generation, OS sandbox accounts, network policies, secure credentials, scheduling, and OpenTelemetry belong behind that boundary and should not be implemented in the renderer.

## Design rules

1. Prefer API/MCP/WebMCP, then DOM/accessibility, then vision/pixel control.
2. Prefer semantic file tools over shell commands.
3. Ask at the side-effect boundary, not at the beginning of a task.
4. Keep external actions distinct from research.
5. Never claim a change until a tool result verifies it.
6. Keep full task history compact; send only relevant project context to the model.
