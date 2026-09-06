import { canConnect } from './connect';
import { type DomainError, edgeNotFound, taskNotFound } from './errors';
import type { IdGenerator } from './ids';
import {
  type EdgeId,
  edgeId,
  type Position,
  type Progress,
  type Task,
  type TaskGraph,
  type TaskId,
  taskId,
} from './model';
import { err, ok, type Result } from './result';

/**
 * Task / Project / 依存エッジの操作(FR-1, FR-3, FR-4, FR-5, FR-6)
 *
 * すべて元のグラフを変更せず、新しい TaskGraph を返す。
 * Undo がスナップショット方式であるため、イミュータブルであることが前提になる
 * (design/domain-design.md §4)。
 */

export function createTask(
  graph: TaskGraph,
  title: string,
  position: Position,
  newId: IdGenerator,
): Result<TaskGraph, DomainError> {
  const id = taskId(newId());
  // Project への所属は持たせない。置いた位置が Project の矩形に入っていれば
  // 属することになる(FR-4, domain/project.ts)。
  const task: Task = {
    id,
    title,
    progress: 'not_done',
    position,
    collapsed: false,
    memo: '',
    childTaskIds: [],
  };

  const tasks = new Map(graph.tasks);
  tasks.set(id, task);
  return ok({ ...graph, tasks });
}

/** Task の1フィールドだけを差し替える共通処理。 */
function updateTask(
  graph: TaskGraph,
  id: TaskId,
  patch: Partial<Task>,
): Result<TaskGraph, DomainError> {
  const task = graph.tasks.get(id);
  if (!task) return err(taskNotFound(id));

  const tasks = new Map(graph.tasks);
  tasks.set(id, { ...task, ...patch });
  return ok({ ...graph, tasks });
}

export const updateTaskTitle = (
  graph: TaskGraph,
  id: TaskId,
  title: string,
): Result<TaskGraph, DomainError> => updateTask(graph, id, { title });

/**
 * 軸b の変更(FR-5)。
 * 軸a(Ready/Blocked)による制限は一切かけない。Blocked な Task でも
 * In Progress や Done にできる — 導出された状態が操作を妨げてはならない。
 */
export const setTaskProgress = (
  graph: TaskGraph,
  id: TaskId,
  progress: Progress,
): Result<TaskGraph, DomainError> => updateTask(graph, id, { progress });

export const moveTask = (
  graph: TaskGraph,
  id: TaskId,
  position: Position,
): Result<TaskGraph, DomainError> => updateTask(graph, id, { position });

export const setTaskMemo = (
  graph: TaskGraph,
  id: TaskId,
  memo: string,
): Result<TaskGraph, DomainError> => updateTask(graph, id, { memo });

export const setTaskCollapsed = (
  graph: TaskGraph,
  id: TaskId,
  collapsed: boolean,
): Result<TaskGraph, DomainError> => updateTask(graph, id, { collapsed });

export function connect(
  graph: TaskGraph,
  from: TaskId,
  to: TaskId,
  newId: IdGenerator,
): Result<TaskGraph, DomainError> {
  // 判定は canConnect に一本化する。UI(isValidConnection)と実際の接続で
  // 判定がずれないようにするため。
  const allowed = canConnect(graph, from, to);
  if (!allowed.ok) return allowed;

  const id = edgeId(newId());
  const edges = new Map(graph.edges);
  edges.set(id, { id, from, to });
  return ok({ ...graph, edges });
}

export function disconnect(graph: TaskGraph, id: EdgeId): Result<TaskGraph, DomainError> {
  if (!graph.edges.has(id)) return err(edgeNotFound(id));

  const edges = new Map(graph.edges);
  edges.delete(id);
  return ok({ ...graph, edges });
}

/**
 * 複数Taskの座標をまとめて更新する(FR-6 の「整列」)。
 * 1つでも存在しないTaskが含まれていたら、部分適用せず全体を失敗させる。
 */
export function applyLayout(
  graph: TaskGraph,
  positions: readonly { readonly id: TaskId; readonly position: Position }[],
): Result<TaskGraph, DomainError> {
  for (const { id } of positions) {
    if (!graph.tasks.has(id)) return err(taskNotFound(id));
  }

  const tasks = new Map(graph.tasks);
  for (const { id, position } of positions) {
    const task = tasks.get(id);
    if (task) tasks.set(id, { ...task, position });
  }
  return ok({ ...graph, tasks });
}
