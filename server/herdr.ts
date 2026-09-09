import { execFileSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { COLORS, type Project, type State, type Status, type Task } from '../src/domain.js';

interface Workspace { workspace_id: string; label: string; }
interface Pane { pane_id: string; workspace_id: string; agent?: string; agent_status?: string; cwd?: string; foreground_cwd?: string; label?: string; agent_session?: { value?: string } }
const unwrap = (value: any) => value?.result ?? value;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
function cli(args: string[]): any | null { try { const raw = execFileSync('herdr', args, { encoding: 'utf8', timeout: 3000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); return unwrap(JSON.parse(raw)); } catch { return null; } }
function gitRoot(path?: string) { if (!path) return undefined; try { return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 1200, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; } }
function status(value?: string): Status { return value === 'working' || value === 'blocked' ? 'doing' : value === 'done' ? 'done' : 'todo'; }

export function buildHerdrProjects(workspaces: Workspace[], panes: Pane[]): Project[] {
  const byWorkspace = new Map<string, Pane[]>();
  for (const pane of panes) { if (!pane.agent) continue; const list = byWorkspace.get(pane.workspace_id) ?? []; list.push(pane); byWorkspace.set(pane.workspace_id, list); }
  return workspaces.filter(w => (byWorkspace.get(w.workspace_id)?.length ?? 0) > 0).map((workspace, index) => {
    const workspacePanes = byWorkspace.get(workspace.workspace_id) ?? [];
    const firstPath = workspacePanes.map(p => p.foreground_cwd || p.cwd).map(gitRoot).find(Boolean);
    const tasks: Task[] = workspacePanes.slice(0, 12).map(pane => ({
      id: `herdr-${workspace.workspace_id}-${pane.pane_id.replace(/[^a-zA-Z0-9-]/g, '-')}`,
      title: pane.label || `${pane.agent === 'codex' ? 'Codex' : pane.agent === 'claude' ? 'Claude Code' : 'Agent'} · ${pane.pane_id}`,
      description: `${pane.agent ?? 'agent'} pane ${pane.pane_id}${pane.foreground_cwd ? ` · ${pane.foreground_cwd}` : ''}`,
      status: status(pane.agent_status), subtasks: [], source: 'herdr', paneId: pane.pane_id,
      workspaceId: workspace.workspace_id, agent: pane.agent, agentStatus: pane.agent_status, agentSessionId: pane.agent_session?.value, repoPath: firstPath || pane.foreground_cwd || pane.cwd,
    }));
    return { id: `herdr-${workspace.workspace_id}`, name: workspace.label, color: COLORS[index % COLORS.length], tasks, source: 'herdr', workspaceId: workspace.workspace_id, repoPath: firstPath || workspacePanes[0]?.foreground_cwd || workspacePanes[0]?.cwd };
  });
}

function readPane(paneId: string, lines = 80): string {
  try {
    return execFileSync('herdr', ['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', String(lines), '--format', 'text'], { encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).replace(ANSI_ESCAPE, '').replace(/\r/g, '');
  } catch { return ''; }
}

function summarizePane(text: string): { summary: string; excerpt: string; messages: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> } {
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line.trim());
  const recapIndex = lines.findIndex(line => /(?:※\s*)?recap\s*:/iu.test(line));
  const recap = recapIndex >= 0 ? lines.slice(recapIndex, recapIndex + 4).join(' ').replace(/^.*?recap\s*:\s*/iu, '').trim() : '';
  const meaningful = lines.filter(line => !/^────────────────|^⏵|^⚠|^✻\s+(?:Churned|Conversation compacted)|^─\s*Worked|^›\s*Ask\s+(?:Codex|Claude)\s+to\s+do\s+anything|^\s*$/iu.test(line));
  const excerptLines = meaningful.slice(-36);
  const messages: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> = [];
  let current: { role: 'user' | 'assistant' | 'system'; text: string } | null = null;
  for (const line of excerptLines) {
    const user = line.match(/^(?:❯|›)\s*(.*)$/u);
    const assistant = line.match(/^(?:⏺|●|•)\s*(.*)$/u);
    const role = user ? 'user' : assistant ? 'assistant' : null;
    if (role) { if (current?.text.trim()) messages.push(current); current = { role, text: role === 'user' ? user![1] : assistant![1] }; }
    else if (current) current.text += `\n${line}`;
  }
  if (current?.text.trim()) messages.push(current);
  if (!messages.some(message => message.role === 'assistant')) messages.length = 0;
  const bulletSummary = excerptLines.filter(line => /^(?:⏺|●|•)\s*\S/u.test(line)).slice(-3).map(line => line.replace(/^(?:⏺|●|•)\s*/u, '')).join(' ');
  const summary = (recap || bulletSummary || excerptLines.filter(line => line.length > 24).slice(-3).join(' ')).slice(0, 600) || '直近の会話はまだありません。';
  return { summary, excerpt: excerptLines.join('\n').slice(-6000), messages: messages.slice(-12) };
}

export function readHerdrConversation(task: Task) {
  const raw = task.paneId ? readPane(task.paneId) : '';
  const parsed = summarizePane(raw);
  return { taskId: task.id, paneId: task.paneId || '', agent: task.agent || 'agent', status: task.agentStatus || 'unknown', ...parsed, updatedAt: new Date().toISOString() };
}

export function resumeHerdrConversation(task: Task, message: string): void {
  if (!task.paneId) throw new Error('このタスクには接続されたagent paneがありません');
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 4000) throw new Error('メッセージは1〜4000文字で入力してください');
  try { execFileSync('herdr', ['pane', 'send-text', task.paneId, `${trimmed}\n`], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { throw new Error('agent paneへメッセージを送信できませんでした'); }
}

export function readHerdrProjects(): Project[] {
  const workspaces = cli(['workspace', 'list'])?.workspaces as Workspace[] | undefined;
  const panes = cli(['pane', 'list'])?.panes as Pane[] | undefined;
  if (!Array.isArray(workspaces) || !Array.isArray(panes)) return [];
  return buildHerdrProjects(workspaces, panes);
}

function runHerdr(args: string[], timeout = 15000): unknown {
  try {
    const raw = execFileSync('herdr', args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    try { return unwrap(JSON.parse(raw)); } catch { return raw.trim(); }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Herdr command failed: ${detail}`);
  }
}

function validDirectory(path: string): string {
  const cwd = path.trim() || process.cwd();
  try {
    accessSync(cwd, constants.R_OK);
    if (!statSync(cwd).isDirectory()) throw new Error('not a directory');
  } catch { throw new Error('作業ディレクトリが見つからないか読み込めません'); }
  return cwd;
}

export function createHerdrWorkspace(label: string, cwd?: string): unknown {
  const name = label.trim();
  if (!name || name.length > 120) throw new Error('ワークスペース名は1〜120文字で入力してください');
  return runHerdr(['workspace', 'create', '--cwd', validDirectory(cwd || ''), '--label', name, '--no-focus']);
}

export function startHerdrAgent(agent: 'claude' | 'codex', workspaceId: string, cwd: string | undefined, title: string): unknown {
  if (!/^w[\w-]+$/u.test(workspaceId)) throw new Error('Herdr workspace IDが正しくありません');
  const name = title.trim().slice(0, 120) || `${agent} task`;
  const executable = agent === 'claude' ? 'claude' : 'codex';
  return runHerdr(['agent', 'start', name, '--workspace', workspaceId, '--cwd', validDirectory(cwd || ''), '--no-focus', '--', executable]);
}

export function mergeHerdr(state: State, live: Project[]): State {
  if (!live.length) return state;
  if (state.revision === 0 && state.projects.length === 1 && state.projects[0].id === 'p-welcome') {
    return { ...state, projects: live, revision: state.revision + 1 };
  }
  const liveByWorkspace = new Map(live.map(project => [project.workspaceId || project.name, project]));
  const existingByWorkspace = new Map(state.projects.map(project => [project.workspaceId || project.name, project]));
  const merged = live.map(project => {
    const existing = existingByWorkspace.get(project.workspaceId || project.name);
    if (!existing) return project;
    const manualTasks = existing.tasks.filter(task => task.source !== 'herdr');
    return { ...project, tasks: [...project.tasks, ...manualTasks] };
  });
  const manualProjects = state.projects.filter(project => project.id !== 'p-welcome' && project.source !== 'herdr' && !liveByWorkspace.has(project.workspaceId || project.name));
  const projects = [...merged, ...manualProjects];
  if (JSON.stringify(projects) === JSON.stringify(state.projects)) return state;
  return { ...state, projects, revision: state.revision + 1 };
}
