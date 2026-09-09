import { execFileSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { basename } from 'node:path';
import { COLORS, type Project, type State, type Status, type Task } from '../src/domain.js';

interface Workspace { workspace_id: string; label: string; }
interface Pane { pane_id: string; workspace_id: string; agent?: string; agent_status?: string; cwd?: string; foreground_cwd?: string; label?: string; agent_session?: { value?: string } }
const unwrap = (value: any) => value?.result ?? value;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
function cli(args: string[]): any | null { try { const raw = execFileSync('herdr', args, { encoding: 'utf8', timeout: 3000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); return unwrap(JSON.parse(raw)); } catch { return null; } }
function gitRoot(path?: string) { if (!path) return undefined; try { return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 1200, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; } }
function gitBranch(path?: string) { if (!path) return undefined; try { return execFileSync('git', ['-C', path, 'branch', '--show-current'], { encoding: 'utf8', timeout: 1200, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; } }
function status(value?: string): Status { return value === 'working' || value === 'blocked' ? 'doing' : value === 'done' ? 'done' : 'todo'; }

const agentLabel = (agent?: string) => agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude Code' : 'Agent';
const genericPaneLabel = (label: string | undefined, paneId: string) => {
  const value = label?.trim() || '';
  if (!value) return true;
  if (value === paneId || value.includes(paneId)) return true;
  return /^(?:claude(?:\s+code)?|codex|agent)(?:\s*[·:/-].*)?$/iu.test(value) || /(?:handoff|forked)/iu.test(value);
};
const paneHintCache = new Map<string, { at: number; value?: string }>();
function paneTaskHint(paneId: string): string | undefined {
  const cached = paneHintCache.get(paneId);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  try {
    const raw = execFileSync('herdr', ['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', '24', '--format', 'text'], { encoding: 'utf8', timeout: 1500, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = raw.replace(ANSI_ESCAPE, '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
    const recap = lines.find(line => /(?:※\s*)?recap\s*:/iu.test(line))?.replace(/^.*?(?:※\s*)?recap\s*:\s*/iu, '').trim();
    if (recap && !/^ask\s+(?:codex|claude)\s+to\s+do\s+anything/iu.test(recap)) {
      const value = recap.replace(/\s+/gu, ' ').slice(0, 96).trim();
      paneHintCache.set(paneId, { at: Date.now(), value });
      return value;
    }
    const prompts = lines.filter(line => /^(?:❯|›)\s*\S/u.test(line) && !/^›\s*Ask\s+(?:Codex|Claude)\s+to\s+do\s+anything/iu.test(line)).map(line => line.replace(/^(?:❯|›)\s*/u, '').trim());
    const value = prompts.at(-1)?.replace(/\s+/gu, ' ').slice(0, 96).trim() || undefined;
    paneHintCache.set(paneId, { at: Date.now(), value });
    return value;
  } catch {
    paneHintCache.set(paneId, { at: Date.now() });
    return undefined;
  }
}

/**
 * Herdr's automatic labels are useful for the terminal, but are not task names.
 * Keep the source label intact and derive a stable, human-readable title for the
 * graph from the pane label, worktree directory, and current branch.
 */
export function friendlyPaneTitle(pane: Pane): string {
  const cwd = pane.foreground_cwd || pane.cwd;
  const root = gitRoot(cwd) || cwd;
  const folder = root ? basename(root) : '';
  const branch = gitBranch(cwd);
  const label = pane.label?.trim();
  if (genericPaneLabel(label, pane.pane_id)) {
    const hint = paneTaskHint(pane.pane_id);
    if (hint) return `${agentLabel(pane.agent)} · ${hint}`;
  }
  const context = branch && branch !== 'main' && branch !== 'master'
    ? `${folder || 'workspace'} / ${branch}`
    : folder || branch || pane.pane_id;
  return genericPaneLabel(label, pane.pane_id)
    ? `${agentLabel(pane.agent)} · ${context}`
    : `${label} · ${context}`;
}

export function buildHerdrProjects(workspaces: Workspace[], panes: Pane[]): Project[] {
  const byWorkspace = new Map<string, Pane[]>();
  for (const pane of panes) { if (!pane.agent) continue; const list = byWorkspace.get(pane.workspace_id) ?? []; list.push(pane); byWorkspace.set(pane.workspace_id, list); }
  return workspaces.filter(w => (byWorkspace.get(w.workspace_id)?.length ?? 0) > 0).map((workspace, index) => {
    const workspacePanes = byWorkspace.get(workspace.workspace_id) ?? [];
    const firstPath = workspacePanes.map(p => p.foreground_cwd || p.cwd).map(gitRoot).find(Boolean);
    const titleCounts = new Map<string, number>();
    const tasks: Task[] = workspacePanes.slice(0, 12).map(pane => {
      const branch = gitBranch(pane.foreground_cwd || pane.cwd);
      const baseTitle = friendlyPaneTitle(pane);
      const count = titleCounts.get(baseTitle) ?? 0;
      titleCounts.set(baseTitle, count + 1);
      return {
        id: `herdr-${workspace.workspace_id}-${pane.pane_id.replace(/[^a-zA-Z0-9-]/g, '-')}`,
        title: count ? `${baseTitle} · ${pane.pane_id}` : baseTitle,
        description: `${agentLabel(pane.agent)} · Herdr pane ${pane.pane_id}${pane.foreground_cwd ? ` · ${pane.foreground_cwd}` : ''}${branch ? ` · branch ${branch}` : ''}`,
        status: status(pane.agent_status), subtasks: [], source: 'herdr', paneId: pane.pane_id,
        workspaceId: workspace.workspace_id, agent: pane.agent, agentStatus: pane.agent_status, agentSessionId: pane.agent_session?.value, repoPath: firstPath || pane.foreground_cwd || pane.cwd,
      };
    });
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

export async function resumeHerdrConversation(task: Task, message: string): Promise<void> {
  if (!task.paneId) throw new Error('このタスクには接続されたagent paneがありません');
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 4000) throw new Error('メッセージは1〜4000文字で入力してください');
  try {
    // send-text writes literal text. Enter is a separate key event in Herdr;
    // sending both makes the action equivalent to typing a prompt and pressing
    // Enter in the local agent pane.
    execFileSync('herdr', ['pane', 'send-text', task.paneId, trimmed], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise(resolve => setTimeout(resolve, 120));
    execFileSync('herdr', ['pane', 'send-keys', task.paneId, 'enter'], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  }
  catch { throw new Error('local Herdr paneへメッセージを送信できませんでした'); }
}

export function renameHerdrPane(task: Task, label: string): unknown {
  if (!task.paneId) throw new Error('このタスクには接続されたagent paneがありません');
  const next = label.trim();
  if (!next || next.length > 120) throw new Error('Herdr pane名は1〜120文字で入力してください');
  try { return runHerdr(['pane', 'rename', task.paneId, next]); }
  catch { throw new Error('Herdr pane名を更新できませんでした'); }
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
