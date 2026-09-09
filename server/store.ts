import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { apply, seed, type GraphLayout, type GraphView, type State } from '../src/domain.js';
import { mergeHerdr, readHerdrProjects } from './herdr.js';

export class Store {
  private state: State | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}
  async load() {
    await this.queue;
    return structuredClone(await this.loadFromDisk());
  }
  private async loadFromDisk() {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as State;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) throw new Error('invalid');
      const rawLayout = parsed.layout;
      const positions = rawLayout && typeof rawLayout === 'object' && rawLayout.positions && typeof rawLayout.positions === 'object' && !Array.isArray(rawLayout.positions) ? rawLayout.positions : {};
      const hidden = rawLayout && typeof rawLayout === 'object' && Array.isArray(rawLayout.hidden) ? rawLayout.hidden.filter((id): id is string => typeof id === 'string') : [];
      const rawViews = rawLayout && typeof rawLayout === 'object' && Array.isArray(rawLayout.views) ? rawLayout.views.filter((view): view is GraphView => !!view && typeof view === 'object' && typeof (view as any).id === 'string' && typeof (view as any).name === 'string' && Array.isArray((view as any).hidden)) : [];
      const views = rawViews.length ? rawViews.map(view => ({ id: view.id, name: view.name, hidden: view.hidden.filter((id): id is string => typeof id === 'string') })) : [{ id: 'default', name: 'Default', hidden }];
      const activeViewId = rawLayout && typeof rawLayout === 'object' && typeof rawLayout.activeViewId === 'string' && views.some(view => view.id === rawLayout.activeViewId) ? rawLayout.activeViewId : views[0].id;
      const activeHidden = views.find(view => view.id === activeViewId)?.hidden ?? hidden;
      this.state = { ...parsed, layout: { positions, hidden: activeHidden, views, activeViewId } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        try { await rename(this.path, `${this.path}.corrupt-${Date.now()}`); } catch { /* no file to preserve */ }
      }
      this.state = seed();
      await this.write(this.state);
    }
    return this.state;
  }
  execute(command: unknown) {
    const operation = this.queue.then(async () => {
      const current = this.state ?? await this.loadFromDisk();
      const next = apply(current, command);
      await this.write(next);
      this.state = next;
      return structuredClone(next);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  syncHerdr() {
    const operation = this.queue.then(async () => {
      const current = this.state ?? await this.loadFromDisk();
      const next = mergeHerdr(current, readHerdrProjects());
      await this.write(next);
      this.state = next;
      return structuredClone(next);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  updateLayout(layout: GraphLayout) {
    const operation = this.queue.then(async () => {
      const current = this.state ?? await this.loadFromDisk();
      const next = { ...current, layout, revision: current.revision + 1 };
      await this.write(next);
      this.state = next;
      return structuredClone(next);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  private async write(state: State) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }
}
