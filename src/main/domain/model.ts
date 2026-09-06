/**
 * ドメインモデル(design/domain-design.md §1)
 *
 * このファイルは Electron / SQLite / React に一切依存しない。
 * 依存を持ち込まないこと — ドメイン層は UI 経由の操作と AI(MCP)経由の操作の
 * 唯一の合流点であり、どちらのフレームワークにも縛られてはならない。
 */

// --- 識別子 -----------------------------------------------------------------
// 素の string を使わず branded type にする。TaskId と ChildTaskId の取り違えを
// コンパイル時に防ぐため(design/coding-standards.md §2)。

export type TaskId = string & { readonly __brand: 'TaskId' };
export type ChildTaskId = string & { readonly __brand: 'ChildTaskId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };

export const taskId = (value: string): TaskId => value as TaskId;
export const childTaskId = (value: string): ChildTaskId => value as ChildTaskId;
export const projectId = (value: string): ProjectId => value as ProjectId;
export const edgeId = (value: string): EdgeId => value as EdgeId;

// --- 状態 -------------------------------------------------------------------

/** 軸b: 本人が申告する状態(FR-5)。導出できないため永続化する。 */
export type Progress = 'not_done' | 'in_progress' | 'done';

/**
 * 軸a: 依存グラフから導出される状態(FR-5)。
 * 永続化しない — 導出値を保存すると更新漏れによる不整合が必ず発生するため
 * (design/coding-standards.md §4)。
 */
export type Readiness = 'ready' | 'blocked';

// --- エンティティ -------------------------------------------------------------

export type Position = { readonly x: number; readonly y: number };

export type Task = {
  readonly id: TaskId;
  readonly title: string;
  readonly progress: Progress;
  // projectId を持たない → Project の矩形に含まれているかで導出する(FR-4)
  /** 手動配置(FR-6)。システムは勝手に変更しない。 */
  readonly position: Position;
  readonly collapsed: boolean;
  /**
   * 自由記述のメモ。空文字はメモなしを意味する。
   *
   * 中断して戻ってきたときに読み返すためのもの。作業しながら書き足していく
   * 性質なので、構造を持たせず1つの本文として扱う。
   */
  readonly memo: string;
  /** 配列の順序が childTask の表示順(FR-2)。順序番号は保持しない。 */
  readonly childTaskIds: readonly ChildTaskId[];
};

export type ChildTask = {
  readonly id: ChildTaskId;
  readonly parentId: TaskId;
  readonly title: string;
  readonly progress: Progress;
  /** 自由記述のメモ。空文字はメモなし(Task と同じ扱い)。 */
  readonly memo: string;
  // projectId は持たない → 親から導出(FR-4)
  // position は持たない  → 親ノード内に描画される
  // readiness は持たない → v1では軸aを持たない(FR-5)
};

/**
 * 依存エッジ(FR-3)。v1では厳密(strict)のみ。
 *
 * kind フィールドは持たせない。常に同じ値しか取らないフィールドは
 * 読み手に「他の値があるのでは」と誤読させるため(design/domain-design.md §1)。
 * Phase 2 で緩やかな依存を追加する際は、readiness の導出だけを変更すればよい。
 */
export type DependencyEdge = {
  readonly id: EdgeId;
  /** 先行。これが done になると to が解放される。 */
  readonly from: TaskId;
  /** 後続。 */
  readonly to: TaskId;
};

/**
 * Project(FR-4)
 *
 * タスクに貼るタグではなく、キャンバス上の領域である。
 * 所属は「Task がこの矩形の中にあるか」だけで決まり、保存しない。
 * Ready/Blocked と同じく導出値として扱う —— 位置とラベルが食い違う状態が
 * 原理的に起きなくなる。
 */
export type Project = {
  readonly id: ProjectId;
  readonly name: string;
  /** 矩形の左上。 */
  readonly position: Position;
  readonly width: number;
  readonly height: number;
  /**
   * 割り当てられた色。表示側が持つ配色表の何番目か。
   *
   * 色そのものではなく番号を持つのは、配色表を後から差し替えられるようにするため。
   * 見た目の値をデータに焼き付けると、配色を変えたときに既存の Project だけ
   * 古い色のまま取り残される。
   */
  readonly colorIndex: number;
};

export type TaskGraph = {
  readonly tasks: ReadonlyMap<TaskId, Task>;
  readonly childTasks: ReadonlyMap<ChildTaskId, ChildTask>;
  readonly edges: ReadonlyMap<EdgeId, DependencyEdge>;
  readonly projects: ReadonlyMap<ProjectId, Project>;
};

export const emptyGraph: TaskGraph = {
  tasks: new Map(),
  childTasks: new Map(),
  edges: new Map(),
  projects: new Map(),
};
