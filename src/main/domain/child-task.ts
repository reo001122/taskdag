import { childTaskNotFound, type DomainError, indexOutOfRange, taskNotFound } from './errors';
import type { IdGenerator } from './ids';
import {
  type ChildTask,
  type ChildTaskId,
  childTaskId,
  type Progress,
  type TaskGraph,
  type TaskId,
} from './model';
import { err, ok, type Result } from './result';

/**
 * childTask の操作(FR-2, design/domain-design.md §3.4)
 *
 * 順序は親Taskの childTaskIds 配列の並びで表現する。childTask 側に順序番号を
 * 持たせない — 並べ替えのたびに番号を振り直す必要が生じ、重複・欠番といった
 * 不整合の余地が生まれるため。配列なら順序が一意に定まる。
 *
 * 「1番目・2番目」という番号は表示時にインデックスから導出する。保持しない。
 */

export function createChildTask(
  graph: TaskGraph,
  parentId: TaskId,
  title: string,
  newId: IdGenerator,
): Result<TaskGraph, DomainError> {
  const parent = graph.tasks.get(parentId);
  if (!parent) return err(taskNotFound(parentId));

  const id = childTaskId(newId());
  const child: ChildTask = { id, parentId, title, progress: 'not_done', memo: '' };

  const childTasks = new Map(graph.childTasks);
  childTasks.set(id, child);

  const tasks = new Map(graph.tasks);
  tasks.set(parentId, { ...parent, childTaskIds: [...parent.childTaskIds, id] });

  return ok({ ...graph, tasks, childTasks });
}

export function updateChildTaskTitle(
  graph: TaskGraph,
  id: ChildTaskId,
  title: string,
): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));

  const childTasks = new Map(graph.childTasks);
  childTasks.set(id, { ...child, title });
  return ok({ ...graph, childTasks });
}

export function setChildTaskMemo(
  graph: TaskGraph,
  id: ChildTaskId,
  memo: string,
): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));

  const childTasks = new Map(graph.childTasks);
  childTasks.set(id, { ...child, memo });
  return ok({ ...graph, childTasks });
}

export function setChildTaskProgress(
  graph: TaskGraph,
  id: ChildTaskId,
  progress: Progress,
): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));

  // 親の軸b には一切触れない。親子の Done は独立している(FR-5)。
  const childTasks = new Map(graph.childTasks);
  childTasks.set(id, { ...child, progress });
  return ok({ ...graph, childTasks });
}

export function deleteChildTask(graph: TaskGraph, id: ChildTaskId): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));

  const parent = graph.tasks.get(child.parentId);
  if (!parent) {
    // INV-6(childTask は必ず1つの親Taskに属する)が破れている
    throw new Error(`deleteChildTask: parent ${child.parentId} of ${id} does not exist`);
  }

  const childTasks = new Map(graph.childTasks);
  childTasks.delete(id);

  const tasks = new Map(graph.tasks);
  tasks.set(parent.id, {
    ...parent,
    childTaskIds: parent.childTaskIds.filter((c) => c !== id),
  });

  return ok({ ...graph, tasks, childTasks });
}

/**
 * childTask を親の中で `newIndex` の位置へ移動する(FR-2)。
 * 現在位置から取り除き、指定位置に挿入し直す。
 */
export function reorderChildTask(
  graph: TaskGraph,
  id: ChildTaskId,
  newIndex: number,
): Result<TaskGraph, DomainError> {
  const child = graph.childTasks.get(id);
  if (!child) return err(childTaskNotFound(id));

  const parent = graph.tasks.get(child.parentId);
  if (!parent) {
    throw new Error(`reorderChildTask: parent ${child.parentId} of ${id} does not exist`);
  }

  const current = [...parent.childTaskIds];
  if (!Number.isInteger(newIndex) || newIndex < 0 || newIndex >= current.length) {
    return err(indexOutOfRange(newIndex, current.length));
  }

  const from = current.indexOf(id);
  if (from === -1) {
    // INV-8(配列と親参照の一致)が破れている
    throw new Error(`reorderChildTask: ${id} is not listed in parent ${parent.id}`);
  }

  current.splice(from, 1);
  current.splice(newIndex, 0, id);

  const tasks = new Map(graph.tasks);
  tasks.set(parent.id, { ...parent, childTaskIds: current });
  return ok({ ...graph, tasks });
}
