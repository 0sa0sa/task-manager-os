import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent,
} from "react";
import {
  ClipboardList,
  FolderKanban,
  GitBranch,
  Maximize2,
  Minimize2,
  Sparkles,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { progress, statusLabel, type GraphLayout, type State } from "./domain";

const W = 880,
  H = 600,
  CX = W / 2,
  CY = H / 2,
  RP = 158,
  RT = 252,
  RS = 330;
type Pos = { x: number; y: number };
type View = { x: number; y: number; w: number; h: number };
type Placed = {
  project: State["projects"][number];
  angle: number;
  pos: Pos;
  tasks: Array<{
    task: State["projects"][number]["tasks"][number];
    pos: Pos;
    subtasks: Array<{
      subtask: State["projects"][number]["tasks"][number]["subtasks"][number];
      pos: Pos;
    }>;
  }>;
};
const polar = (r: number, angle: number): Pos => ({
  x: CX + Math.cos((angle * Math.PI) / 180) * r,
  y: CY + Math.sin((angle * Math.PI) / 180) * r,
});
const curve = (a: Pos, b: Pos) => {
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2,
    dx = b.x - a.x,
    dy = b.y - a.y,
    distance = Math.hypot(dx, dy) || 1,
    bend = Math.min(28, distance * 0.08);
  return `M ${a.x} ${a.y} Q ${mx - (dy / distance) * bend} ${my + (dx / distance) * bend} ${b.x} ${b.y}`;
};
const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const taskGraphLabel = (title: string) => {
  const withoutAgent = title.replace(/^(?:Claude Code|Codex|Agent)\s*·\s*/u, "");
  return short(withoutAgent, 32);
};

interface Props {
  state: State;
  layout: GraphLayout;
  projectId: string | null;
  taskId: string | null;
  filterProjectId: string | null;
  onProject: (id: string | null) => void;
  onTask: (id: string | null) => void;
  onFilterProject: (id: string | null) => void;
  onLayoutChange: (layout: GraphLayout) => void;
}

export function FounderGraph({
  state,
  layout,
  projectId,
  taskId,
  filterProjectId,
  onProject,
  onTask,
  onFilterProject,
  onLayoutChange,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<View>({
    x: -W * 0.03,
    y: -H * 0.03,
    w: W * 1.06,
    h: H * 1.06,
  });
  const viewRef = useRef<View>({
    x: -W * 0.03,
    y: -H * 0.03,
    w: W * 1.06,
    h: H * 1.06,
  });
  const [offsets, setOffsets] = useState<Record<string, Pos>>(layout.positions);
  const offsetsRef = useRef<Record<string, Pos>>(layout.positions);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; kind: "canvas" | "project" | "task" | "subtask"; id?: string; label: string } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pan = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const nodeDrag = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const activeView = useMemo(() => layout.views?.find(view => view.id === layout.activeViewId) ?? layout.views?.[0], [layout.views, layout.activeViewId]);
  const currentHidden = activeView?.hidden ?? layout.hidden;
  const hiddenSet = useMemo(() => new Set(currentHidden), [currentHidden]);

  useEffect(() => {
    offsetsRef.current = layout.positions;
    setOffsets(layout.positions);
  }, [layout.positions]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  const placed = useMemo<Placed[]>(
    () =>
      state.projects.map((project, index) => {
        const angle = -90 + (index * 360) / Math.max(1, state.projects.length);
        const centered = project.id === filterProjectId;
        const projectPosition = centered ? { x: CX, y: CY } : polar(RP, angle);
        const focused = project.id === projectId;
        const tucked = !!projectId && !focused;
        const taskRadius = centered ? RT + 16 : focused ? RT + 34 : tucked ? RT - 46 : RT;
        const taskSpread = centered ? 360 : focused ? 104 : tucked ? 18 : 46;
        const tasks = project.tasks.map((task, taskIndex) => {
          const taskAngle =
            (centered ? -90 : angle) +
            (project.tasks.length === 1
              ? 0
              : centered
                ? (taskIndex * taskSpread) / project.tasks.length
                : -taskSpread / 2 + (taskIndex * taskSpread) / (project.tasks.length - 1));
          const taskPosition = polar(taskRadius, taskAngle);
          const subRadius = centered ? RS - 18 : focused ? RS + 22 : tucked ? RS - 68 : RS;
          const subSpread = centered ? 72 : focused ? 58 : tucked ? 12 : 26;
          const subtasks = task.subtasks.map((subtask, subIndex) => ({
            subtask,
            pos: polar(
              subRadius,
              taskAngle +
                (task.subtasks.length === 1
                  ? 0
                  : -subSpread / 2 +
                    (subIndex * subSpread) / (task.subtasks.length - 1)),
            ),
          }));
          return { task, pos: taskPosition, subtasks };
        });
        return { project, angle, pos: projectPosition, tasks };
      }),
    [state.projects, projectId, filterProjectId],
  );
  const visiblePlaced = useMemo(
    () => filterProjectId ? placed.filter((item) => item.project.id === filterProjectId) : placed,
    [filterProjectId, placed],
  );

  const position = (id: string, base: Pos): Pos => {
    // A project filter is an intentional presentation mode: keep the selected
    // project and its work items on the deterministic orbit, even when the
    // overview has saved manual offsets. Clearing the filter restores those
    // offsets without mutating the user's layout.
    if (filterProjectId) return base;
    return offsets[id]
      ? { x: base.x + offsets[id].x, y: base.y + offsets[id].y }
      : base;
  };
  const activeProject = placed.find((item) => item.project.id === projectId);
  const activeTask = activeProject?.tasks.find(
    (item) => item.task.id === taskId,
  );
  const activeSubtask = activeProject?.tasks
    .flatMap((item) => item.subtasks)
    .find((item) => item.subtask.id === taskId);
  const activeProjectPos = useMemo(
    () => {
      if (!activeProject) return undefined;
      if (filterProjectId === activeProject.project.id) return activeProject.pos;
      const delta = offsets[activeProject.project.id];
      return delta ? { x: activeProject.pos.x + delta.x, y: activeProject.pos.y + delta.y } : activeProject.pos;
    },
    [activeProject, offsets, filterProjectId],
  );
  const activeWorkPos = useMemo(
    () => {
      const item = activeTask
        ? { id: activeTask.task.id, pos: activeTask.pos }
        : activeSubtask
          ? { id: activeSubtask.subtask.id, pos: activeSubtask.pos }
          : undefined;
      if (!item) return undefined;
      if (filterProjectId) return item.pos;
      const delta = offsets[item.id];
      return delta ? { x: item.pos.x + delta.x, y: item.pos.y + delta.y } : item.pos;
    },
    [activeTask, activeSubtask, offsets, filterProjectId],
  );
  const hoverChain = useMemo(() => {
    if (!hoverId) return null;
    const found =
    visiblePlaced.find((item) => item.project.id === hoverId) ||
      visiblePlaced.find((item) =>
        item.tasks.some(
          (task) =>
            task.task.id === hoverId ||
            task.subtasks.some((sub) => sub.subtask.id === hoverId),
        ),
      );
    return found
      ? new Set([
          "hub",
          found.project.id,
          ...found.tasks.map((item) => item.task.id),
          hoverId,
        ])
      : new Set(["hub", hoverId]);
  }, [hoverId, visiblePlaced]);
  const focusChain = useMemo(() => {
    if (!projectId || !activeProject) return null;
    return new Set([
      activeProject.project.id,
      ...activeProject.tasks.flatMap((item) => [
        item.task.id,
        ...item.subtasks.map((sub) => sub.subtask.id),
      ]),
    ]);
  }, [projectId, activeProject]);
  const nodeOpacity = (id: string, kind: "project" | "work") => {
    if (focusChain && !focusChain.has(id))
      return kind === "project" ? 0.35 : 0.12;
    if (hoverChain && !hoverChain.has(id)) return 0.15;
    return 1;
  };
  const showLabel = (id: string) =>
    // Showing every focused task makes a busy workspace unreadable. Keep the
    // full title in the SVG <title> and reveal one label on hover/selection.
    // The project-only view is deliberately the exception: its task labels
    // should be readable without requiring a second interaction.
    Boolean(
      id === taskId ||
        hoverId === id ||
        (filterProjectId && visiblePlaced.some((item) => item.tasks.some((task) => task.task.id === id))),
    );
  const activateKeyboard = (event: ReactKeyboardEvent<SVGGElement>, activate: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    activate();
  };

  const commitView = (next: View | ((current: View) => View)) => {
    setView((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      viewRef.current = resolved;
      return resolved;
    });
  };

  useEffect(() => {
    const home = { x: -W * 0.03, y: -H * 0.03, w: W * 1.06, h: H * 1.06 };
    const target = taskId ? activeWorkPos : activeProjectPos;
    const nextTarget = !target
      ? home
      : (() => {
          const width = taskId ? W * 0.46 : filterProjectId ? W * 1.08 : W * 0.88;
          // In focus mode the selected project is the map's visual center.
          // The viewbox interpolation below provides the animated transition.
          const center = target;
          return {
            x: center.x - width / 2,
            y: center.y - (H * (width / W)) / 2,
            w: width,
            h: H * (width / W),
          };
        })();
    let frame = 0;
    const reduced =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      const current = viewRef.current;
      const amount = reduced ? 1 : 0.1;
      const next = {
        x: current.x + (nextTarget.x - current.x) * amount,
        y: current.y + (nextTarget.y - current.y) * amount,
        w: current.w + (nextTarget.w - current.w) * amount,
        h: current.h + (nextTarget.h - current.h) * amount,
      };
      const settled =
        Math.abs(next.x - nextTarget.x) < 0.05 &&
        Math.abs(next.y - nextTarget.y) < 0.05 &&
        Math.abs(next.w - nextTarget.w) < 0.05;
      commitView(settled ? nextTarget : next);
      if (!settled) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [projectId, taskId, filterProjectId, activeProjectPos, activeWorkPos]);

  const svgPoint = (clientX: number, clientY: number): Pos | null => {
    const element = svgRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const current = viewRef.current;
    return {
      x: current.x + ((clientX - rect.left) / rect.width) * current.w,
      y: current.y + ((clientY - rect.top) / rect.height) * current.h,
    };
  };
  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const current = viewRef.current;
    const cursor = svgPoint(event.clientX, event.clientY) || { x: CX, y: CY };
    const factor = Math.min(2, Math.max(0.5, Math.exp(event.deltaY * 0.0012)));
    const width = Math.min(W * 3, Math.max(W * 0.12, current.w * factor));
    const ratio = width / current.w;
    commitView({
      x: cursor.x - (cursor.x - current.x) * ratio,
      y: cursor.y - (cursor.y - current.y) * ratio,
      w: width,
      h: current.h * ratio,
    });
  };
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    pan.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pan.current) return;
    const dx = event.clientX - pan.current.x,
      dy = event.clientY - pan.current.y;
    if (Math.hypot(dx, dy) > 3) pan.current.moved = true;
    if (pan.current.moved) {
      const element = event.currentTarget.getBoundingClientRect();
      commitView((v) => ({
        ...v,
        x: v.x - (dx / element.width) * v.w,
        y: v.y - (dy / element.height) * v.h,
      }));
      pan.current.x = event.clientX;
      pan.current.y = event.clientY;
    }
  };
  const onPointerUp = () => {
    if (pan.current?.moved) suppressClick.current = true;
    pan.current = null;
  };
  const beginNodeDrag = (event: ReactPointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    nodeDrag.current = { id, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveNodeDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const d = nodeDrag.current;
    if (!d) return;
    const dx = event.clientX - d.x,
      dy = event.clientY - d.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    const rect = (
      event.currentTarget.ownerSVGElement as SVGSVGElement
    ).getBoundingClientRect();
    setOffsets((prev) => ({
      ...prev,
      [d.id]: {
        x: (prev[d.id]?.x || 0) + (dx / rect.width) * view.w,
        y: (prev[d.id]?.y || 0) + (dy / rect.height) * view.h,
      },
    }));
    offsetsRef.current = {
      ...offsetsRef.current,
      [d.id]: {
        x: (offsetsRef.current[d.id]?.x || 0) + (dx / rect.width) * view.w,
        y: (offsetsRef.current[d.id]?.y || 0) + (dy / rect.height) * view.h,
      },
    };
    d.x = event.clientX;
    d.y = event.clientY;
  };
  const endNodeDrag = () => {
    if (nodeDrag.current?.moved) {
      suppressClick.current = true;
      onLayoutChange({ ...layout, positions: offsetsRef.current, hidden: currentHidden, views: layout.views, activeViewId: layout.activeViewId });
    }
    nodeDrag.current = null;
  };
  const clickNode = (project: string | null, task?: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (task) {
      onProject(project);
      onTask(task);
    } else if (project === projectId) onProject(null);
    else onProject(project);
  };
  const moveProject = (direction: number) => {
    if (!state.projects.length) return;
    const current = state.projects.findIndex((p) => p.id === projectId);
    const next = state.projects[
      (Math.max(0, current) + direction + state.projects.length) %
        state.projects.length
    ].id;
    if (filterProjectId) onFilterProject(null);
    onProject(next);
  };

  const contextTargetIds = (kind: "project" | "task" | "subtask", id: string) => {
    if (kind === "subtask") return [id];
    for (const item of placed) {
      if (kind === "project" && item.project.id === id) return [id, ...item.tasks.flatMap(task => [task.task.id, ...task.subtasks.map(sub => sub.subtask.id)])];
      if (kind === "task") for (const task of item.tasks) if (task.task.id === id) return [id, ...task.subtasks.map(sub => sub.subtask.id)];
    }
    return [id];
  };
  const filterTarget = () => {
    if (contextMenu?.kind !== "project" || !contextMenu.id) return;
    onFilterProject(contextMenu.id);
    onProject(contextMenu.id);
    onTask(null);
    setContextMenu(null);
  };
  const clearFilter = () => {
    onFilterProject(null);
    onProject(null);
    onTask(null);
    setContextMenu(null);
  };
  const saveLayout = (next: GraphLayout) => {
    offsetsRef.current = next.positions;
    setOffsets(next.positions);
    onLayoutChange(next);
  };
  const saveCurrentView = (positions: Record<string, Pos>, hidden: string[]) => {
    const views = layout.views?.length ? layout.views.map(view => view.id === (layout.activeViewId ?? layout.views?.[0]?.id) ? { ...view, hidden } : view) : [{ id: "default", name: "Default", hidden }];
    const activeViewId = layout.activeViewId ?? views[0].id;
    saveLayout({ ...layout, positions, hidden, views, activeViewId });
  };
  const openContextMenu = (event: ReactMouseEvent, target: { kind: "canvas" | "project" | "task" | "subtask"; id?: string; label: string }) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, ...target });
  };
  const toggleHidden = () => {
    if (!contextMenu?.id) return;
    const ids = contextTargetIds(contextMenu.kind as "project" | "task" | "subtask", contextMenu.id);
    const hidden = new Set(layout.hidden);
    const shouldHide = !hidden.has(contextMenu.id);
    ids.forEach(id => shouldHide ? hidden.add(id) : hidden.delete(id));
    saveCurrentView(offsetsRef.current, [...hidden]);
    setContextMenu(null);
  };
  const arrangeTarget = () => {
    if (!contextMenu?.id || contextMenu.kind === "canvas") return;
    const ids = new Set(contextTargetIds(contextMenu.kind, contextMenu.id));
    const positions = Object.fromEntries(Object.entries(offsetsRef.current).filter(([id]) => !ids.has(id)));
    saveCurrentView(positions, currentHidden);
    setContextMenu(null);
  };
  const showAll = () => { saveCurrentView(offsetsRef.current, []); setContextMenu(null); };

  const selectedParentTaskId =
    taskId && activeProject?.tasks.some((item) => item.task.id === taskId)
      ? taskId
      : (activeProject?.tasks.find((item) =>
          item.subtasks.some((sub) => sub.subtask.id === taskId),
        )?.task.id ?? null);
  return (
    <div
      className={`founder-graph${fullscreen ? " is-fullscreen" : ""}${filterProjectId ? " is-focus-mode" : ""}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (taskId && selectedParentTaskId && selectedParentTaskId !== taskId)
            onTask(selectedParentTaskId);
          else if (taskId) onTask(null);
          else onProject(null);
        } else if (
          projectId &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          moveProject(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="graph-grid" aria-hidden="true" />
      <div className="graph-head">
        <span>
          {activeProject
            ? filterProjectId === activeProject.project.id
              ? `FOCUS · ${activeProject.project.name} · PROJECT CENTER`
              : activeProject.project.name
            : "Herdr recorded snapshot · local state overlay"}
        </span>
        <button onClick={() => setFullscreen((value) => !value)}>
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {fullscreen ? "Close" : "Fullscreen"}
        </button>
      </div>
      {activeProject && (
        <div className="graph-back">
          <button onClick={() => onProject(null)}>← Back</button>
          <span style={{ color: activeProject.project.color }}>
            {activeProject.project.name}
          </span>
          {filterProjectId === activeProject.project.id && (
            <button onClick={clearFilter}>全体表示</button>
          )}
          <button onClick={() => onProject(null)} aria-label="Close focus">
            <X size={14} />
          </button>
        </div>
      )}
      {activeProject && activeProject.project.tasks.length > 0 && (
        <div className="graph-task-index" aria-label={`${activeProject.project.name}のタスク一覧`}>
          <div className="graph-task-index-heading"><span>TASK INDEX</span><b>{activeProject.project.tasks.length}</b></div>
          <div className="graph-task-index-list">
            {activeProject.project.tasks.filter(task => !hiddenSet.has(task.id)).map(task => (
              <button key={task.id} className={task.id === taskId ? "active" : ""} onClick={() => onTask(task.id)}>
                <i className={`status-dot ${task.status}`} />
                <span>{task.title}<small>{task.subtasks.length ? `${task.subtasks.length}件のCLI/委任記録` : "実行記録なし"}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label="Radial project and task wheel"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => openContextMenu(e, { kind: "canvas", label: "グラフ" })}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onProject(null);
        }}
      >
        <circle
          cx={CX}
          cy={CY}
          r="44"
          className="founder-ring founder-ring--core"
        />
        <circle cx={CX} cy={CY} r="104" className="founder-ring" />
        <circle
          cx={CX}
          cy={CY}
          r={activeProject ? 286 : 252}
          className="founder-ring founder-ring--outer"
        />
        {visiblePlaced.map(({ project, pos: rawProjectPos, tasks }) => {
          if (hiddenSet.has(project.id)) return null;
          const projectPos = position(project.id, rawProjectPos);
          return (
            <g
              key={`links-${project.id}`}
              opacity={nodeOpacity(project.id, "project")}
            >
              {
                <path
                  d={curve({ x: CX, y: CY }, projectPos)}
                  className="founder-link founder-link--pillar"
                  stroke={project.color}
                />
              }
              {
                <path
                  d={curve({ x: CX, y: CY }, projectPos)}
                  className="founder-synapse"
                  stroke={project.color}
                />
              }
              {tasks.filter(({ task }) => !hiddenSet.has(task.id)).map(({ task, pos: rawTaskPos, subtasks }) => {
                const taskPos = position(task.id, rawTaskPos);
                return (
                  <g key={task.id}>
                    <path
                      d={curve(projectPos, taskPos)}
                      className="founder-link"
                      stroke={project.color}
                    />
                    {subtasks.filter(({ subtask }) => !hiddenSet.has(subtask.id)).map(({ subtask, pos: rawSubPos }) => (
                      <path
                        key={subtask.id}
                        d={curve(taskPos, position(subtask.id, rawSubPos))}
                        className={`founder-link founder-link--sub${subtask.kind === "delegation" ? " founder-link--delegation" : ""}`}
                        stroke={subtask.kind === "delegation" ? "#b989b1" : project.color}
                      />
                    ))}
                  </g>
                );
              })}
            </g>
          );
        })}
        <g
          className="founder-node founder-node--hub"
          data-node-id="hub"
          onMouseEnter={() => setHoverId("hub")}
          onMouseLeave={() => setHoverId((current) => (current === "hub" ? null : current))}
          onClick={() => onProject(null)}
          role="button"
          tabIndex={0}
        >
          <circle cx={CX} cy={CY} r="18" />
          <Sparkles x={CX - 9} y={CY - 9} width="18" height="18" />
          <text x={CX} y={CY + 31}>
            MISSIONS
          </text>
        </g>
        {visiblePlaced.map(({ project, pos: rawProjectPos, tasks }) => {
          if (hiddenSet.has(project.id)) return null;
          const projectPos = position(project.id, rawProjectPos);
          const selected = project.id === projectId;
          const circumference = 2 * Math.PI * 20;
          return (
            <g
              key={project.id}
              className={`founder-node${project.id === projectId ? " selected" : ""}${hoverId === project.id ? " is-hovered" : ""}`}
              transform={`translate(${projectPos.x} ${projectPos.y})`}
              data-node-id={project.id}
              opacity={nodeOpacity(project.id, "project")}
              onMouseEnter={() => setHoverId(project.id)}
              onMouseLeave={() => setHoverId((current) => (current === project.id ? null : current))}
              onFocus={() => setHoverId(project.id)}
              onBlur={() => setHoverId((current) => (current === project.id ? null : current))}
              onKeyDown={(event) => activateKeyboard(event, () => clickNode(project.id))}
              onPointerDown={(e) => beginNodeDrag(e, project.id)}
              onPointerMove={moveNodeDrag}
              onPointerUp={endNodeDrag}
              onPointerCancel={endNodeDrag}
              onContextMenu={(e) => openContextMenu(e, { kind: "project", id: project.id, label: project.name })}
              onClick={(e) => {
                e.stopPropagation();
                clickNode(project.id);
              }}
              role="button"
              tabIndex={0}
            >
              <title>
                {project.name} · {Math.round(progress(project) * 100)}% done
              </title>
              {selected && <circle r="20" className="selection-halo" />}
              {
                <circle
                  r="20"
                  className="project-gauge"
                  strokeDasharray={`${progress(project) * circumference} ${circumference}`}
                />
              }
              {
                <circle
                  r="15"
                  fill="#101918"
                  stroke={project.color}
                  strokeWidth={selected ? 2.5 : 1.5}
                />
              }
              {
                <FolderKanban
                  x="-8"
                  y="-8"
                  width="16"
                  height="16"
                  color={project.color}
                />
              }
              {
                <text y="28" fill={project.color}>
                  {short(project.name.toUpperCase(), 22)}
                </text>
              }
              <text y="40" className="founder-meta">
                {Math.round(progress(project) * 100)}% · {project.tasks.length}{" "}
                tasks
              </text>
              {tasks.filter(({ task }) => !hiddenSet.has(task.id)).map(({ task, pos: rawTaskPos, subtasks }) => {
                const taskPos = position(task.id, rawTaskPos);
                const taskColor =
                  task.status === "todo"
                    ? "#83918c"
                    : task.status === "doing"
                      ? "#e8b84b"
                      : "#42b7a6";
                return (
                  <g
                    key={task.id}
                    className={`founder-node${task.id === taskId ? " selected" : ""}${hoverId === task.id ? " is-hovered" : ""}`}
                    transform={`translate(${taskPos.x - projectPos.x} ${taskPos.y - projectPos.y})`}
                    data-node-id={task.id}
                    opacity={nodeOpacity(task.id, "work")}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoverId(task.id);
                    }}
                    onMouseLeave={(e) => {
                      e.stopPropagation();
                      setHoverId((current) => (current === task.id ? null : current));
                    }}
                    onFocus={() => setHoverId(task.id)}
                    onBlur={() => setHoverId((current) => (current === task.id ? null : current))}
                    onKeyDown={(event) => activateKeyboard(event, () => clickNode(project.id, task.id))}
                    onPointerDown={(e) => beginNodeDrag(e, task.id)}
                    onPointerMove={moveNodeDrag}
                    onPointerUp={endNodeDrag}
                    onPointerCancel={endNodeDrag}
                    onContextMenu={(e) => openContextMenu(e, { kind: "task", id: task.id, label: task.title })}
                    onClick={(e) => {
                      e.stopPropagation();
                      clickNode(project.id, task.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <title>
                      {task.title} · {statusLabel(task.status)}
                    </title>
                    {task.id === taskId && (
                      <circle r="12" className="selection-halo" />
                    )}
                    {task.status === "doing" && (
                      <circle r="11" className="breathe" />
                    )}
                    {
                      <circle
                        r="7.5"
                        fill="#101918"
                        stroke={taskColor}
                        strokeWidth="1.5"
                      />
                    }
                    {
                      <ClipboardList
                        x="-4"
                        y="-4"
                        width="8"
                        height="8"
                        color={taskColor}
                      />
                    }
                    {showLabel(task.id) && (
                      <text y="19" className="task-label">
                        {taskGraphLabel(task.title)}
                      </text>
                    )}
                    {subtasks.filter(({ subtask }) => !hiddenSet.has(subtask.id)).map(({ subtask, pos: rawSubPos }) => {
                      const subPos = position(subtask.id, rawSubPos);
                      const subColor =
                        subtask.kind === "delegation"
                          ? "#b989b1"
                          : subtask.status === "done"
                          ? "#42b7a6"
                          : subtask.status === "doing"
                            ? "#e8b84b"
                            : "#83918c";
                      return (
                        <g
                          key={subtask.id}
                          className={`founder-node${subtask.id === taskId ? " selected" : ""}${hoverId === subtask.id ? " is-hovered" : ""}`}
                          transform={`translate(${subPos.x - taskPos.x} ${subPos.y - taskPos.y})`}
                          data-node-id={subtask.id}
                          aria-label={`${subtask.kind === "delegation" ? "サブエージェント委任" : "CLI実行"}: ${subtask.title}`}
                          opacity={nodeOpacity(subtask.id, "work")}
                          onMouseEnter={(e) => {
                            e.stopPropagation();
                            setHoverId(subtask.id);
                          }}
                          onMouseLeave={(e) => {
                            e.stopPropagation();
                            setHoverId((current) => (current === subtask.id ? null : current));
                          }}
                          onPointerEnter={(e) => {
                            e.stopPropagation();
                            setHoverId(subtask.id);
                          }}
                          onPointerLeave={(e) => {
                            e.stopPropagation();
                            setHoverId((current) => (current === subtask.id ? null : current));
                          }}
                          onFocus={() => setHoverId(subtask.id)}
                          onBlur={() => setHoverId((current) => (current === subtask.id ? null : current))}
                          onKeyDown={(event) => activateKeyboard(event, () => clickNode(project.id, subtask.id))}
                          onPointerDown={(e) => beginNodeDrag(e, subtask.id)}
                          onPointerMove={moveNodeDrag}
                          onPointerUp={endNodeDrag}
                          onPointerCancel={endNodeDrag}
                          onContextMenu={(e) => openContextMenu(e, { kind: "subtask", id: subtask.id, label: subtask.title })}
                          onClick={(e) => {
                            e.stopPropagation();
                            clickNode(project.id, subtask.id);
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <circle r="6.5" fill="#101918" stroke={subColor} />
                          {subtask.id === taskId && (
                            <circle r="8" className="selection-halo" />
                          )}
                          {subtask.kind === "delegation" ? (
                            <Users x="-3" y="-3" width="6" height="6" color={subColor} />
                          ) : subtask.kind === "execution" ? (
                            <Terminal x="-3" y="-3" width="6" height="6" color={subColor} />
                          ) : (
                            <GitBranch x="-3" y="-3" width="6" height="6" color="#83918c" />
                          )}
                          <title>
                            {[subtask.title, subtask.command, subtask.output, subtask.delegatedTo ? `委任先: ${subtask.delegatedTo}` : ""].filter(Boolean).join("\n")}
                          </title>
                          <circle r="10" className="subtask-hit-area" />
                          {showLabel(subtask.id) && (
                            <text y="14" className="task-label">
                              {short(subtask.title, 24)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {contextMenu && (
        <div
          className="graph-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          <strong>{contextMenu.label}</strong>
          {contextMenu.kind !== "canvas" ? (
            <>
              {contextMenu.kind === "project" && (
                <button onClick={filterTarget} disabled={filterProjectId === contextMenu.id}>
                  {filterProjectId === contextMenu.id ? "このプロジェクトだけに絞り込み中" : "このプロジェクトだけに絞る"}
                </button>
              )}
              <button onClick={toggleHidden}>{hiddenSet.has(contextMenu.id || "") ? "表示する" : "非表示にする"}</button>
              <button onClick={arrangeTarget}>配下を自動配置</button>
            </>
          ) : (
            <>
              {filterProjectId && <button onClick={clearFilter}>全プロジェクトを表示</button>}
              <button onClick={showAll} disabled={hiddenSet.size === 0}>非表示項目をすべて表示</button>
            </>
          )}
        </div>
      )}
      {activeProject && (
        <div className="graph-project-nav">
          <button onClick={() => moveProject(-1)}>‹</button>
          <span style={{ color: activeProject.project.color }}>
            {activeProject.project.name}
          </span>
          <button onClick={() => moveProject(1)}>›</button>
        </div>
      )}
    </div>
  );
}
