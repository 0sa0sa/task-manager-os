import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { seed } from '../src/domain';

describe('local API', () => {
  it('persists a command and returns JSON errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'task-manager-os-'));
    const app = createApp(new Store(join(dir, 'state.json')));
    const first = await app.request('/api/state');
    expect(first.status).toBe(200);
    const state = (await first.json() as any).state;
    const response = await app.request('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'task.create', projectId: state.projects[0].id, title: 'API task' }) });
    expect(response.status).toBe(200);
    expect((await response.json() as any).state.projects[0].tasks).toHaveLength(2);
    expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).revision).toBe(1);
    const bad = await app.request('/api/commands', { method: 'POST', body: '{' });
    expect(bad.status).toBe(400);
    expect((await bad.json() as any).ok).toBe(false);
  });
  it('persists graph layout independently of task mutations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'task-manager-os-layout-'));
    const path = join(dir, 'state.json');
    const app = createApp(new Store(path));
    const saved = await app.request('/api/layout', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ positions: { 'p-welcome': { x: 12.5, y: -8 } }, hidden: ['t-welcome'], views: [{ id: 'default', name: 'Default', hidden: ['t-welcome'] }, { id: 'focus', name: 'Focus', hidden: [] }], activeViewId: 'focus' }) });
    expect(saved.status).toBe(200);
    const reloaded = await createApp(new Store(path)).request('/api/state');
    expect((await reloaded.json() as any).state.layout).toEqual({ positions: { 'p-welcome': { x: 12.5, y: -8 } }, hidden: [], views: [{ id: 'default', name: 'Default', hidden: ['t-welcome'] }, { id: 'focus', name: 'Focus', hidden: [] }], activeViewId: 'focus' });
  });
  it('validates Herdr wrapper inputs before invoking the CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'task-manager-os-herdr-'));
    const app = createApp(new Store(join(dir, 'state.json')));
    const workspace = await app.request('/api/herdr/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: '', cwd: '/definitely/not-a-directory' }) });
    expect(workspace.status).toBe(400);
    expect((await workspace.json() as any).error).toContain('ワークスペース名');
    const agents = await app.request('/api/herdr/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p-welcome', agent: 'shell' }) });
    expect(agents.status).toBe(400);
    expect((await agents.json() as any).error).toContain('agent');
  });
  it('validates Herdr pane names before invoking the CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'task-manager-os-pane-'));
    const path = join(dir, 'state.json');
    const initial = seed();
    initial.projects[0].tasks[0] = { ...initial.projects[0].tasks[0], paneId: 'w-test:p1', workspaceId: 'w-test', agent: 'codex', source: 'herdr' };
    await writeFile(path, JSON.stringify(initial), 'utf8');
    const response = await createApp(new Store(path)).request('/api/herdr/panes/t-welcome', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: '   ' }) });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error).toContain('Herdr pane名');
  });
});
