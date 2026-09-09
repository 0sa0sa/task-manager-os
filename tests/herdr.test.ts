import { describe, expect, it } from 'vitest';
import { buildHerdrProjects, extractPaneSubtasks, friendlyPaneTitle } from '../server/herdr';

describe('Herdr task labels', () => {
  it('keeps a descriptive pane label while adding its worktree context', () => {
    const title = friendlyPaneTitle({
      pane_id: 'w-test:p1',
      workspace_id: 'w-test',
      agent: 'claude',
      label: 'Fix API idempotency',
      foreground_cwd: '/tmp',
    });
    expect(title).toBe('Fix API idempotency · tmp');
  });

  it('replaces generic handoff labels with a useful agent/worktree title', () => {
    const title = friendlyPaneTitle({
      pane_id: 'w-test:p2',
      workspace_id: 'w-test',
      agent: 'codex',
      label: 'codex-handoff',
      foreground_cwd: '/tmp',
    });
    expect(title).toMatch(/^Codex · /u);
    expect(title).not.toContain('codex-handoff');
  });

  it('disambiguates panes that currently have the same fallback title', () => {
    const projects = buildHerdrProjects(
      [{ workspace_id: 'w-test', label: 'Demo' }],
      [
        { pane_id: 'w-test:p1', workspace_id: 'w-test', agent: 'codex', foreground_cwd: '/tmp' },
        { pane_id: 'w-test:p2', workspace_id: 'w-test', agent: 'codex', foreground_cwd: '/tmp' },
      ],
    );
    expect(projects[0].tasks[0].title).not.toBe(projects[0].tasks[1].title);
    expect(projects[0].tasks[1].title).toContain('w-test:p2');
  });

  it('records CLI commands and draws delegation events as separate Herdr subtasks', () => {
    const subtasks = extractPaneSubtasks([
      '⏺ Bash(git status --short)',
      '  ⎿ clean',
      '⏺ Task(subagent_type="Explore", prompt="find the failing test")',
      '  ⎿ agent completed the search',
      '• Ran bun test',
      '• Waited for background terminal · sleep 2',
    ].join('\n'), 'w-test:p1', 'claude');
    expect(subtasks).toHaveLength(4);
    expect(subtasks[0]).toMatchObject({ kind: 'execution', command: 'git status --short', output: 'clean', actor: 'claude' });
    expect(subtasks[1]).toMatchObject({ kind: 'delegation', delegatedTo: 'Explore', title: expect.stringContaining('find the failing test') });
    expect(subtasks[2]).toMatchObject({ kind: 'execution', command: 'bun test' });
    expect(subtasks[3]).toMatchObject({ kind: 'execution', command: 'sleep 2' });
  });
  it('keeps Codex tool summaries as evidence even when no shell command is shown', () => {
    const subtasks = extractPaneSubtasks([
      '• Searched for 2 patterns',
      '• Read 3 files',
      '• Delegated to the review sub-agent',
    ].join('\n'), 'w-test:p3', 'codex');
    expect(subtasks).toMatchObject([
      { kind: 'execution', title: 'Searched: for 2 patterns', actor: 'codex' },
      { kind: 'execution', title: 'Read: 3 files', actor: 'codex' },
      { kind: 'delegation', delegatedTo: 'sub-agent', actor: 'codex' },
    ]);
  });
  it('reassembles Codex boxed command lines and keeps their result excerpt', () => {
    const subtasks = extractPaneSubtasks([
      '• Ran git add src/App.tsx',
      '  │ && git diff --check',
      '  └ clean',
    ].join('\n'), 'w-test:p6', 'codex');
    expect(subtasks[0]).toMatchObject({ command: 'git add src/App.tsx && git diff --check', output: 'clean' });
  });
  it('keeps only the latest bounded activity window', () => {
    const transcript = Array.from({ length: 30 }, (_, index) => `• Ran command-${index}`).join('\n');
    const subtasks = extractPaneSubtasks(transcript, 'w-test:p4', 'codex');
    expect(subtasks).toHaveLength(24);
    expect(subtasks[0].command).toBe('command-6');
    expect(subtasks.at(-1)?.command).toBe('command-29');
  });
  it('does not mistake indented transcript quotes for real tool events', () => {
    const subtasks = extractPaneSubtasks("  ⏺ Task(subagent_type=\"Explore\")\n  • Ran rm -rf /tmp", 'w-test:p5', 'claude');
    expect(subtasks).toHaveLength(0);
  });
});
