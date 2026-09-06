import type { Progress, TaskGraph } from '../domain/model';

/**
 * DB の行としての表現(design/persistence-design.md)
 *
 * ドメインモデルとは形が違う。特に childTask の順序は、ドメインでは
 * 親Taskの childTaskIds 配列で表現されるが、DB では child_tasks.order_index
 * という列で表現される。この変換はここに閉じ込める。
 */

export type ProjectRow = {
  id: string;
  name: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  color_index: number;
};

export type TaskRow = {
  id: string;
  title: string;
  progress: Progress;
  // project_id は持たない → Project の矩形に含まれているかで導出する(FR-4)
  position_x: number;
  position_y: number;
  collapsed: number; // SQLite に boolean 型がないため 0/1
  memo: string;
};

export type ChildTaskRow = {
  id: string;
  parent_id: string;
  title: string;
  progress: Progress;
  order_index: number;
  memo: string;
};

export type EdgeRow = { id: string; from_task_id: string; to_task_id: string };

export type GraphRows = {
  projects: Map<string, ProjectRow>;
  tasks: Map<string, TaskRow>;
  childTasks: Map<string, ChildTaskRow>;
  edges: Map<string, EdgeRow>;
};

/** ドメインのグラフを DB の行へ射影する。 */
export function toRows(graph: TaskGraph): GraphRows {
  const projects = new Map<string, ProjectRow>();
  for (const p of graph.projects.values()) {
    projects.set(p.id, {
      id: p.id,
      name: p.name,
      position_x: p.position.x,
      position_y: p.position.y,
      width: p.width,
      height: p.height,
      color_index: p.colorIndex,
    });
  }

  const tasks = new Map<string, TaskRow>();
  const childTasks = new Map<string, ChildTaskRow>();

  for (const t of graph.tasks.values()) {
    tasks.set(t.id, {
      id: t.id,
      title: t.title,
      progress: t.progress,
      position_x: t.position.x,
      position_y: t.position.y,
      collapsed: t.collapsed ? 1 : 0,
      memo: t.memo,
    });

    // 配列の並びを order_index に変換する。これが唯一の順序の出所。
    t.childTaskIds.forEach((childId, index) => {
      const child = graph.childTasks.get(childId);
      if (!child) {
        // INV-8(配列と実体の一致)が破れている
        throw new Error(`toRows: child ${childId} listed in task ${t.id} does not exist`);
      }
      childTasks.set(child.id, {
        id: child.id,
        parent_id: child.parentId,
        title: child.title,
        progress: child.progress,
        order_index: index,
        memo: child.memo,
      });
    });
  }

  const edges = new Map<string, EdgeRow>();
  for (const e of graph.edges.values()) {
    edges.set(e.id, { id: e.id, from_task_id: e.from, to_task_id: e.to });
  }

  return { projects, tasks, childTasks, edges };
}
