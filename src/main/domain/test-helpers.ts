/**
 * テスト用のグラフ組み立てヘルパー。
 *
 * テストの意図(どういう形のグラフか)が一目で読めることを最優先にしている。
 * 例:
 *   buildGraph({ tasks: { A: 'done', B: {} }, edges: [['A', 'B']] })
 */

import {
  type ChildTask,
  type ChildTaskId,
  childTaskId,
  type DependencyEdge,
  type EdgeId,
  edgeId,
  type Progress,
  type Project,
  type ProjectId,
  projectId,
  type Task,
  type TaskGraph,
  type TaskId,
  taskId,
} from './model';

type TaskSpec =
  | Progress
  | {
      progress?: Progress;
      position?: { x: number; y: number };
      collapsed?: boolean;
      memo?: string;
      children?: readonly (string | { id: string; progress?: Progress; memo?: string })[];
    };

type ProjectSpec =
  | string
  | { name: string; x?: number; y?: number; w?: number; h?: number; color?: number };

type GraphSpec = {
  tasks?: Record<string, TaskSpec>;
  /** [from, to] の組。id は `from->to` として自動採番される。 */
  edges?: readonly (readonly [string, string])[];
  /** Project は矩形。省略時は原点付近の広い枠になる。 */
  projects?: Record<string, ProjectSpec>;
};

const normalize = (spec: TaskSpec): Exclude<TaskSpec, Progress> =>
  typeof spec === 'string' ? { progress: spec } : spec;

export function buildGraph(spec: GraphSpec): TaskGraph {
  const tasks = new Map<TaskId, Task>();
  const childTasks = new Map<ChildTaskId, ChildTask>();
  const edges = new Map<EdgeId, DependencyEdge>();
  const projects = new Map<ProjectId, Project>();

  for (const [id, raw] of Object.entries(spec.projects ?? {})) {
    const p = typeof raw === 'string' ? { name: raw } : raw;
    projects.set(projectId(id), {
      id: projectId(id),
      name: p.name,
      position: { x: p.x ?? 0, y: p.y ?? 0 },
      width: p.w ?? 1000,
      height: p.h ?? 1000,
      colorIndex: p.color ?? 0,
    });
  }

  for (const [id, rawSpec] of Object.entries(spec.tasks ?? {})) {
    const s = normalize(rawSpec);
    const parentId = taskId(id);
    const childIds: ChildTaskId[] = [];

    for (const child of s.children ?? []) {
      const c = typeof child === 'string' ? { id: child } : child;
      const cid = childTaskId(c.id);
      childIds.push(cid);
      childTasks.set(cid, {
        id: cid,
        parentId,
        title: c.id,
        progress: c.progress ?? 'not_done',
        memo: c.memo ?? '',
      });
    }

    tasks.set(parentId, {
      id: parentId,
      title: id,
      progress: s.progress ?? 'not_done',
      position: s.position ?? { x: 0, y: 0 },
      collapsed: s.collapsed ?? false,
      memo: s.memo ?? '',
      childTaskIds: childIds,
    });
  }

  for (const [from, to] of spec.edges ?? []) {
    const id = edgeId(`${from}->${to}`);
    edges.set(id, { id, from: taskId(from), to: taskId(to) });
  }

  return { tasks, childTasks, edges, projects };
}

/** グラフ内の依存エッジを `from->to` の配列として取り出す(順不同比較用にソート済み)。 */
export function edgePairs(graph: TaskGraph): string[] {
  return [...graph.edges.values()].map((e) => `${e.from}->${e.to}`).sort();
}

export const T = taskId;
export const C = childTaskId;
export const P = projectId;
