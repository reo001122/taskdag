import { canConnect } from './connect';
import { cannotNestIntoItself, childTaskNotFound, type DomainError, taskNotFound } from './errors';
import type { IdGenerator } from './ids';
import {
  type ChildTask,
  type ChildTaskId,
  childTaskId,
  type DependencyEdge,
  type EdgeId,
  edgeId,
  type Position,
  type Task,
  type TaskGraph,
  type TaskId,
  taskId,
} from './model';
import { err, ok, type Result } from './result';

/**
 * Task と childTask の入れ替え(W-3)
 *
 * childTask は Task の一段下にあるだけで、別の種類のものではない。分解して
 * みたら独立した作業だった、逆に独立させていたが別の作業の一手順だった、
 * というのは書き出している最中に起きる。書き直しではなく移動でやれるようにする。
 *
 * 深さは1のまま(FR-2)。childTask は childTask を持てず、依存も持てない。
 */

/**
 * Task を、別の Task の childTask にする。
 *
 * 依存エッジは、新しい親へ付け替える。 X → T は X → A に、T → Y は A → Y に
 * なる。T が A の一部になるのだから、T が待っていたものは A が待ち、T を
 * 待っていたものは A を待つ。削除のときの繋ぎ直し(FR-3)とは別の規則で、
 * あちらは T を飛ばして両隣を繋ぐ「迂回」、こちらは T を A に置き換える。
 *
 * 付け替えられないものは落とす。相手が A 自身のとき(自己ループになる)、
 * 同じ辺が既にあるとき、循環になるときの3つ。落ちたぶんは Cmd+Z で戻る。
 *
 * T が childTask を持っていた場合は、A の下へ並べ直す。孫は作れないため。
 */
export function demoteTaskToChild(
  graph: TaskGraph,
  id: TaskId,
  newParentId: TaskId,
  newId: IdGenerator,
): Result<TaskGraph, DomainError> {
  if (id === newParentId) return err(cannotNestIntoItself(id));

  const task = graph.tasks.get(id);
  if (!task) return err(taskNotFound(id));
  const parent = graph.tasks.get(newParentId);
  if (!parent) return err(taskNotFound(newParentId));

  // 1. T 自身と、T が持っていた childTask を、A の下へ並べる順に作る。
  const moved: ChildTask[] = [
    {
      id: childTaskId(newId()),
      parentId: newParentId,
      title: task.title,
      progress: task.progress,
      memo: task.memo,
    },
  ];
  for (const childId of task.childTaskIds) {
    const child = graph.childTasks.get(childId);
    if (!child) continue;
    moved.push({ ...child, parentId: newParentId });
  }

  const childTasks = new Map(graph.childTasks);
  for (const childId of task.childTaskIds) childTasks.delete(childId);
  for (const child of moved) childTasks.set(child.id, child);

  // 2. T を消し、A の並びの末尾に足す。
  const tasks = new Map(graph.tasks);
  tasks.delete(id);
  tasks.set(newParentId, {
    ...parent,
    childTaskIds: [...parent.childTaskIds, ...moved.map((c) => c.id)],
  });

  // 3. 依存を A へ付け替える。
  const edges = new Map<EdgeId, DependencyEdge>();
  const rewired: { from: TaskId; to: TaskId }[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.from !== id && edge.to !== id) {
      edges.set(edge.id, edge);
      continue;
    }
    rewired.push({
      from: edge.from === id ? newParentId : edge.from,
      to: edge.to === id ? newParentId : edge.to,
    });
  }

  let next: TaskGraph = { ...graph, tasks, childTasks, edges };
  for (const { from, to } of rewired) {
    // 置き換えた結果が通らないものは落とす。自己ループ、重複、循環の3つ。
    if (!canConnect(next, from, to).ok) continue;
    const id2 = edgeId(newId());
    const withEdge = new Map(next.edges);
    withEdge.set(id2, { id: id2, from, to });
    next = { ...next, edges: withEdge };
  }

  return ok(next);
}

/**
 * childTask を、独立した Task にする。
 *
 * 依存は引き継がない。 元の親が持っていた依存は親のものであって、その一手順
 * だった childTask のものではない。独立した時点でどこにも繋がっていない
 * Task になり、必要なら引き直す。
 *
 * 位置は落とした場所。所属する Project も、そこから導かれる(FR-4)。
 */
export function promoteChildTask(
  graph: TaskGraph,
  id: ChildTaskId,
  position: Position,
  newId: IdGenerator,
): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));
  const parent = graph.tasks.get(child.parentId);
  if (!parent) return err(taskNotFound(child.parentId));

  const created: Task = {
    id: taskId(newId()),
    title: child.title,
    progress: child.progress,
    position,
    collapsed: false,
    memo: child.memo,
    childTaskIds: [],
  };

  const tasks = new Map(graph.tasks);
  tasks.set(parent.id, {
    ...parent,
    childTaskIds: parent.childTaskIds.filter((c) => c !== id),
  });
  tasks.set(created.id, created);

  const childTasks = new Map(graph.childTasks);
  childTasks.delete(id);

  return ok({ ...graph, tasks, childTasks });
}

/** childTask を別の Task の下へ移す。並びの末尾に付く。 */
export function moveChildTask(
  graph: TaskGraph,
  id: ChildTaskId,
  newParentId: TaskId,
): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));
  const from = graph.tasks.get(child.parentId);
  if (!from) return err(taskNotFound(child.parentId));
  const to = graph.tasks.get(newParentId);
  if (!to) return err(taskNotFound(newParentId));
  if (child.parentId === newParentId) return ok(graph);

  const tasks = new Map(graph.tasks);
  tasks.set(from.id, { ...from, childTaskIds: from.childTaskIds.filter((c) => c !== id) });
  tasks.set(to.id, { ...to, childTaskIds: [...to.childTaskIds, id] });

  const childTasks = new Map(graph.childTasks);
  childTasks.set(id, { ...child, parentId: newParentId });

  return ok({ ...graph, tasks, childTasks });
}
