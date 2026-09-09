import { describe, expect, it } from 'vitest';
import { buildHerdrProjects, friendlyPaneTitle } from '../server/herdr';

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
});
