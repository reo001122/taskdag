import { type DomainError, taskNotFound } from './errors';
import { hasEdge, incomingEdges, outgoingEdges, predecessors, successors } from './graph-query';
import type { IdGenerator } from './ids';
import {
  type ChildTaskId,
  type DependencyEdge,
  edgeId,
  type TaskGraph,
  type TaskId,
} from './model';
import { err, ok, type Result } from './result';

/**
 * Task の削除と、依存エッジの再接続(FR-1, FR-3, design/domain-design.md §3.2)
 *
 * 「計画(plan)」と「適用(apply)」を分けている。FR-1 が削除前に変更内容の提示を
 * 要求しているため、UI は planDeleteTask の結果をユーザーに見せてから確定できる。
 */

/** 削除によって生じる変更。UIの確認ダイアログにそのまま出せる形にしてある。 */
export type DeleteTaskPlan = {
  readonly taskId: TaskId;
  /** 削除されるエッジ。 */
  readonly removedEdges: readonly DependencyEdge[];
  /** 再接続で新たに作られるエッジ(まだ id を持たない)。 */
  readonly addedEdges: readonly { readonly from: TaskId; readonly to: TaskId }[];
  /** 巻き添えで削除される childTask。 */
  readonly removedChildTaskIds: readonly ChildTaskId[];
};

export function planDeleteTask(graph: TaskGraph, id: TaskId): Result<DeleteTaskPlan, DomainError> {
  const task = graph.tasks.get(id);
  if (!task) return err(taskNotFound(id));

  const removedEdges = [...incomingEdges(graph, id), ...outgoingEdges(graph, id)];
  const preds = predecessors(graph, id);
  const succs = successors(graph, id);

  return ok({
    taskId: id,
    removedEdges,
    addedEdges: reconnections(graph, preds, succs),
    removedChildTaskIds: task.childTaskIds,
  });
}

/**
 * 再接続すべきエッジを決める(FR-3)。
 *
 * 入力・出力の少なくとも一方が単数のときだけ再接続する。両方が複数の場合、
 * 総当たりで繋ぐと組み合わせが爆発し、ユーザーの意図とも一致しないため繋がない。
 * 失われる依存関係は planDeleteTask の removedEdges としてUIに提示される。
 *
 * ここで循環検知は行わない。再接続で追加される p→s は、削除前に p→T→s という
 * 経路が存在したペアに限られるため、到達可能性が増えず循環は生じない
 * (design/domain-design.md §3.2 の証明)。
 */
function reconnections(
  graph: TaskGraph,
  preds: readonly TaskId[],
  succs: readonly TaskId[],
): { from: TaskId; to: TaskId }[] {
  if (preds.length === 0 || succs.length === 0) return [];
  if (preds.length > 1 && succs.length > 1) return [];

  const pairs: { from: TaskId; to: TaskId }[] = [];
  for (const from of preds) {
    for (const to of succs) {
      // 既存エッジと重複する場合は作らない(INV-4、冪等)
      if (hasEdge(graph, from, to)) continue;
      pairs.push({ from, to });
    }
  }
  return pairs;
}

/**
 * Task を削除する(FR-1)。
 *
 * keep を渡すと、再接続をそこに挙がったものだけに絞れる。 FR-3 の規則で
 * 繋ぎ直される先が、いつもユーザーの意図と一致するとは限らないため、
 * 確認の場で外せるようにしてある(FR-1)。
 *
 * 絞り込みにしかならない。 keep に計画外の組を書いても無視する ——
 * この入口から任意のエッジを作れてしまうと、循環しないことの保証
 * (design/domain-design.md §3.2)が崩れる。
 *
 * 省略したときは計画どおり全て繋ぎ直す。確認の場を持たない経路
 * (MCP 経由の削除、FR-1)はこちらを通る。
 */
export function deleteTask(
  graph: TaskGraph,
  id: TaskId,
  newId: IdGenerator,
  keep?: readonly { readonly from: TaskId; readonly to: TaskId }[],
): Result<TaskGraph, DomainError> {
  const planned = planDeleteTask(graph, id);
  if (!planned.ok) return planned;

  const plan =
    keep === undefined
      ? planned.value
      : {
          ...planned.value,
          addedEdges: planned.value.addedEdges.filter((edge) =>
            keep.some((k) => k.from === edge.from && k.to === edge.to),
          ),
        };

  return ok(applyDeleteTask(graph, plan, newId));
}

export function applyDeleteTask(
  graph: TaskGraph,
  plan: DeleteTaskPlan,
  newId: IdGenerator,
): TaskGraph {
  const tasks = new Map(graph.tasks);
  const childTasks = new Map(graph.childTasks);
  const edges = new Map(graph.edges);

  for (const edge of plan.removedEdges) edges.delete(edge.id);
  for (const childId of plan.removedChildTaskIds) childTasks.delete(childId);
  tasks.delete(plan.taskId);

  for (const { from, to } of plan.addedEdges) {
    const id = edgeId(newId());
    edges.set(id, { id, from, to });
  }

  return { tasks, childTasks, edges, projects: graph.projects };
}
