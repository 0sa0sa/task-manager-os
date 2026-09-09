# Task Manager OS

Voice-first local project and task operations. The orbital map borrows the Project -> Task ->
Subtask visual grammar from FounderOS, while Japanese continuous speech input follows the
focused Web Speech API path from claude-voice.

## Run with Bun

```sh
bun install
bun run dev
```

Open http://localhost:5190. The API runs on port 8798. For a production-style local server:

```sh
bun run build
bun start
```

State defaults to `~/.task-manager-os/state.json`. Set `TASK_MANAGER_OS_DATA_PATH` to use another
local path. No cloud account is required.

Voice examples include `Task Manager OSにタスク テストを追加`, `このタスクを完了`,
`このタスクにサブタスク テストを書くを追加`, and `元に戻す`. Commands are previewed before
execution, ambiguous names are rejected, and destructive actions require confirmation.

The `HERDR SYNC` button reads the local Herdr registry. Workspaces become projects and agent
panes become tasks, including pane IDs, provider and live status. Manual tasks are preserved
when the snapshot refreshes.

Clicking a Claude Code or Codex task loads the pane's recent transcript and a compact recap;
the composer sends a new prompt back into that Herdr pane so the session can continue. Graph
drag positions and hidden nodes are saved in the same local state file. Right-click a project,
task, or subtask to hide/show it or reset that branch's layout; right-click the canvas to restore
all hidden nodes. The VIEW switcher stores multiple named visibility presets, so you can move
between focused and overview workspaces without losing the individual layout.

The project index also wraps Herdr's local controls: create a workspace with a label and working
directory, then open a new Codex or Claude Code agent pane from a Herdr-backed project by entering
the task title. These actions call the local `herdr` CLI and sync the live registry back into the
graph; no external service is contacted.

```sh
bun run test
bun run typecheck
bun run build
```
