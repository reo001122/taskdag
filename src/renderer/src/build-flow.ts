import { type Edge, MarkerType, type Node } from '@xyflow/react';
import type { Rect } from '../../shared/geometry';
import type { Command, GraphSnapshot } from '../../shared/ipc';
import { projectColorAt } from './colors';
import type { DependencyEdgeData } from './DependencyEdge';
import type { ProjectNodeData } from './ProjectNode';
import type { AutoEdit, TaskNodeData } from './TaskNode';

/*
  スナップショットから React Flow に渡す配列を作る、副作用のない変換。

  引数に無いものは読まない。ノードとエッジで入力が違う —— エッジは印(cursor)にも
  編集要求にも依存しないので、別の関数に分けてある。App.tsx 側の useMemo も
  この境界で分かれていて、印が動いてもエッジは作り直されない。
*/

/** 完了済みを隠す設定のとき、隠す Task の id。 */
function hiddenTaskIds(snapshot: GraphSnapshot): Set<string> {
  return new Set(
    snapshot.hideCompleted
      ? snapshot.tasks.filter((t) => t.progress === 'done').map((t) => t.id)
      : [],
  );
}

/** Project の枠が受け取るコールバック。 */
export type ProjectFrameHandlers = {
  send: (command: Command) => void;
  markFrameBlocked: (key: string, rect: Rect | null) => void;
  wouldOverlap: (id: string, rect: Rect) => boolean;
  restoreFrameSize: (id: string) => void;
};

/** Task が受け取るコールバックのうち、Task の data へそのまま渡すもの。 */
export type TaskHandlers = Pick<
  TaskNodeData,
  | 'send'
  | 'requestDelete'
  | 'requestArchive'
  | 'onAutoEditConsumed'
  | 'onAutoMemoConsumed'
  | 'onChildChainAdd'
  | 'onChildRemoveWhileEditing'
  | 'onChildDropped'
  | 'onRowPressed'
>;

/** 印と編集要求。ノードの data にだけ入り、エッジには関係しない。 */
export type TaskViewState = {
  autoEdit: AutoEdit;
  autoMemo: string | null;
  /** その Task で印が付いている childTask の id。指していなければ null。 */
  cursorIn: (taskId: string) => string | null;
};

export function buildProjectFrames(
  snapshot: GraphSnapshot,
  handlers: ProjectFrameHandlers,
): Node[] {
  const { send, markFrameBlocked, wouldOverlap, restoreFrameSize } = handlers;
  return snapshot.projects.map((project) => {
    const data: ProjectNodeData = {
      id: project.id,
      name: project.name,
      color: projectColorAt(project.colorIndex),
      colorIndex: project.colorIndex,
      onRecolor: (id, colorIndex) => send({ type: 'setProjectColor', id, colorIndex }),
      onResizing: (id: string, rect: Rect) => markFrameBlocked(`project:${id}`, rect),
      onResizeEnd: (id, position, width, height) => {
        markFrameBlocked(`project:${id}`, null);
        // 相手に届く大きさで離したら、送らずに元の寸法へ戻す(FR-4)。
        if (wouldOverlap(id, { ...position, width, height })) {
          restoreFrameSize(id);
          return;
        }
        send({ type: 'resizeProject', id, position, width, height });
      },
      onRename: (id, name) => send({ type: 'renameProject', id, name }),
      onDelete: (id) => send({ type: 'deleteProject', id }),
    };
    return {
      id: `project:${project.id}`,
      type: 'projectFrame',
      position: project.position,
      data: data as never,
      // dragHandle は指定しない。枠の内側のどこを掴んでも動く。
      // 中の Task は手前(zIndex 0)にいるので、今までどおり個別に掴める。
      // Task より背面に置く
      zIndex: -1,
      style: { width: project.width, height: project.height },
    };
  });
}

export function buildTaskNodes(
  snapshot: GraphSnapshot,
  handlers: TaskHandlers,
  view: TaskViewState,
): Node[] {
  const hidden = hiddenTaskIds(snapshot);

  const colorOf = new Map(
    snapshot.projects.map((p) => [p.id, projectColorAt(p.colorIndex)] as const),
  );

  const childrenByParent = new Map<string, GraphSnapshot['childTasks']>();
  for (const child of snapshot.childTasks) {
    const list = childrenByParent.get(child.parentId) ?? [];
    list.push(child);
    childrenByParent.set(child.parentId, list);
  }

  return snapshot.tasks
    .filter((t) => !hidden.has(t.id))
    .map((task) => {
      // childTaskIds の並びが表示順。実体を並び順どおりに引き当てる。
      const pool = childrenByParent.get(task.id) ?? [];
      const ordered = task.childTaskIds
        .map((id) => pool.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);

      const data: TaskNodeData = {
        task,
        children: ordered,
        projectColor: task.projectId === null ? null : (colorOf.get(task.projectId) ?? null),
        hideCompleted: snapshot.hideCompleted,
        autoMemo: view.autoMemo,
        autoEdit: view.autoEdit,
        cursorChildId: view.cursorIn(task.id),
        ...handlers,
      };
      return {
        id: task.id,
        type: 'task',
        // 取っ手からだけ動かす(FR-6)。本体のどこでも掴めると、childTask の
        // 取っ手との違いが読めず、掴めるかどうかが場所ごとに変わる。
        dragHandle: '.task-grip',
        position: task.position,
        data: data as never,
      };
    });
}

/**
 * 依存エッジ。入力はスナップショットと削除のコールバックだけ。
 *
 * 非表示の Task に繋がるエッジは描かない。
 * 結果として残るエッジは「まだ実際にブロックしているもの」だけになる(FR-6)。
 */
export function buildEdges(snapshot: GraphSnapshot, onRemove: (id: string) => void): Edge[] {
  const hidden = hiddenTaskIds(snapshot);
  return snapshot.edges
    .filter((e) => !hidden.has(e.from) && !hidden.has(e.to))
    .map((e) => {
      const data: DependencyEdgeData = { onRemove };
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'dependency',
        data: data as never,
        // 向きが依存の向きそのもの。線だけでは「どちらが先か」が伝わらない。
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      };
    });
}

/**
 * 作り直したノードを、既にあるものへ重ねる。丸ごと差し替えない。
 *
 * React Flow はノードを差し替えられると、そのノードの measured(測った寸法)を
 * 受け取り直す。こちらが作る側は寸法を知らないので undefined になり、
 * 測り直しが終わるまでの1フレーム、そのノードは visibility: hidden にされる。
 * グラフが変わるたびに画面がちらつく原因がこれだった(実測: 削除時に 333H222…)。
 * 端点の寸法が無い間はエッジも描かれないので、矢印も同じ1フレーム消える。
 *
 * 重ねれば measured がそのまま残る。React Flow が持たせている選択状態も
 * 巻き添えで消えなくなる。
 */
export function mergeNodes(current: Node[], built: Node[]): Node[] {
  const existing = new Map(current.map((node) => [node.id, node]));
  return built.map((node) => {
    const before = existing.get(node.id);
    if (!before) return node;
    /*
      大きさだけは引き継がない。

      枠の大きさを変えると React Flow はノードに width / height を書き込み、
      以降そちらを style より優先して読む。重ねるときにそれを残すと、
      Undo でスナップショットが前の大きさへ戻っても、画面は変形後のまま
      になる(実測: 460×340 → 400×295 にしてから Cmd+Z しても 400×295)。
      幾何はこちらが持っている値が正なので、毎回 style から読ませる。
    */
    return { ...before, ...node, width: undefined, height: undefined };
  });
}
