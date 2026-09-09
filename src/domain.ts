export type Status = 'todo' | 'doing' | 'done';
export type SubtaskKind = 'execution' | 'delegation';
export interface Subtask { id: string; title: string; status: Status; source?: 'manual' | 'herdr'; kind?: SubtaskKind; actor?: string; command?: string; output?: string; delegatedTo?: string }
export interface Task { id: string; title: string; description: string; status: Status; subtasks: Subtask[]; source?: 'manual' | 'herdr'; paneId?: string; workspaceId?: string; agent?: string; agentStatus?: string; agentSessionId?: string; repoPath?: string }
export interface Project { id: string; name: string; color: string; tasks: Task[]; source?: 'manual' | 'herdr'; workspaceId?: string; repoPath?: string }
export interface GraphView { id: string; name: string; hidden: string[] }
export interface GraphLayout { positions: Record<string, { x: number; y: number }>; hidden: string[]; views?: GraphView[]; activeViewId?: string }
export interface ConversationMessage { role: 'user' | 'assistant' | 'system'; text: string }
export interface ConversationSnapshot { taskId: string; paneId: string; agent: string; status: string; summary: string; excerpt: string; messages: ConversationMessage[]; updatedAt: string }
export interface State { version: 1; revision: number; projects: Project[]; undo: Project[] | null; layout?: GraphLayout }
export type Command =
  | { type: 'project.create'; name: string; color?: string }
  | { type: 'project.rename'; projectId: string; name: string }
  | { type: 'project.delete'; projectId: string }
  | { type: 'task.create'; projectId: string; title: string }
  | { type: 'task.rename'; projectId: string; taskId: string; title: string }
  | { type: 'task.describe'; projectId: string; taskId: string; description: string }
  | { type: 'task.status'; projectId: string; taskId: string; status: Status }
  | { type: 'task.delete'; projectId: string; taskId: string }
  | { type: 'task.move'; projectId: string; taskId: string; toProjectId: string }
  | { type: 'subtask.create'; projectId: string; taskId: string; title: string }
  | { type: 'subtask.status'; projectId: string; taskId: string; subtaskId: string; status: Status }
  | { type: 'subtask.delete'; projectId: string; taskId: string; subtaskId: string }
  | { type: 'undo' };
export const COLORS = ['#ee7657', '#42b7a6', '#e8b84b', '#7896f6', '#b989b1', '#7ab77d'];
export const statusLabel = (s: Status) => ({ todo: 'To do', doing: 'In progress', done: 'Done' }[s]);
export const progress = (p: Project) => { const all = p.tasks.flatMap(t => [t, ...t.subtasks.filter(subtask => !subtask.kind)]); return all.length ? all.filter(x => x.status === 'done').length / all.length : 0; };
export const seed = (): State => ({ version: 1, revision: 0, undo: null, layout: { positions: {}, hidden: [], views: [{ id: 'default', name: 'Default', hidden: [] }], activeViewId: 'default' }, projects: [{ id: 'p-welcome', name: 'Task Manager OS', color: COLORS[0], tasks: [{ id: 't-welcome', title: '声で最初のタスクを追加する', description: 'コマンドバーで「Task Manager OSにタスク テストを追加」と話してみましょう。', status: 'todo', subtasks: [] }] }] });
const clone = <T,>(v: T): T => structuredClone(v);
const text = (v: unknown, label: string, max = 120) => { if (typeof v !== 'string' || !v.trim() || [...v.trim()].length > max) throw new Error(`${label}は1〜${max}文字で入力してください`); return v.trim(); };
const id = (v: unknown, label: string) => text(v, label, 200);
const status = (v: unknown): Status => { if (v !== 'todo' && v !== 'doing' && v !== 'done') throw new Error('ステータスが正しくありません'); return v; };
export function parseCommand(v: unknown): Command {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof (v as any).type !== 'string') throw new Error('コマンド形式が正しくありません');
  const c = v as any;
  switch (c.type) {
    case 'project.create': return { type: c.type, name: text(c.name, 'プロジェクト名'), ...(c.color ? { color: text(c.color, '色', 32) } : {}) };
    case 'project.rename': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), name: text(c.name, 'プロジェクト名') };
    case 'project.delete': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID') };
    case 'task.create': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), title: text(c.title, 'タスク名') };
    case 'task.rename': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), title: text(c.title, 'タスク名') };
    case 'task.describe': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), description: typeof c.description === 'string' && [...c.description.trim()].length <= 2000 ? c.description.trim() : (() => { throw new Error('説明は2000文字以内で入力してください') })() };
    case 'task.status': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), status: status(c.status) };
    case 'task.delete': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID') };
    case 'task.move': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), toProjectId: id(c.toProjectId, '移動先ID') };
    case 'subtask.create': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), title: text(c.title, 'サブタスク名') };
    case 'subtask.status': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), subtaskId: id(c.subtaskId, 'サブタスクID'), status: status(c.status) };
    case 'subtask.delete': return { type: c.type, projectId: id(c.projectId, 'プロジェクトID'), taskId: id(c.taskId, 'タスクID'), subtaskId: id(c.subtaskId, 'サブタスクID') };
    case 'undo': return { type: 'undo' };
    default: throw new Error('未対応のコマンドです');
  }
}
function project(s: State, id_: string) { const p = s.projects.find(x => x.id === id_); if (!p) throw new Error('プロジェクトが見つかりません'); return p; }
function task(p: Project, id_: string) { const t = p.tasks.find(x => x.id === id_); if (!t) throw new Error('タスクが見つかりません'); return t; }
function uid(s: State) { const used = new Set(s.projects.flatMap(p => [p.id, ...p.tasks.flatMap(t => [t.id, ...t.subtasks.map(x => x.id)])])); let x = crypto.randomUUID(); while (used.has(x)) x = crypto.randomUUID(); return x; }
export function apply(state: State, raw: unknown): State {
  const c = parseCommand(raw); if (c.type === 'undo') { if (!state.undo) throw new Error('戻せる操作がありません'); return { ...state, revision: state.revision + 1, projects: clone(state.undo), undo: clone(state.projects) }; }
  const before = clone(state.projects), id_ = () => uid(state); let ps = state.projects;
  switch (c.type) {
    case 'project.create': ps = [...ps, { id: id_(), name: c.name, color: c.color ?? COLORS[ps.length % COLORS.length], tasks: [] }]; break;
    case 'project.rename': { const p = project(state, c.projectId); ps = ps.map(x => x.id === p.id ? { ...x, name: c.name } : x); break; }
    case 'project.delete': project(state, c.projectId); ps = ps.filter(x => x.id !== c.projectId); break;
    case 'task.create': { const p = project(state, c.projectId); ps = ps.map(x => x.id === p.id ? { ...x, tasks: [...x.tasks, { id: id_(), title: c.title, description: '', status: 'todo', subtasks: [] }] } : x); break; }
    case 'task.rename': { const p = project(state, c.projectId); task(p, c.taskId); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.map(t => t.id === c.taskId ? { ...t, title: c.title } : t) } : x); break; }
    case 'task.describe': { const p = project(state, c.projectId); task(p, c.taskId); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.map(t => t.id === c.taskId ? { ...t, description: c.description } : t) } : x); break; }
    case 'task.status': { const p = project(state, c.projectId); task(p, c.taskId); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.map(t => t.id === c.taskId ? { ...t, status: c.status } : t) } : x); break; }
    case 'task.delete': { const p = project(state, c.projectId); task(p, c.taskId); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.filter(t => t.id !== c.taskId) } : x); break; }
    case 'task.move': { const from = project(state, c.projectId), to = project(state, c.toProjectId); if (from.id === to.id) throw new Error('同じプロジェクトです'); const t = task(from, c.taskId); ps = ps.map(x => x.id === from.id ? { ...x, tasks: x.tasks.filter(y => y.id !== t.id) } : x.id === to.id ? { ...x, tasks: [...x.tasks, t] } : x); break; }
    case 'subtask.create': { const p = project(state, c.projectId), t = task(p, c.taskId); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.map(y => y.id === t.id ? { ...y, subtasks: [...y.subtasks, { id: id_(), title: c.title, status: 'todo' }] } : y) } : x); break; }
    case 'subtask.status': { const p = project(state, c.projectId), t = task(p, c.taskId); if (!t.subtasks.some(x => x.id === c.subtaskId)) throw new Error('サブタスクが見つかりません'); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.map(y => y.id === t.id ? { ...y, subtasks: y.subtasks.map(z => z.id === c.subtaskId ? { ...z, status: c.status } : z) } : y) } : x); break; }
    case 'subtask.delete': { const p = project(state, c.projectId), t = task(p, c.taskId); if (!t.subtasks.some(x => x.id === c.subtaskId)) throw new Error('サブタスクが見つかりません'); ps = ps.map(x => x.id === p.id ? { ...x, tasks: x.tasks.map(y => y.id === t.id ? { ...y, subtasks: y.subtasks.filter(z => z.id !== c.subtaskId) } : y) } : x); break; }
  }
  return { ...state, revision: state.revision + 1, projects: ps, undo: before };
}

export type Interpretation = { kind: 'ready'; command: Command; summary: string; destructive?: boolean } | { kind: 'unknown' | 'ambiguous'; message: string };
const cmp = (s: string) => s.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s　「」『』]/gu, '');
const named = <T,>(items: T[], value: string, get: (x: T) => string): T | 'ambiguous' | null => { const found = items.filter(x => cmp(get(x)) === cmp(value)); return found.length === 1 ? found[0] : found.length ? 'ambiguous' : null; };
export function interpretVoice(raw: string, state: State, selectedProjectId: string | null, selectedTaskId: string | null): Interpretation {
  const input = raw.normalize('NFKC').trim().replace(/[。！!]+$/u, '').replace(/(?:してください|して下さい|して)$/u, '').trim();
  if (!input) return { kind: 'unknown', message: 'コマンドを入力してください' };
  if (/^(?:元に戻す|取り消し|undo)$/iu.test(input)) return { kind: 'ready', command: { type: 'undo' }, summary: '直前の操作を元に戻す' };
  let m = input.match(/^プロジェクト[「『]?(.+?)[」』]?を(?:作成|追加)$/u);
  if (m) return { kind: 'ready', command: { type: 'project.create', name: m[1].trim() }, summary: `プロジェクト「${m[1].trim()}」を作成` };
  m = input.match(/^(.+?)にタスク[「『]?(.+?)[」』]?を(?:追加|作成)$/u);
  if (m) { const p = named(state.projects, m[1], x => x.name); if (p === 'ambiguous') return { kind: 'ambiguous', message: 'プロジェクト名が複数あります' }; if (!p) return { kind: 'unknown', message: 'プロジェクトが見つかりません' }; return { kind: 'ready', command: { type: 'task.create', projectId: p.id, title: m[2].trim() }, summary: `${p.name}に「${m[2].trim()}」を追加` }; }
  const selected = selectedProjectId && selectedTaskId ? state.projects.find(p => p.id === selectedProjectId)?.tasks.find(t => t.id === selectedTaskId) : undefined;
  m = input.match(/^(?:この)?タスクにサブタスク[「『]?(.+?)[」』]?を(?:追加|作成)$/u);
  if (m) { if (!selected || !selectedProjectId) return { kind: 'unknown', message: '先に親タスクを選択してください' }; return { kind: 'ready', command: { type: 'subtask.create', projectId: selectedProjectId, taskId: selected.id, title: m[1].trim() }, summary: `${selected.title}にサブタスクを追加` }; }
  const statusValue = (v: string): Status | null => /^(?:完了|done|済み)$/iu.test(cmp(v)) ? 'done' : /^(?:進行中|作業中|inprogress)$/iu.test(cmp(v)) ? 'doing' : /^(?:未着手|todo)$/iu.test(cmp(v)) ? 'todo' : null;
  m = input.match(/^(?:この)?タスクを(.+?)(?:に変更|にする)?$/u);
  if (m && statusValue(m[1])) { if (!selected || !selectedProjectId) return { kind: 'unknown', message: '先にタスクを選択してください' }; return { kind: 'ready', command: { type: 'task.status', projectId: selectedProjectId, taskId: selected.id, status: statusValue(m[1])! }, summary: `${selected.title}を${m[1]}に変更` }; }
  m = input.match(/^タスク[「『]?(.+?)[」』]?を(.+?)(?:に変更|にする)?$/u);
  if (m && statusValue(m[2])) { const candidates = state.projects.flatMap(p => p.tasks.map(t => ({ p, t }))).filter(x => !selectedProjectId || x.p.id === selectedProjectId); const found = named(candidates, m[1], x => x.t.title); if (found === 'ambiguous') return { kind: 'ambiguous', message: 'タスク名が複数あります' }; if (!found) return { kind: 'unknown', message: 'タスクが見つかりません' }; return { kind: 'ready', command: { type: 'task.status', projectId: found.p.id, taskId: found.t.id, status: statusValue(m[2])! }, summary: `${found.t.title}を${m[2]}に変更` }; }
  if (/^(?:この)?タスクを削除$/u.test(input)) { if (!selected || !selectedProjectId) return { kind: 'unknown', message: '先に削除するタスクを選択してください' }; return { kind: 'ready', command: { type: 'task.delete', projectId: selectedProjectId, taskId: selected.id }, summary: `${selected.title}を削除`, destructive: true }; }
  return { kind: 'unknown', message: '例:「Task Manager OSにタスク テストを追加」' };
}
