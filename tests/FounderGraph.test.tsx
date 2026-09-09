/** @vitest-environment jsdom */
import { fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FounderGraph } from '../src/FounderGraph';
import type { GraphLayout, State } from '../src/domain';

const layout: GraphLayout = { positions: {}, hidden: [], views: [{ id: 'default', name: 'Default', hidden: [] }], activeViewId: 'default' };
const state: State = {
  version: 1,
  revision: 0,
  undo: null,
  layout,
  projects: [
    { id: 'project-1', name: 'Demo', color: '#42b7a6', source: 'herdr', tasks: [{ id: 'task-1', title: 'CLI task', description: '', status: 'doing', subtasks: [{ id: 'sub-1', title: 'CLI実行: bun test', status: 'done', source: 'herdr', kind: 'execution', actor: 'codex', command: 'bun test' }, { id: 'sub-2', title: 'サブエージェント委任: Explore', status: 'done', source: 'herdr', kind: 'delegation', delegatedTo: 'Explore' }] }] },
    { id: 'project-2', name: 'Other', color: '#e8b84b', source: 'herdr', tasks: [] },
  ],
};

const props = (overrides: Partial<ComponentProps<typeof FounderGraph>> = {}) => ({
  state,
  layout,
  projectId: null,
  taskId: null,
  filterProjectId: null,
  onProject: vi.fn(),
  onTask: vi.fn(),
  onFilterProject: vi.fn(),
  onLayoutChange: vi.fn(),
  ...overrides,
});

describe('FounderGraph work-item interaction', () => {
  it('highlights and selects a subtask like a task node', () => {
    const callbacks = props();
    const { container } = render(<FounderGraph {...callbacks} />);
    const node = container.querySelector('[data-node-id="sub-1"]') as SVGGElement;
    expect(node).toBeTruthy();
    fireEvent.pointerEnter(node);
    expect(node.getAttribute('class')).toContain('is-hovered');
    fireEvent.click(node);
    expect(callbacks.onProject).toHaveBeenCalledWith('project-1');
    expect(callbacks.onTask).toHaveBeenCalledWith('sub-1');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(callbacks.onTask).toHaveBeenCalledTimes(2);
  });

  it('exposes the project-centered animated focus mode', () => {
    const { container, getByText } = render(<FounderGraph {...props({ projectId: 'project-1', filterProjectId: 'project-1' })} />);
    expect(container.querySelector('.founder-graph')?.className).toContain('is-focus-mode');
    expect(getByText('FOCUS · Demo · PROJECT CENTER')).toBeTruthy();
    expect(container.querySelector('[data-node-id="project-1"]')?.getAttribute('transform')).toBe('translate(440 300)');
    expect(container.querySelector('[data-node-id="project-2"]')).toBeNull();
    expect(container.querySelector('[data-node-id="hub"]')).toBeTruthy();
    expect(container.querySelector('[data-node-id="task-1"]')?.textContent).toContain('CLI task');
  });

  it('opens the project-only filter from the project context menu', () => {
    const callbacks = props();
    const { container, getByRole } = render(<FounderGraph {...callbacks} />);
    fireEvent.contextMenu(container.querySelector('[data-node-id="project-1"]') as SVGGElement, { clientX: 10, clientY: 20 });
    fireEvent.click(getByRole('button', { name: 'このプロジェクトだけに絞る' }));
    expect(callbacks.onFilterProject).toHaveBeenCalledWith('project-1');
    expect(callbacks.onProject).toHaveBeenCalledWith('project-1');
    expect(callbacks.onTask).toHaveBeenCalledWith(null);
  });
});
