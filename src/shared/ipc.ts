/**
 * renderer と main の間の契約。
 *
 * ドメインの TaskGraph は Map を含むため、そのまま渡さずプレーンな形へ落とす。
 * コマンドは判別可能ユニオン1本にまとめている。チャンネルを操作ごとに増やすより
 * 境界が1箇所で済み、Phase 4 の MCP ツールもほぼ同じ形を再利用できるため。
 */

export type Progress = 'not_done' | 'in_progress' | 'done';
export type Readiness = 'ready' | 'blocked';
export type Position = { x: number; y: number };

// --- 読み取り ---------------------------------------------------------------

export type ChildTaskSnapshot = {
  id: string;
  parentId: string;
  title: string;
  progress: Progress;
  /** 自由記述のメモ。空文字はメモなし。 */
  memo: string;
};

export type TaskSnapshot = {
  id: string;
  title: string;
  progress: Progress;
  /** 依存グラフから導出される。永続化されていない値。 */
  readiness: Readiness;
  /** 矩形に含まれているかで導出される。永続化されていない値(FR-4)。 */
  projectId: string | null;
  position: Position;
  collapsed: boolean;
  /** 自由記述のメモ。空文字はメモなし。 */
  memo: string;
  /** 表示順。配列の並びがそのまま 1番目・2番目… を表す。 */
  childTaskIds: string[];
};

export type GraphSnapshot = {
  tasks: TaskSnapshot[];
  childTasks: ChildTaskSnapshot[];
  edges: { id: string; from: string; to: string }[];
  /** Project はキャンバス上の領域。所属はここに含まれるかで決まる(FR-4)。 */
  projects: {
    id: string;
    name: string;
    position: Position;
    width: number;
    height: number;
    /** 表示側の配色表の何番目か。 */
    colorIndex: number;
  }[];
  canUndo: boolean;
  canRedo: boolean;
  /** 表示設定。グラフのデータではないため Undo 対象外(FR-6)。 */
  hideCompleted: boolean;
  dbPath: string;
};

/** 削除前にユーザーへ提示する変更内容(FR-1)。 */
export type DeletePlan = {
  taskId: string;
  removedEdges: { from: string; to: string }[];
  addedEdges: { from: string; to: string }[];
  removedChildTaskIds: string[];
};

// --- 書き込み ---------------------------------------------------------------

export type Command =
  | { type: 'createTask'; title: string; position: Position }
  | { type: 'updateTaskTitle'; id: string; title: string }
  | { type: 'setTaskProgress'; id: string; progress: Progress }
  | { type: 'moveTask'; id: string; position: Position }
  | { type: 'setTaskCollapsed'; id: string; collapsed: boolean }
  | { type: 'setTaskMemo'; id: string; memo: string }
  | {
      type: 'deleteTask';
      id: string;
      /**
       * 繋ぎ直すエッジを、ここに挙げたものだけに絞る(FR-1 の確認で外せる)。
       * 省略すると FR-3 の規則どおり全て繋ぎ直す。計画に無い組は無視される。
       */
      keepReconnections?: { from: string; to: string }[];
    }
  | { type: 'createChildTask'; parentId: string; title: string }
  | { type: 'updateChildTaskTitle'; id: string; title: string }
  | { type: 'setChildTaskProgress'; id: string; progress: Progress }
  | { type: 'setChildTaskMemo'; id: string; memo: string }
  | { type: 'deleteChildTask'; id: string }
  | { type: 'reorderChildTask'; id: string; newIndex: number }
  /*
    Task と childTask の入れ替え(W-3)

    分解してみたら独立した作業だった、逆に独立させていたが別の作業の一手順
    だった、というのは書き出している最中に起きる。書き直しではなく移動でやる。
  */
  | { type: 'demoteTaskToChild'; id: string; newParentId: string; index: number }
  | { type: 'promoteChildTask'; id: string; position: Position }
  | { type: 'moveChildTask'; id: string; newParentId: string; index: number }
  | { type: 'connect'; from: string; to: string }
  | { type: 'disconnect'; id: string }
  | {
      type: 'createProject';
      name: string;
      position: Position;
      width: number;
      height: number;
      colorIndex: number;
    }
  | { type: 'setProjectColor'; id: string; colorIndex: number }
  | { type: 'renameProject'; id: string; name: string }
  /** 枠を動かす。中に入っている Task も一緒に動く。 */
  | { type: 'moveProject'; id: string; position: Position }
  /** 枠の大きさを変える。中身は動かないので、所属が入れ替わる。 */
  | { type: 'resizeProject'; id: string; position: Position; width: number; height: number }
  | { type: 'deleteProject'; id: string }
  /**
   * 整列(FR-6)。Task の座標と Project の矩形をまとめて置き直す。
   *
   * 所属は位置から導出されるため、Task だけ動かすと枠から外れて所属が消える。
   * 枠も一緒に置き直して、整列の前後で所属が変わらないようにする。
   */
  | {
      type: 'applyLayout';
      positions: { id: string; position: Position }[];
      projects: { id: string; position: Position; width: number; height: number }[];
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setHideCompleted'; value: boolean };

/**
 * コマンドの戻り値。
 *
 * 失敗しても snapshot を返すのは、UI が「操作は失敗したが現在の状態はこれ」を
 * 一度に受け取れるようにするため。失敗を握りつぶさないこと —— ドメイン層が
 * Result で失敗を返している意味が、戻り値を読まないだけで失われる。
 */
export type CommandResult =
  | {
      ok: true;
      snapshot: GraphSnapshot;
      /**
       * 作成コマンドが作った要素の id。作成以外では null。
       *
       * renderer 側でスナップショットの差分から割り出すと、作成が2件同時に
       * 飛んだときに取り違える —— 2件目の応答には両方が含まれ、どちらが
       * 自分の作ったものか区別できない。main はコマンドを1件ずつ実行するので、
       * その前後を比べれば一意に決まる。
       */
      createdId: string | null;
    }
  | { ok: false; error: string; snapshot: GraphSnapshot };

export const IPC = {
  getGraph: 'graph:get',
  command: 'graph:command',
  /**
   * ある Task から接続可能な相手の一覧。
   *
   * React Flow の isValidConnection は同期APIだが、循環判定はドメイン層にあり
   * IPC 越し(非同期)になる。renderer 側で到達可能性を再計算すると
   * ドメインロジックの二重実装になるため、接続ドラッグの開始時に一覧を
   * 一度だけ取得し、以降は同期的に照合する。判定の実体はドメイン層のまま。
   */
  validTargets: 'graph:validTargets',
  planDelete: 'graph:planDelete',
} as const;
