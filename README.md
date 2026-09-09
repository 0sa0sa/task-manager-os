# Task Manager OS

Voice-first local project and task operations. The orbital map borrows the Project -> Task ->
Subtask visual grammar from FounderOS. Continuous Japanese/English speech input is streamed to
Soniox from the local server, so the API key never reaches the browser.

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
local path. Copy the local API settings from `mtg-notes/apps/api/.env` into this project's `.env`
when needed; `.env` is ignored and must never be committed. Set `PORT=8798` for the Task Manager
OS server and provide `SONIOX_API_KEY` to enable live recognition. A safe template is available at
`.env.example`.

Voice examples include `Task Manager OSにタスク テストを追加`, `このタスクを完了`,
`このタスクにサブタスク テストを書くを追加`, and `元に戻す`. Commands are previewed before
execution, ambiguous names are rejected, and destructive actions require confirmation.

Press the SONIOX microphone button to grant microphone access and start a live PCM stream. Interim
and finalized Soniox segments are shown in the command bar; finalized speech is appended to the
draft and can be reviewed before execution. If microphone permission, the API key, or the
upstream connection is unavailable, the UI stops the capture and shows a local error without
leaking credentials.

The `HERDR SYNC` button reads the local Herdr registry. Workspaces become projects and agent
panes become tasks, including pane IDs, provider and live status. Generic labels such as
`claude-handoff` are replaced in the graph by a readable task hint from the latest Herdr recap
or prompt, with the worktree and branch as a fallback. Manual tasks are preserved when the
snapshot refreshes.

Clicking a Claude Code or Codex task loads the pane's recent transcript and a compact recap;
the composer sends literal text and an `enter` key event to the local Herdr pane so the session
can continue. The same panel lets you save a descriptive Herdr pane name (using `pane rename`),
which then becomes the source label on the next sync. Graph
drag positions and hidden nodes are saved in the same local state file. Right-click a project,
task, or subtask to hide/show it or reset that branch's layout; right-click the canvas to restore
all hidden nodes. The VIEW switcher stores multiple named visibility presets, so you can move
between focused and overview workspaces without losing the individual layout.

Right-click a project and choose `このプロジェクトだけに絞る` to enter the animated
`PROJECT CENTER` view: only that project remains, it is placed at the circle center, and its
tasks are distributed evenly around it. The `MISSIONS` hub fades out during the transition.
Normal project clicks still select the project without hiding the overview. Tasks and CLI-activity
nodes support hover, keyboard focus (`Enter`/`Space`), click selection, and drag positioning;
selected nodes remain highlighted while their parent task opens in the detail panel.

Herdr-backed tasks also expose a `CLI ACTIVITY` list. It is built from the pane transcript's
actual Claude Code tool calls (`Bash`, `Read`, `Edit`, `Write`, etc.) and Codex `Ran`/terminal
events (直近ログから最大24件), including a compact result excerpt. `Task`, `Agent`, `SendMessage`, and `TaskOutput`
events are marked as delegation and rendered with a purple branch/icon, so work handed to a
sub-agent is visible as a separate node rather than being mistaken for a normal command.

The project index also wraps Herdr's local controls: create a workspace with a label and working
directory, then open a new Codex or Claude Code agent pane from a Herdr-backed project by entering
the task title. These actions call the local `herdr` CLI and sync the live registry back into the
graph; no external service is contacted.

```sh
bun run test
bun run typecheck
bun run build
```
