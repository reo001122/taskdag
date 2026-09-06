import type { DatabaseSync } from 'node:sqlite';
import {
  type ChildTask,
  type ChildTaskId,
  childTaskId,
  type DependencyEdge,
  type EdgeId,
  edgeId,
  type Project,
  type ProjectId,
  projectId,
  type Task,
  type TaskGraph,
  type TaskId,
  taskId,
} from '../domain/model';
import type { GraphDiff } from './diff';
import type { ChildTaskRow, EdgeRow, ProjectRow, TaskRow } from './rows';

/**
 * SQLite への読み書き(design/persistence-design.md §3)
 *
 * ここにビジネスロジックを書かないこと。ドメイン層が算出した結果を写すだけ。
 */

/** DB からグラフ全体を読み込む。 */
export function load(db: DatabaseSync): TaskGraph {
  // node:sqlite の all() は unknown[] を返すため、スキーマ上の形へキャストする。
  // 形はこのファイル内の CREATE TABLE と1対1で対応している。
  const projectRows = db.prepare('SELECT * FROM projects').all() as unknown as ProjectRow[];
  const taskRows = db.prepare('SELECT * FROM tasks').all() as unknown as TaskRow[];
  const childRows = db
    .prepare('SELECT * FROM child_tasks ORDER BY parent_id, order_index')
    .all() as unknown as ChildTaskRow[];
  const edgeRows = db.prepare('SELECT * FROM dependency_edges').all() as unknown as EdgeRow[];

  const projects = new Map<ProjectId, Project>();
  for (const r of projectRows) {
    projects.set(projectId(r.id), {
      id: projectId(r.id),
      name: r.name,
      position: { x: r.position_x, y: r.position_y },
      width: r.width,
      height: r.height,
      colorIndex: r.color_index,
    });
  }

  const childTasks = new Map<ChildTaskId, ChildTask>();
  const childIdsByParent = new Map<string, ChildTaskId[]>();
  const seenOrder = new Map<string, number[]>();

  for (const r of childRows) {
    const id = childTaskId(r.id);
    childTasks.set(id, {
      id,
      parentId: taskId(r.parent_id),
      title: r.title,
      progress: r.progress,
      memo: r.memo,
    });

    const list = childIdsByParent.get(r.parent_id) ?? [];
    list.push(id);
    childIdsByParent.set(r.parent_id, list);

    const orders = seenOrder.get(r.parent_id) ?? [];
    orders.push(r.order_index);
    seenOrder.set(r.parent_id, orders);
  }

  assertOrderIndexConsistency(seenOrder);
  assertAcyclic(edgeRows);

  const tasks = new Map<TaskId, Task>();
  for (const r of taskRows) {
    const id = taskId(r.id);
    tasks.set(id, {
      id,
      title: r.title,
      progress: r.progress,
      position: { x: r.position_x, y: r.position_y },
      collapsed: r.collapsed === 1,
      memo: r.memo,
      childTaskIds: childIdsByParent.get(r.id) ?? [],
    });
  }

  const edges = new Map<EdgeId, DependencyEdge>();
  for (const r of edgeRows) {
    const id = edgeId(r.id);
    edges.set(id, { id, from: taskId(r.from_task_id), to: taskId(r.to_task_id) });
  }

  return { tasks, childTasks, edges, projects };
}

/**
 * 各親の order_index が 0..n-1 の連番になっていることを検証する。
 *
 * UNIQUE 制約を課さない代わりの安全網(design/persistence-design.md §3)。
 * 破れている場合は「起こってはならない状態」なので例外を投げる。
 */
function assertOrderIndexConsistency(ordersByParent: ReadonlyMap<string, number[]>): void {
  for (const [parent, orders] of ordersByParent) {
    const sorted = [...orders].sort((a, b) => a - b);
    const expected = sorted.every((value, index) => value === index);
    if (!expected) {
      throw new Error(
        `load: order_index of children under task ${parent} is not a 0..n-1 sequence: ${sorted.join(',')}`,
      );
    }
  }
}

/**
 * 依存グラフに循環がないこと(INV-3)を検証する。
 *
 * INV-3 は SQL の制約では表現できない(グラフ探索が必要)ため、DB 側に防波堤がない。
 * 通常の書き込み経路はドメイン層を通るので循環は生じないが、DBファイルが破損・
 * 手編集された場合は循環したまま読み込めてしまう。
 *
 * これを放置すると、削除時の再接続(design/domain-design.md §3.2)が
 * 「非循環である」という前提のもとで循環検知を省略しているため、自己ループ等の
 * さらに壊れた状態を生む。入口で止める。
 */
function assertAcyclic(edges: readonly EdgeRow[]): void {
  const successors = new Map<string, string[]>();
  for (const e of edges) {
    const list = successors.get(e.from_task_id) ?? [];
    list.push(e.to_task_id);
    successors.set(e.from_task_id, list);
  }

  // 帰りがけ順で塗り分ける深さ優先探索。探索中(gray)の頂点へ戻る辺が後退辺=循環。
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  const visit = (start: string): string | null => {
    const stack: { node: string; entering: boolean }[] = [{ node: start, entering: true }];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) break;

      if (!frame.entering) {
        color.set(frame.node, BLACK);
        continue;
      }
      if ((color.get(frame.node) ?? WHITE) !== WHITE) continue;

      color.set(frame.node, GRAY);
      stack.push({ node: frame.node, entering: false });

      for (const next of successors.get(frame.node) ?? []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) return next;
        if (c === WHITE) stack.push({ node: next, entering: true });
      }
    }
    return null;
  };

  for (const node of successors.keys()) {
    if ((color.get(node) ?? WHITE) !== WHITE) continue;
    const found = visit(node);
    if (found !== null) {
      throw new Error(
        `load: dependency graph contains a cycle involving task ${found}; refusing to load a corrupt database`,
      );
    }
  }
}

/**
 * 差分をトランザクション内で適用する。
 *
 * 外部キー制約を満たすため、削除は子側から、挿入は親側から行う。
 */
export function applyDiff(db: DatabaseSync, diff: GraphDiff): void {
  db.exec('BEGIN');
  try {
    // --- 削除: 子側から ---
    const deleteEdge = db.prepare('DELETE FROM dependency_edges WHERE id = ?');
    for (const id of diff.edges.deleted) deleteEdge.run(id);

    const deleteChild = db.prepare('DELETE FROM child_tasks WHERE id = ?');
    for (const id of diff.childTasks.deleted) deleteChild.run(id);

    const deleteTask = db.prepare('DELETE FROM tasks WHERE id = ?');
    for (const id of diff.tasks.deleted) deleteTask.run(id);

    const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');
    for (const id of diff.projects.deleted) deleteProject.run(id);

    // --- 挿入・更新: 親側から ---
    const upsertProject = db.prepare(
      `INSERT INTO projects (id, name, position_x, position_y, width, height, color_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         position_x = excluded.position_x,
         position_y = excluded.position_y,
         width = excluded.width,
         height = excluded.height,
         color_index = excluded.color_index`,
    );
    for (const r of [...diff.projects.inserted, ...diff.projects.updated]) {
      upsertProject.run(r.id, r.name, r.position_x, r.position_y, r.width, r.height, r.color_index);
    }

    const upsertTask = db.prepare(
      `INSERT INTO tasks (id, title, progress, position_x, position_y, collapsed, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         progress = excluded.progress,
         position_x = excluded.position_x,
         position_y = excluded.position_y,
         collapsed = excluded.collapsed,
         memo = excluded.memo`,
    );
    for (const r of [...diff.tasks.inserted, ...diff.tasks.updated]) {
      upsertTask.run(r.id, r.title, r.progress, r.position_x, r.position_y, r.collapsed, r.memo);
    }

    const upsertChild = db.prepare(
      `INSERT INTO child_tasks (id, parent_id, title, progress, order_index, memo)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         parent_id = excluded.parent_id,
         title = excluded.title,
         progress = excluded.progress,
         order_index = excluded.order_index,
         memo = excluded.memo`,
    );
    for (const r of [...diff.childTasks.inserted, ...diff.childTasks.updated]) {
      upsertChild.run(r.id, r.parent_id, r.title, r.progress, r.order_index, r.memo);
    }

    const upsertEdge = db.prepare(
      `INSERT INTO dependency_edges (id, from_task_id, to_task_id)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         from_task_id = excluded.from_task_id,
         to_task_id = excluded.to_task_id`,
    );
    for (const r of [...diff.edges.inserted, ...diff.edges.updated]) {
      upsertEdge.run(r.id, r.from_task_id, r.to_task_id);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
