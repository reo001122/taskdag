import type { TaskGraph } from '../domain/model';
import {
  type ChildTaskRow,
  type EdgeRow,
  type GraphRows,
  type ProjectRow,
  type TaskRow,
  toRows,
} from './rows';

/**
 * 変更前後のグラフの差分を求める(design/persistence-design.md §3)
 *
 * 通常の操作も Undo/Redo も「グラフAからグラフBへ移行する」という同一の処理になる。
 * 操作ごとに個別のSQLを書く方式では、Undo(スナップショット復元)のために
 * 別系統の書き込み処理が必要になってしまう。
 *
 * この関数は純粋で、SQLite に依存しない。
 */

export type EntityDiff<T> = {
  readonly inserted: readonly T[];
  readonly updated: readonly T[];
  readonly deleted: readonly string[];
};

export type GraphDiff = {
  readonly projects: EntityDiff<ProjectRow>;
  readonly tasks: EntityDiff<TaskRow>;
  readonly childTasks: EntityDiff<ChildTaskRow>;
  readonly edges: EntityDiff<EdgeRow>;
};

/** 行の全フィールドが等しいか。行はフラットなオブジェクトなので浅い比較で足りる。 */
function rowEquals<T extends Record<string, unknown>>(a: T, b: T): boolean {
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function diffMap<T extends Record<string, unknown>>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
): EntityDiff<T> {
  const inserted: T[] = [];
  const updated: T[] = [];
  const deleted: string[] = [];

  for (const [id, row] of after) {
    const previous = before.get(id);
    if (previous === undefined) inserted.push(row);
    else if (!rowEquals(previous, row)) updated.push(row);
  }

  for (const id of before.keys()) {
    if (!after.has(id)) deleted.push(id);
  }

  return { inserted, updated, deleted };
}

export function computeDiff(before: TaskGraph, after: TaskGraph): GraphDiff {
  return diffRows(toRows(before), toRows(after));
}

export function diffRows(before: GraphRows, after: GraphRows): GraphDiff {
  return {
    projects: diffMap(before.projects, after.projects),
    tasks: diffMap(before.tasks, after.tasks),
    childTasks: diffMap(before.childTasks, after.childTasks),
    edges: diffMap(before.edges, after.edges),
  };
}

/** 差分が空か(書き込みを省略できるか)。 */
export function isEmptyDiff(diff: GraphDiff): boolean {
  return ([diff.projects, diff.tasks, diff.childTasks, diff.edges] as const).every(
    (d) => d.inserted.length === 0 && d.updated.length === 0 && d.deleted.length === 0,
  );
}
