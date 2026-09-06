import {
  createChildTask,
  deleteChildTask,
  reorderChildTask,
  setChildTaskMemo,
  setChildTaskProgress,
  updateChildTaskTitle,
} from './child-task';
import { canConnect } from './connect';
import { type DeleteTaskPlan, deleteTask, planDeleteTask } from './delete-task';
import type { DomainError } from './errors';
import type { IdGenerator } from './ids';
import type {
  ChildTaskId,
  EdgeId,
  Position,
  Progress,
  ProjectId,
  Readiness,
  TaskGraph,
  TaskId,
} from './model';
import {
  createProject,
  deleteProject,
  getAllTaskProjects,
  moveProject,
  projectOfTask,
  renameProject,
  resizeProject,
  setProjectColor,
} from './project';
import { getAllReadiness, readinessOf } from './readiness';
import { ok, okVoid, type Result } from './result';
import {
  applyLayout,
  connect,
  createTask,
  disconnect,
  moveTask,
  setTaskCollapsed,
  setTaskMemo,
  setTaskProgress,
  updateTaskTitle,
} from './task';

/**
 * ドメイン層のファサード(design/domain-design.md §4, §5)
 *
 * UI(IPC)経由の操作と AI(MCP)経由の操作は、必ずここを通る(FR-7.5)。
 * どちらか一方だけが通る経路を作ってはならない — 再接続ルール・循環防止・
 * Undo への記録がすべてここに集約されているため。
 *
 * Undo はスナップショット方式。逆操作を実装する方式と比較して、
 * 削除+再接続のような複合操作でも構造的に間違えようがないことを優先した。
 */

const DEFAULT_MAX_HISTORY = 50;

export class TaskGraphStore {
  #present: TaskGraph;
  #past: TaskGraph[] = [];
  #future: TaskGraph[] = [];
  #batchDepth = 0;

  readonly #newId: IdGenerator;
  readonly #maxHistory: number;

  constructor(initial: TaskGraph, newId: IdGenerator, maxHistory: number = DEFAULT_MAX_HISTORY) {
    this.#present = initial;
    this.#newId = newId;
    this.#maxHistory = maxHistory;
  }

  // --- 参照 -----------------------------------------------------------------

  get graph(): TaskGraph {
    return this.#present;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  readinessOf(id: TaskId): Readiness {
    return readinessOf(this.#present, id);
  }

  getAllReadiness(): ReadonlyMap<TaskId, Readiness> {
    return getAllReadiness(this.#present);
  }

  /** Task が属する Project。矩形に含まれているかで決まる(FR-4)。 */
  projectOfTask(id: TaskId): ProjectId | null {
    return projectOfTask(this.#present, id);
  }

  getAllTaskProjects(): ReadonlyMap<TaskId, ProjectId | null> {
    return getAllTaskProjects(this.#present);
  }

  /** UI の isValidConnection から同期的に呼ばれる。副作用を持たない。 */
  canConnect(from: TaskId, to: TaskId): boolean {
    return canConnect(this.#present, from, to).ok;
  }

  /** 削除前に変更内容を提示するための計画(FR-1)。 */
  planDeleteTask(id: TaskId): Result<DeleteTaskPlan, DomainError> {
    return planDeleteTask(this.#present, id);
  }

  // --- 履歴 -----------------------------------------------------------------

  undo(): boolean {
    const previous = this.#past.pop();
    if (previous === undefined) return false;
    this.#future.push(this.#present);
    this.#present = previous;
    return true;
  }

  redo(): boolean {
    const next = this.#future.pop();
    if (next === undefined) return false;
    this.#past.push(this.#present);
    this.#present = next;
    return true;
  }

  /**
   * 複数の操作を1回の Undo 単位にまとめる(FR-8)。
   *
   * AI が1回の呼び出しで複数のTaskを削除するようなケースで、
   * ユーザーが Undo 1回で元に戻せるようにするためのもの。
   * 途中で失敗した場合は全体をロールバックする(部分適用しない)。
   */
  batch(fn: () => Result<unknown, DomainError>): Result<void, DomainError> {
    const before = this.#present;
    this.#batchDepth += 1;

    let result: Result<unknown, DomainError>;
    try {
      result = fn();
    } catch (e) {
      this.#present = before;
      this.#batchDepth -= 1;
      throw e;
    }
    this.#batchDepth -= 1;

    if (!result.ok) {
      this.#present = before;
      return result;
    }

    if (this.#batchDepth === 0 && this.#present !== before) {
      this.#pushHistory(before);
    }
    return okVoid;
  }

  /**
   * 状態を指定のグラフへ強制的に戻し、履歴を破棄する。
   *
   * 永続化に失敗してメモリとDBが食い違ったときの復旧にのみ使う
   * (app-service.ts)。通常の操作経路では呼ばないこと。
   * 履歴を残すと「DBに存在しない状態」へ Undo できてしまうため破棄する。
   */
  resetTo(graph: TaskGraph): void {
    this.#present = graph;
    this.#past = [];
    this.#future = [];
  }

  #pushHistory(before: TaskGraph): void {
    this.#past.push(before);
    if (this.#past.length > this.#maxHistory) this.#past.shift();
    // 新しい操作を行った時点で Redo の分岐は破棄される
    this.#future = [];
  }

  /**
   * 1つの操作を適用する。
   * 失敗した場合は状態も履歴も変更しない — 失敗を Undo 対象にする意味はないため。
   */
  #run(fn: (graph: TaskGraph) => Result<TaskGraph, DomainError>): Result<void, DomainError> {
    const before = this.#present;
    const result = fn(before);
    if (!result.ok) return result;

    this.#present = result.value;
    if (this.#batchDepth === 0) this.#pushHistory(before);
    return okVoid;
  }

  // --- コマンド: Task -------------------------------------------------------

  createTask(title: string, position: Position): Result<void, DomainError> {
    return this.#run((g) => createTask(g, title, position, this.#newId));
  }

  updateTaskTitle(id: TaskId, title: string): Result<void, DomainError> {
    return this.#run((g) => updateTaskTitle(g, id, title));
  }

  setTaskProgress(id: TaskId, progress: Progress): Result<void, DomainError> {
    return this.#run((g) => setTaskProgress(g, id, progress));
  }

  /**
   * ドラッグ確定時に1回だけ呼ぶこと(design/domain-design.md §4)。
   * ドラッグ中の中間座標を渡すと、履歴が中間状態で埋まり Undo が機能しなくなる。
   */
  moveTask(id: TaskId, position: Position): Result<void, DomainError> {
    return this.#run((g) => moveTask(g, id, position));
  }

  setTaskMemo(id: TaskId, memo: string): Result<void, DomainError> {
    return this.#run((g) => setTaskMemo(g, id, memo));
  }

  setTaskCollapsed(id: TaskId, collapsed: boolean): Result<void, DomainError> {
    return this.#run((g) => setTaskCollapsed(g, id, collapsed));
  }

  deleteTask(id: TaskId): Result<void, DomainError> {
    return this.#run((g) => deleteTask(g, id, this.#newId));
  }

  // --- コマンド: childTask --------------------------------------------------

  createChildTask(parentId: TaskId, title: string): Result<void, DomainError> {
    return this.#run((g) => createChildTask(g, parentId, title, this.#newId));
  }

  updateChildTaskTitle(id: ChildTaskId, title: string): Result<void, DomainError> {
    return this.#run((g) => updateChildTaskTitle(g, id, title));
  }

  setChildTaskMemo(id: ChildTaskId, memo: string): Result<void, DomainError> {
    return this.#run((g) => setChildTaskMemo(g, id, memo));
  }

  setChildTaskProgress(id: ChildTaskId, progress: Progress): Result<void, DomainError> {
    return this.#run((g) => setChildTaskProgress(g, id, progress));
  }

  deleteChildTask(id: ChildTaskId): Result<void, DomainError> {
    return this.#run((g) => deleteChildTask(g, id));
  }

  reorderChildTask(id: ChildTaskId, newIndex: number): Result<void, DomainError> {
    return this.#run((g) => reorderChildTask(g, id, newIndex));
  }

  // --- コマンド: エッジ / Project / レイアウト -------------------------------

  connect(from: TaskId, to: TaskId): Result<void, DomainError> {
    return this.#run((g) => connect(g, from, to, this.#newId));
  }

  disconnect(id: EdgeId): Result<void, DomainError> {
    return this.#run((g) => disconnect(g, id));
  }

  createProject(
    name: string,
    position: Position,
    width: number,
    height: number,
    colorIndex: number,
  ): Result<void, DomainError> {
    return this.#run((g) =>
      createProject(g, name, position, width, height, colorIndex, this.#newId),
    );
  }

  setProjectColor(id: ProjectId, colorIndex: number): Result<void, DomainError> {
    return this.#run((g) => setProjectColor(g, id, colorIndex));
  }

  renameProject(id: ProjectId, name: string): Result<void, DomainError> {
    return this.#run((g) => renameProject(g, id, name));
  }

  /** 枠を動かす。中に入っている Task も一緒に動く。 */
  moveProject(id: ProjectId, position: Position): Result<void, DomainError> {
    return this.#run((g) => moveProject(g, id, position));
  }

  /** 枠の大きさを変える。中身は動かないので、所属が入れ替わる。 */
  resizeProject(
    id: ProjectId,
    position: Position,
    width: number,
    height: number,
  ): Result<void, DomainError> {
    return this.#run((g) => resizeProject(g, id, position, width, height));
  }

  deleteProject(id: ProjectId): Result<void, DomainError> {
    return this.#run((g) => deleteProject(g, id));
  }

  /**
   * 整列操作(FR-6)。1回の確定操作として履歴に積む。
   * Task の座標と Project の矩形をまとめて置き直す —— 別々に適用すると
   * 途中で所属が変わり、Undo も2回に分かれてしまう。
   */
  applyLayout(
    positions: readonly { readonly id: TaskId; readonly position: Position }[],
    projectRects: readonly {
      readonly id: ProjectId;
      readonly position: Position;
      readonly width: number;
      readonly height: number;
    }[] = [],
  ): Result<void, DomainError> {
    return this.#run((g) => {
      const laid = applyLayout(g, positions);
      if (!laid.ok) return laid;

      let graph = laid.value;
      for (const rect of projectRects) {
        const resized = resizeProject(graph, rect.id, rect.position, rect.width, rect.height);
        if (!resized.ok) return resized;
        graph = resized.value;
      }
      return ok(graph);
    });
  }
}
