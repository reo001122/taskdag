import { type DomainError, projectNotFound, taskNotFound } from './errors';
import type { IdGenerator } from './ids';
import {
  type Position,
  type Project,
  type ProjectId,
  projectId,
  type TaskGraph,
  type TaskId,
} from './model';
import { err, ok, type Result } from './result';

/**
 * Project の操作と所属の導出(FR-4)
 *
 * Project はキャンバス上の領域であり、タスクに貼るタグではない。
 * 「どの Task がどの Project に属するか」は保存せず、矩形に含まれているかで
 * 常に導出する。導出値を保存すると、位置とラベルが食い違う状態が生まれる
 * (design/coding-standards.md §4)。
 */

/**
 * 含まれているかの判定は Task の左上の点 で行う。
 *
 * 中心点で判定するほうが直感には近いが、それには Task の描画サイズが必要で、
 * サイズは表示側の都合であってドメインが知るべきものではない。
 * 左上の点なら位置情報だけで決まり、SQL でも同じ式で書ける。
 */
function contains(project: Project, position: Position): boolean {
  return (
    position.x >= project.position.x &&
    position.x <= project.position.x + project.width &&
    position.y >= project.position.y &&
    position.y <= project.position.y + project.height
  );
}

/**
 * Task が属する Project。属さなければ null。
 *
 * 矩形が重なっている場合は 面積が最も小さいもの を選ぶ。
 * 大きな枠の中に小さな枠を置いたとき、より限定的なほうが意図に近いため。
 * 面積が同じときは id の小さいほうにする —— SQL 側のビューと同じ順序に
 * しておかないと、同じ問い合わせで違う答えが出る。
 */
export function projectOfTask(graph: TaskGraph, id: TaskId): ProjectId | null {
  const task = graph.tasks.get(id);
  if (!task) return null;

  let best: Project | null = null;
  for (const project of graph.projects.values()) {
    if (!contains(project, task.position)) continue;
    if (best === null) {
      best = project;
      continue;
    }
    const area = project.width * project.height;
    const bestArea = best.width * best.height;
    if (area < bestArea || (area === bestArea && project.id < best.id)) best = project;
  }
  return best?.id ?? null;
}

export function tasksInProject(graph: TaskGraph, id: ProjectId): TaskId[] {
  return [...graph.tasks.keys()].filter((taskId) => projectOfTask(graph, taskId) === id);
}

export function getAllTaskProjects(graph: TaskGraph): ReadonlyMap<TaskId, ProjectId | null> {
  const result = new Map<TaskId, ProjectId | null>();
  for (const id of graph.tasks.keys()) result.set(id, projectOfTask(graph, id));
  return result;
}

export function createProject(
  graph: TaskGraph,
  name: string,
  position: Position,
  width: number,
  height: number,
  colorIndex: number,
  newId: IdGenerator,
): Result<TaskGraph, DomainError> {
  const id = projectId(newId());
  const projects = new Map(graph.projects);
  projects.set(id, { id, name, position, width, height, colorIndex });
  return ok({ ...graph, projects });
}

export function setProjectColor(
  graph: TaskGraph,
  id: ProjectId,
  colorIndex: number,
): Result<TaskGraph, DomainError> {
  const project = graph.projects.get(id);
  if (!project) return err(projectNotFound(id));

  const projects = new Map(graph.projects);
  projects.set(id, { ...project, colorIndex });
  return ok({ ...graph, projects });
}

export function renameProject(
  graph: TaskGraph,
  id: ProjectId,
  name: string,
): Result<TaskGraph, DomainError> {
  const project = graph.projects.get(id);
  if (!project) return err(projectNotFound(id));

  const projects = new Map(graph.projects);
  projects.set(id, { ...project, name });
  return ok({ ...graph, projects });
}

/**
 * 枠を動かす。中に入っている Task も同じだけ動かす。
 *
 * 所属は位置から導出されるため、中身を置き去りにすると枠から外れてしまう。
 * 一緒に動かすことで、プロジェクトごとまとめて配置を整理できる。
 */
export function moveProject(
  graph: TaskGraph,
  id: ProjectId,
  position: Position,
): Result<TaskGraph, DomainError> {
  const project = graph.projects.get(id);
  if (!project) return err(projectNotFound(id));

  const dx = position.x - project.position.x;
  const dy = position.y - project.position.y;

  // 移動前の時点で中にいた Task を対象にする
  const members = tasksInProject(graph, id);

  const projects = new Map(graph.projects);
  projects.set(id, { ...project, position });

  const tasks = new Map(graph.tasks);
  for (const taskId of members) {
    const task = tasks.get(taskId);
    if (!task) continue;
    tasks.set(taskId, {
      ...task,
      position: { x: task.position.x + dx, y: task.position.y + dy },
    });
  }

  return ok({ ...graph, tasks, projects });
}

/**
 * 枠の大きさを変える。中身は動かさない。
 * 広げれば新しい Task を取り込み、狭めれば外れる。
 */
export function resizeProject(
  graph: TaskGraph,
  id: ProjectId,
  position: Position,
  width: number,
  height: number,
): Result<TaskGraph, DomainError> {
  const project = graph.projects.get(id);
  if (!project) return err(projectNotFound(id));

  const projects = new Map(graph.projects);
  projects.set(id, {
    ...project,
    position,
    width: Math.max(1, width),
    height: Math.max(1, height),
  });
  return ok({ ...graph, projects });
}

/**
 * Project を削除する。
 *
 * Task は消さない。Project は領域であって入れ物ではないため、
 * 枠を消せば所属が外れるだけで、中にあったものはその場に残る。
 */
export function deleteProject(graph: TaskGraph, id: ProjectId): Result<TaskGraph, DomainError> {
  if (!graph.projects.has(id)) return err(projectNotFound(id));

  const projects = new Map(graph.projects);
  projects.delete(id);
  return ok({ ...graph, projects });
}

/** Task が存在することを確かめてから所属を返す。 */
export function projectOfTaskChecked(
  graph: TaskGraph,
  id: TaskId,
): Result<ProjectId | null, DomainError> {
  if (!graph.tasks.has(id)) return err(taskNotFound(id));
  return ok(projectOfTask(graph, id));
}
