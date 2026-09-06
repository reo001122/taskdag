import { Handle, Position as HandlePosition, type NodeProps, NodeResizer } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import type { ChildTaskSnapshot, Command, Progress, TaskSnapshot } from '../../shared/ipc';
import { PROJECT_COLORS } from './colors';

/**
 * Task のカスタムノード(FR-2, FR-5, FR-6)
 *
 * 表示と操作の発火のみを担う。状態の正しさを判断しないこと
 * (design/coding-standards.md §1)。Ready/Blocked も props で受け取るだけで、
 * ここで計算してはならない。
 *
 * 子タスクを持たない Task は1行に収める。分解はしたくなったときに足すもので、
 * 最初から枠だけ用意しておくと、単体の Task ばかりのときに画面が無駄に嵩む。
 */

export type TaskNodeData = {
  task: TaskSnapshot;
  children: ChildTaskSnapshot[];
  /** 所属先の色。Project ごとに決まる。属していなければ null。 */
  projectColor: string | null;
  hideCompleted: boolean;
  /** 作成直後の子タスクを、追加と同時に編集状態にするための目印。 */
  autoEditLastChild: boolean;
  /** 作成直後の Task を、追加と同時に編集状態にするための目印。 */
  autoEditTitle: boolean;
  send: (command: Command) => void;
  requestDelete: (id: string) => void;
  onAutoEditConsumed: () => void;
  /** 入力中に Enter が押された。続けてもう1件足す。 */
  onChildChainAdd: (parentId: string) => void;
};

/** 未着手 → 着手中 → 完了 → 未着手 と巡回する。 */
const nextProgress = (current: Progress): Progress =>
  current === 'not_done' ? 'in_progress' : current === 'in_progress' ? 'done' : 'not_done';

const PROGRESS_CLASS: Record<Progress, string> = {
  not_done: 'is-not-done',
  in_progress: 'is-in-progress',
  done: 'is-done',
};

const PROGRESS_LABEL: Record<Progress, string> = {
  not_done: '未着手',
  in_progress: '着手中',
  done: '完了',
};

/**
 * 状態の表示(FR-5)
 *
 * 文字の記号(○ ◐ ●)ではなく塗り分けた四角にしている。記号は小さいと
 * 見分けがつかず、状態がひと目で分からなかった。
 */
function StateToggle({
  progress,
  onToggle,
}: {
  progress: Progress;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`state-toggle nodrag ${PROGRESS_CLASS[progress]}`}
      title={`${PROGRESS_LABEL[progress]}(クリックで変更)`}
      onClick={onToggle}
    >
      <span className="state-box" />
    </button>
  );
}

function EditableText({
  value,
  className,
  startEditing: startInEditMode = false,
  onCommit,
  onEditEnd,
  onEnterChain,
}: {
  value: string;
  className: string;
  startEditing?: boolean;
  onCommit: (next: string) => void;
  onEditEnd?: () => void;
  /** Enter で確定したときに呼ばれる。続けて次の項目を足す用。 */
  onEnterChain?: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(startInEditMode);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // autoFocus 属性はスクリーンリーダーの読み上げ位置を突然動かすため使わない。
  // 編集に切り替わった時点で明示的にフォーカスする。
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const begin = (): void => {
    setDraft(value);
    setEditing(true);
  };

  const finish = (chain: boolean): void => {
    setEditing(false);
    onEditEnd?.();
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== value) onCommit(trimmed);
    if (chain) onEnterChain?.();
  };

  if (!editing) {
    // 見た目は文章だが、実際には編集を起動する操作子なので button にする。
    // ワンクリックで編集に入る。ドラッグは mousedown + 移動なので click は
    // 発火せず、ノードの移動とは競合しない。
    return (
      <button
        type="button"
        className={`${className} nodrag`}
        // React Flow はノードを選択するときに、ノード要素へフォーカスを移す。
        // それが起きると、直後に開いた入力欄が即座に blur して編集が閉じてしまう。
        // ここで mousedown を止めて、React Flow に処理させない。
        onMouseDown={(e) => e.stopPropagation()}
        onClick={begin}
        onKeyDown={(e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            begin();
          }
        }}
        title="クリック、または F2 で編集"
      >
        {value}
      </button>
    );
  }

  return (
    <input
      // nodrag: 入力中にドラッグ扱いされると文字を選択できない(React Flow の規約)
      className={`text-input nodrag`}
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(false)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 日本語入力の変換確定の Enter を、確定操作と取り違えない。
        // IME 変換中の Enter は「変換を決める」ためのものであって、
        // 入力を終える意思表示ではない。
        if (e.nativeEvent.isComposing) return;

        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        }
        if (e.key === 'Escape') {
          setEditing(false);
          onEditEnd?.();
        }
      }}
      // キャンバスのショートカット(Undo など)に横取りされないようにする
      onKeyDownCapture={(e) => e.stopPropagation()}
    />
  );
}

/**
 * 自由記述のメモ(FR-10)
 *
 * タイトルのすぐ下に、小さく淡い文字で本文として出す。入力欄の箱にすると、
 * 書いていないときにも場所を取り、Task が縦に嵩む。
 *
 * 保存は確定(フォーカスが外れる)時だけ。一文字ごとに保存すると Undo 履歴が
 * 打鍵で埋まり、Cmd+Z が使い物にならなくなる(ドラッグの座標と同じ理由)。
 */
function Memo({
  memo,
  startEditing,
  onCommit,
  onEditEnd,
}: {
  memo: string;
  startEditing: boolean;
  onCommit: (next: string) => void;
  onEditEnd: () => void;
}): React.JSX.Element | null {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo);
  const ref = useRef<HTMLTextAreaElement>(null);

  // ✎ が押されたら編集に入る
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing]);

  // 他の経路(AI 等)で書き換わったときに追従する
  useEffect(() => {
    setDraft(memo);
  }, [memo]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const finish = (): void => {
    setEditing(false);
    onEditEnd();
    if (draft !== memo) onCommit(draft);
  };

  if (!editing) {
    if (memo.length === 0) return null;
    return (
      <button
        type="button"
        className="memo-text nodrag"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setEditing(true)}
        title="クリックで編集"
      >
        {memo}
      </button>
    );
  }

  return (
    <textarea
      className="memo-input nodrag"
      ref={ref}
      value={draft}
      rows={2}
      placeholder="メモ"
      onChange={(e) => setDraft(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={finish}
      onKeyDown={(e) => {
        // Enter は改行。Escape で編集をやめる。
        if (e.key === 'Escape') {
          setEditing(false);
          onEditEnd();
          setDraft(memo);
        }
      }}
      // Enter で改行できるよう、キャンバスのショートカットに渡さない
      onKeyDownCapture={(e) => e.stopPropagation()}
    />
  );
}

export function TaskNode({ data }: NodeProps): React.JSX.Element {
  const {
    task,
    children,
    projectColor,
    hideCompleted,
    autoEditLastChild,
    autoEditTitle,
    send,
    requestDelete,
    onAutoEditConsumed,
    onChildChainAdd,
  } = data as unknown as TaskNodeData;

  const isDone = task.progress === 'done';
  const isActive = task.progress === 'in_progress';
  const isBlocked = task.readiness === 'blocked';
  // 枠線は軸a(Ready/Blocked)専用にする。着手中かどうかはヘッダの色と
  // 左の四角で示すので、着手中の Task でも「依存が外れているか」が枠線から読める。
  const isReady = task.readiness === 'ready' && !isDone;

  // ✎ を押した対象。'task' か childTask の id。押された側だけが編集に入る。
  const [memoTarget, setMemoTarget] = useState<string | null>(null);

  const visibleChildren = hideCompleted ? children.filter((c) => c.progress !== 'done') : children;
  const showChildren = !task.collapsed && children.length > 0;

  const className = [
    'task',
    isDone && 'is-done',
    isActive && 'is-active',
    isBlocked && 'is-blocked',
    isReady && 'is-ready',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    /*
      取っ手は角からはみ出すため、本体の外側に置く。本体の中に置くと
      overflow: hidden で切り落とされ、かといって visible にすると
      ヘッダの背景が親の丸い角を上書きして枠線が途切れる。
    */
    <div
      className="task-wrap"
      style={
        projectColor ? ({ '--project-color': projectColor } as React.CSSProperties) : undefined
      }
    >
      <div className={className}>
        <Handle type="target" position={HandlePosition.Left} />

        <div className="task-head">
          <StateToggle
            progress={task.progress}
            onToggle={() =>
              send({ type: 'setTaskProgress', id: task.id, progress: nextProgress(task.progress) })
            }
          />

          <EditableText
            value={task.title}
            className="task-title"
            startEditing={autoEditTitle}
            onEditEnd={onAutoEditConsumed}
            onCommit={(title) => send({ type: 'updateTaskTitle', id: task.id, title })}
            // Task 名を打ち終えた勢いのまま、分解に入れるようにする
            onEnterChain={() => onChildChainAdd(task.id)}
          />

          <span className="task-actions nodrag">
            {children.length > 0 && (
              <button
                type="button"
                className="state-button"
                title={task.collapsed ? `展開 (${children.length})` : '折りたたむ'}
                onClick={() =>
                  send({ type: 'setTaskCollapsed', id: task.id, collapsed: !task.collapsed })
                }
              >
                {task.collapsed ? '▸' : '▾'}
              </button>
            )}
            <button
              type="button"
              className={`state-button${task.memo.length > 0 ? ' has-memo' : ''}`}
              title="メモ"
              onClick={() => setMemoTarget('task')}
            >
              ✎
            </button>
            <button
              type="button"
              className="state-button"
              title="子タスクを追加"
              onClick={() => onChildChainAdd(task.id)}
            >
              ＋
            </button>
            <button
              type="button"
              className="state-button"
              title="この Task を削除"
              onClick={() => requestDelete(task.id)}
            >
              ×
            </button>
          </span>
        </div>

        <Memo
          memo={task.memo}
          startEditing={memoTarget === 'task'}
          onCommit={(memo) => send({ type: 'setTaskMemo', id: task.id, memo })}
          onEditEnd={() => setMemoTarget(null)}
        />

        {showChildren && (
          <div className="task-children">
            {visibleChildren.map((child, index) => {
              const isLast = index === visibleChildren.length - 1;

              /*
                並べ替えの行き先は「見えている隣」の位置。
                表示上の index をそのまま渡すと、完了を非表示にしている間は
                隠れている項目のぶんだけズレて、別の場所へ飛んでしまう。
                ドメインは非表示のものも含む全体の並びで扱うため、
                ここで全体側の位置へ読み替える。
              */
              const fullIndexOf = (id: string): number => children.findIndex((c) => c.id === id);
              const previousVisible = visibleChildren[index - 1];
              const nextVisible = visibleChildren[index + 1];
              return (
                <div
                  key={child.id}
                  className={`child${child.progress === 'done' ? ' is-done' : ''}`}
                >
                  <div className="child-row">
                    <StateToggle
                      progress={child.progress}
                      onToggle={() =>
                        send({
                          type: 'setChildTaskProgress',
                          id: child.id,
                          progress: nextProgress(child.progress),
                        })
                      }
                    />

                    <EditableText
                      value={child.title}
                      className="child-title"
                      startEditing={autoEditLastChild && isLast}
                      onEditEnd={onAutoEditConsumed}
                      onCommit={(title) =>
                        send({ type: 'updateChildTaskTitle', id: child.id, title })
                      }
                      // Enter で確定したら、続けてもう1件足す。
                      // 分解は一気に書き出したいので、都度ボタンへ手を戻したくない。
                      onEnterChain={() => onChildChainAdd(task.id)}
                    />

                    <span className="child-actions nodrag">
                      <button
                        type="button"
                        className="state-button"
                        title="上へ"
                        disabled={index === 0}
                        onClick={() => {
                          if (!previousVisible) return;
                          send({
                            type: 'reorderChildTask',
                            id: child.id,
                            newIndex: fullIndexOf(previousVisible.id),
                          });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="state-button"
                        title="下へ"
                        disabled={isLast}
                        onClick={() => {
                          if (!nextVisible) return;
                          send({
                            type: 'reorderChildTask',
                            id: child.id,
                            newIndex: fullIndexOf(nextVisible.id),
                          });
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={`state-button${child.memo.length > 0 ? ' has-memo' : ''}`}
                        title="メモ"
                        onClick={() => setMemoTarget(child.id)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="state-button"
                        title="削除"
                        onClick={() => send({ type: 'deleteChildTask', id: child.id })}
                      >
                        ×
                      </button>
                    </span>
                  </div>

                  <Memo
                    memo={child.memo}
                    startEditing={memoTarget === child.id}
                    onCommit={(memo) => send({ type: 'setChildTaskMemo', id: child.id, memo })}
                    onEditEnd={() => setMemoTarget(null)}
                  />
                </div>
              );
            })}
          </div>
        )}

        <Handle type="source" position={HandlePosition.Right} />
      </div>

      {/*
        左上の頂点に重なる丸点。所属先の印であり、Task を掴んで動かす場所でもある。
        本体でも動かせると、タイトルをクリックして編集するつもりが動いてしまう。
      */}
      <div
        className="task-grip"
        title={projectColor ? 'ドラッグで移動(Project に所属)' : 'ドラッグで移動'}
      >
        <span className={`task-grip-dot${projectColor ? '' : ' is-unassigned'}`} />
      </div>
    </div>
  );
}

/** 枠の名前。掴んで動かす邪魔をしないよう、改名はダブルクリックで始める。 */
function ProjectName({
  name,
  onRename,
}: {
  name: string;
  onRename: (next: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="project-name"
        onDoubleClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title="ドラッグで移動 / ダブルクリックで改名"
      >
        {name}
      </button>
    );
  }

  const commit = (): void => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== name) onRename(trimmed);
  };

  return (
    <input
      className="text-input nodrag"
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') setEditing(false);
      }}
      onKeyDownCapture={(e) => e.stopPropagation()}
    />
  );
}

export type ProjectNodeData = {
  id: string;
  name: string;
  /** 枠線と塗りに使う色。Task の左上の点と同じ色になる。 */
  color: string;
  colorIndex: number;
  onRecolor: (id: string, colorIndex: number) => void;
  onResizeEnd: (
    id: string,
    position: { x: number; y: number },
    width: number,
    height: number,
  ) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

/**
 * Project の枠(FR-4)
 *
 * これはタグの見た目ではなく、領域そのもの。中に入っている Task が
 * この Project に属することになる。
 *
 * 枠の内側はクリックを透過させる(pointer-events: none)。透過させないと、
 * 枠の上にある Task を掴めなくなる。掴めるのはラベルと、リサイズの取っ手だけ。
 */
export function ProjectFrameNode({ data, selected }: NodeProps): React.JSX.Element {
  const { id, name, color, colorIndex, onRecolor, onResizeEnd, onRename, onDelete } =
    data as unknown as ProjectNodeData;
  const [pickingColor, setPickingColor] = useState(false);

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={120}
        isVisible={selected}
        onResizeEnd={(_event, params) =>
          onResizeEnd(id, { x: params.x, y: params.y }, params.width, params.height)
        }
      />
      <div
        className="project-frame"
        // 枠の色は Task の左上の点と揃える。どの枠に属しているかが、
        // 枠の中を見なくても点の色だけで分かるようにするため。
        style={{ '--project-color': color } as React.CSSProperties}
      >
        <span className="project-frame-label">
          {/*
            ここが枠を掴んで動かす取っ手になる(dragHandle)。
            Task 名と違いシングルクリックで編集に入らないのは、そうすると
            掴んだ瞬間に入力欄へ変わってしまい、枠を動かせなくなるため。
          */}
          <ProjectName name={name} onRename={(next) => onRename(id, next)} />

          <button
            type="button"
            className="color-swatch nodrag"
            title="色を変える"
            onClick={() => setPickingColor((v) => !v)}
          />
          {pickingColor && (
            <span className="color-picker nodrag">
              {PROJECT_COLORS.map((swatch, index) => (
                <button
                  key={swatch}
                  type="button"
                  className={`color-option${index === colorIndex ? ' is-current' : ''}`}
                  style={{ background: swatch }}
                  title={`色 ${index + 1}`}
                  onClick={() => {
                    onRecolor(id, index);
                    setPickingColor(false);
                  }}
                />
              ))}
            </span>
          )}

          <button
            type="button"
            className="state-button nodrag"
            title="この Project を削除(中の Task は残る)"
            onClick={() => onDelete(id)}
          >
            ×
          </button>
        </span>
      </div>
    </>
  );
}
