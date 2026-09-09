import { Hono } from 'hono';
import { createHerdrWorkspace, readHerdrConversation, resumeHerdrConversation, startHerdrAgent } from './herdr.js';
import type { GraphLayout, GraphView, Task } from '../src/domain.js';
import type { Store } from './store.js';
export function createApp(store: Store) {
  const app = new Hono();
  app.get('/api/health', c => c.json({ ok: true, service: 'task-manager-os', runtime: 'bun' }));
  app.get('/api/state', async c => c.json({ ok: true, state: await store.load() }));
  app.post('/api/herdr/sync', async c => {
    try { return c.json({ ok: true, state: await store.syncHerdr() }); }
    catch { return c.json({ ok: false, error: 'Herdrの読み込みに失敗しました' }, 502); }
  });
  app.post('/api/herdr/workspaces', async c => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'JSON形式が正しくありません' }, 400); }
    const raw = body && typeof body === 'object' ? body as any : {};
    try { createHerdrWorkspace(typeof raw.label === 'string' ? raw.label : '', typeof raw.cwd === 'string' ? raw.cwd : undefined); return c.json({ ok: true, state: await store.syncHerdr() }); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Herdr workspaceを作成できませんでした';
      const status = /入力してください|作業ディレクトリが見つかりません/u.test(message) ? 400 : 502;
      return c.json({ ok: false, error: message }, status);
    }
  });
  app.post('/api/herdr/agents', async c => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'JSON形式が正しくありません' }, 400); }
    const raw = body && typeof body === 'object' ? body as any : {};
    const agent = raw.agent === 'claude' || raw.agent === 'codex' ? raw.agent : null;
    const projectId = typeof raw.projectId === 'string' ? raw.projectId : '';
    if (!agent || !projectId) return c.json({ ok: false, error: 'projectIdとagent（claudeまたはcodex）が必要です' }, 400);
    const state = await store.load();
    const project = state.projects.find(item => item.id === projectId);
    if (!project?.workspaceId) return c.json({ ok: false, error: 'Herdr workspaceに紐づいたプロジェクトを選択してください' }, 400);
    try { startHerdrAgent(agent, project.workspaceId, project.repoPath, typeof raw.title === 'string' ? raw.title : ''); return c.json({ ok: true, state: await store.syncHerdr() }); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'agent paneを開始できませんでした' }, 502); }
  });
  const findTask = async (id: string): Promise<Task | null> => {
    const state = await store.load();
    for (const project of state.projects) { const task = project.tasks.find(item => item.id === id); if (task) return task; }
    return null;
  };
  app.get('/api/conversations/:taskId', async c => {
    const task = await findTask(c.req.param('taskId'));
    if (!task) return c.json({ ok: false, error: 'タスクが見つかりません' }, 404);
    if (!task.paneId || (task.agent !== 'claude' && task.agent !== 'codex')) return c.json({ ok: false, error: 'このタスクにはClaude CodeまたはCodexのpaneがありません' }, 404);
    return c.json({ ok: true, conversation: readHerdrConversation(task) });
  });
  app.post('/api/conversations/:taskId', async c => {
    const task = await findTask(c.req.param('taskId'));
    if (!task) return c.json({ ok: false, error: 'タスクが見つかりません' }, 404);
    if (!task.paneId || (task.agent !== 'claude' && task.agent !== 'codex')) return c.json({ ok: false, error: 'このタスクにはClaude CodeまたはCodexのpaneがありません' }, 404);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'JSON形式が正しくありません' }, 400); }
    const message = body && typeof body === 'object' && typeof (body as any).message === 'string' ? (body as any).message : '';
    try { resumeHerdrConversation(task, message); return c.json({ ok: true, conversation: readHerdrConversation(task) }); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : '会話を再開できませんでした' }, 502); }
  });
  app.put('/api/layout', async c => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'JSON形式が正しくありません' }, 400); }
    const raw = body && typeof body === 'object' ? body as any : {};
    const positions: GraphLayout['positions'] = {};
    if (raw.positions && typeof raw.positions === 'object' && !Array.isArray(raw.positions)) for (const [id, point] of Object.entries(raw.positions)) if (/^[\w:.-]{1,180}$/u.test(id) && point && typeof point === 'object' && Number.isFinite((point as any).x) && Number.isFinite((point as any).y)) positions[id] = { x: Math.max(-5000, Math.min(5000, Number((point as any).x))), y: Math.max(-5000, Math.min(5000, Number((point as any).y))) };
    const hidden: string[] = Array.isArray(raw.hidden) ? Array.from(new Set<string>(raw.hidden.filter((id: unknown): id is string => typeof id === 'string' && /^[\w:.-]{1,180}$/u.test(id)))).slice(0, 5000) : [];
    const views: GraphView[] = Array.isArray(raw.views) ? raw.views.filter((view: unknown): view is GraphView => !!view && typeof view === 'object' && typeof (view as any).id === 'string' && /^[\w:.-]{1,80}$/u.test((view as any).id) && typeof (view as any).name === 'string' && (view as any).name.trim().length > 0 && (view as any).name.trim().length <= 80 && Array.isArray((view as any).hidden)).slice(0, 30).map((view: GraphView) => ({ id: view.id, name: view.name.trim(), hidden: Array.from(new Set<string>(view.hidden.filter((id: unknown): id is string => typeof id === 'string' && /^[\w:.-]{1,180}$/u.test(id)))).slice(0, 5000) })) : [];
    const normalizedViews = views.length ? views : [{ id: 'default', name: 'Default', hidden }];
    const activeViewId = typeof raw.activeViewId === 'string' && normalizedViews.some(view => view.id === raw.activeViewId) ? raw.activeViewId : normalizedViews[0].id;
    const activeHidden = normalizedViews.find(view => view.id === activeViewId)?.hidden ?? hidden;
    return c.json({ ok: true, state: await store.updateLayout({ positions, hidden: activeHidden, views: normalizedViews, activeViewId }) });
  });
  app.post('/api/commands', async c => {
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) return c.json({ ok: false, error: 'リクエストが大きすぎます' }, 413);
    let command: unknown;
    try { command = JSON.parse(raw); } catch { return c.json({ ok: false, error: 'JSON形式が正しくありません' }, 400); }
    try { return c.json({ ok: true, state: await store.execute(command) }); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : '操作に失敗しました' }, 400); }
  });
  app.notFound(c => c.json({ ok: false, error: 'Not found' }, 404));
  return app;
}
