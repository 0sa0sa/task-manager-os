import { describe, expect, it } from 'vitest';
import { apply, interpretVoice, progress, seed } from '../src/domain';

describe('task domain', () => {
  it('creates a task, preserves one-level subtasks, and undoes the mutation', () => {
    const initial = seed();
    const created = apply(initial, { type: 'task.create', projectId: 'p-welcome', title: 'テストを書く 🚀' });
    const task = created.projects[0].tasks[1];
    const withChild = apply(created, { type: 'subtask.create', projectId: 'p-welcome', taskId: task.id, title: 'CJK / RTL / emoji' });
    expect(withChild.projects[0].tasks[1].subtasks).toHaveLength(1);
    expect(apply(withChild, { type: 'undo' }).projects[0].tasks).toHaveLength(2);
  });
  it('rejects empty and oversized public text', () => {
    expect(() => apply(seed(), { type: 'project.create', name: '  ' })).toThrow();
    expect(() => apply(seed(), { type: 'project.create', name: 'あ'.repeat(121) })).toThrow();
  });
  it('does not guess duplicate voice targets', () => {
    const state = apply(apply(seed(), { type: 'project.create', name: '同じ' }), { type: 'project.create', name: '同じ' });
    expect(interpretVoice('同じにタスク テストを追加', state, null, null).kind).toBe('ambiguous');
  });
  it('turns explicit voice instructions into safe commands', () => {
    const state = seed();
    const result = interpretVoice('Task Manager OSにタスク リリースを追加', state, null, null);
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') expect(result.command.type).toBe('task.create');
  });
  it('does not count Herdr execution evidence as project completion', () => {
    const state = seed();
    state.projects[0].tasks[0].subtasks = [{ id: 'activity-1', title: 'CLI実行: bun test', status: 'done', kind: 'execution', source: 'herdr' }];
    expect(progress(state.projects[0])).toBe(0);
  });
});
