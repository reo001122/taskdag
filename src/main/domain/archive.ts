import { deleteTask } from './delete-task';
import { type DomainError, taskNotDone, taskNotFound } from './errors';
import type { IdGenerator } from './ids';
import type { ArchivedChildTask, ArchivedTask, DependencyEdge, TaskGraph, TaskId } from './model';
import { projectOfTask } from './project';
import { err, ok, type Result } from './result';

/**
 * 完了した Task のアーカイブ(FR-11, design/domain-design.md §3.6)
 *
 * アーカイブは「削除して、読むための記録を残す」操作である。グラフから外す部分
 * (childTask を道連れにする・依存を FR-3 の規則で繋ぎ直す)は deleteTask をそのまま
 * 呼ぶ —— 規則を書き写すと、片方だけ直したときに削除とアーカイブで再接続の結果が
 * 食い違う。
 *
 * 時刻は引数で受ける。ドメインは時計を持たない。Project の名前は、所属の導出が
 * ドメインにある(projectOfTask)のでここで写す。
 */

/** アーカイブによって生じる変更。確認ダイアログにそのまま出せる形にしてある。 */
export type ArchivePlan = {
  readonly taskIds: readonly TaskId[];
  /** 消える依存。移す Task どうしを結ぶものも含む。 */
  readonly removedEdges: readonly DependencyEdge[];
  /** 繋ぎ直しで新たにできる依存。 */
  readonly addedEdges: readonly { readonly from: TaskId; readonly to: TaskId }[];
  /** 一緒に移る childTask の数。 */
  readonly childTaskCount: number;
};

/** 完了(Done)している Task の id。グラフの並びの順。非表示かどうかは表示の都合で、ここでは見ない。 */
export function completedTaskIds(graph: TaskGraph): TaskId[] {
  return [...graph.tasks.values()].filter((t) => t.progress === 'done').map((t) => t.id);
}

/** 1件を移す。完了していなければ task_not_done。 */
function archiveOne(
  graph: TaskGraph,
  id: TaskId,
  newId: IdGenerator,
  archivedAt: number,
): Result<TaskGraph, DomainError> {
  const task = graph.tasks.get(id);
  if (!task) return err(taskNotFound(id));
  // FR-11: 完了していない Task はアーカイブできない
  if (task.progress !== 'done') return err(taskNotDone(id));

  const childTasks: ArchivedChildTask[] = [];
  for (const childId of task.childTaskIds) {
    const child = graph.childTasks.get(childId);
    if (!child) throw new Error(`archive: child ${childId} listed in task ${id} does not exist`);
    childTasks.push({ title: child.title, progress: child.progress, memo: child.memo });
  }

  // 所属は位置から導くので、Task が消える前に名前を写しておく(FR-4)
  const projectId = projectOfTask(graph, id);
  const record: ArchivedTask = {
    id,
    title: task.title,
    memo: task.memo,
    childTasks,
    archivedAt,
    projectName: projectId === null ? null : (graph.projects.get(projectId)?.name ?? null),
  };

  // FR-3: 依存の扱いは削除と同じ
  const removed = deleteTask(graph, id, newId);
  if (!removed.ok) return removed;
  return ok({ ...removed.value, archived: [...removed.value.archived, record] });
}

/**
 * 指定した Task を、渡した順に1件ずつ移す。
 *
 * 1件でも完了していなければ全体を失敗にする(部分的に移さない)。まとめて移した結果は
 * 「1件ずつ同じ規則を順に適用した結果」と一致する(FR-11)—— 実際にそうして作っている。
 */
export function archiveTasks(
  graph: TaskGraph,
  ids: readonly TaskId[],
  newId: IdGenerator,
  archivedAt: number,
): Result<TaskGraph, DomainError> {
  let current = graph;
  for (const id of ids) {
    const next = archiveOne(current, id, newId, archivedAt);
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}

/** 完了しているトップレベルの Task をすべて移す。無ければ何も変えない。 */
export function archiveCompletedTasks(
  graph: TaskGraph,
  newId: IdGenerator,
  archivedAt: number,
): Result<TaskGraph, DomainError> {
  return archiveTasks(graph, completedTaskIds(graph), newId, archivedAt);
}

/**
 * 実際には何も変えずに、移したときの変化を求める。
 *
 * archiveTasks をそのまま試し、前後を比べる。別に計算を書かないので、見せた内容と
 * 実際に起きることは食い違わない。途中で繋ぎ直されてあとで消えた依存は、前後の差には
 * 現れない(ユーザーにとって起きなかったのと同じ)。
 */
export function planArchive(
  graph: TaskGraph,
  ids: readonly TaskId[],
): Result<ArchivePlan, DomainError> {
  // 試し用の id。前後の比較には id を使わず、組(from, to)で見る
  let n = 0;
  const trialIds: IdGenerator = () => {
    n += 1;
    return `plan-${n}`;
  };
  const after = archiveTasks(graph, ids, trialIds, 0);
  if (!after.ok) return after;

  const pair = (e: { from: TaskId; to: TaskId }) => `${e.from}\u0000${e.to}`;
  const before = new Set([...graph.edges.values()].map(pair));
  const kept = new Set([...after.value.edges.values()].map(pair));

  let childTaskCount = 0;
  for (const id of ids) childTaskCount += graph.tasks.get(id)?.childTaskIds.length ?? 0;

  return ok({
    taskIds: [...ids],
    removedEdges: [...graph.edges.values()].filter((e) => !kept.has(pair(e))),
    addedEdges: [...after.value.edges.values()]
      .filter((e) => !before.has(pair(e)))
      .map((e) => ({ from: e.from, to: e.to })),
    childTaskCount,
  });
}
