import { Handle, Position as HandlePosition, type NodeProps, NodeResizer } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import type { ChildTaskSnapshot, Command, Progress, TaskSnapshot } from '../../shared/ipc';
import { type DropPoint, startChildDrag } from './childDrag';
import { PROJECT_COLORS } from './colors';
import { logger } from './log';

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
  /** 追加・削除の直後に編集へ入れる相手。Task と childTask のどちらの id も入る。 */
  autoEdit: AutoEdit;
  send: (command: Command) => void;
  requestDelete: (id: string) => void;
  onAutoEditConsumed: () => void;
  /** 入力中に Shift+Enter が押された。確定して、続けてもう1件足す。 */
  onChildChainAdd: (parentId: string) => void;
  /** 名前を空にして Backspace が押された。その childTask を消す。 */
  onChildRemoveWhileEditing: (childId: string) => void;
  /** childTask が掴まれて、画面上のその点で離された(W-3)。to は入る先。 */
  onChildDropped: (childId: string, at: { x: number; y: number }, to: DropPoint | null) => void;
};

/**
 * カーソルの置き方。
 *
 * 足したばかりの項目は仮の名前が入っているので全選択(打てば置き換わる)。
 * 消した先で1つ上へ戻ったときは末尾に置く —— 全選択だと、次の1打で
 * 前の項目の名前まで消える。
 */
export type Caret = 'all' | 'end';

export type AutoEdit = { id: string; caret: Caret } | null;

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

const log = logger('edit');

/**
 * 入力欄へフォーカスを移す。移るまで数フレーム待つ。
 *
 * 1回呼ぶだけでは足りない。 React Flow はノードの寸法を測り終えるまで
 * そのノードを `visibility: hidden` にしており、隠れている要素への focus() は
 * 何も起こさずに黙って終わる。Task や childTask を足した直後は、まさにその
 * 瞬間に当たる —— 入力欄は現れるのに、打った文字がどこにも入らなかった。
 *
 * 取れたか(document.activeElement)を見て、駄目なら次のフレームで試す。
 * 要素が消えていれば諦める。
 */
function focusWhenVisible(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  caret: Caret,
  framesLeft = 20,
): void {
  if (!el || !document.contains(el)) return;

  el.focus();
  if (document.activeElement === el) {
    if (caret === 'all') el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    return;
  }

  if (framesLeft <= 0) {
    log.warn('入力欄にフォーカスできなかった');
    return;
  }
  requestAnimationFrame(() => focusWhenVisible(el, caret, framesLeft - 1));
}

/**
 * 開いている間、外側が押されたら閉じる。
 *
 * blur を閉じる合図にすると、フォーカスを奪われただけで畳まれてしまう。
 * 押された場所を見るなら、フォーカスがどこへ行ったかに依存しない。
 *
 * 判定と後始末は毎レンダー詰め替えた ref 越しに呼ぶ。リスナは登録した時点の
 * クロージャを掴んだままなので、直接呼ぶと古い値を見る。
 */
function useCloseOnOutsidePointerDown(
  active: boolean,
  isInside: (target: Node) => boolean,
  onOutside: () => void,
): void {
  const latest = useRef({ isInside, onOutside });
  useEffect(() => {
    latest.current = { isInside, onOutside };
  });

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (latest.current.isInside(event.target as Node)) return;
      latest.current.onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active]);
}

function EditableText({
  value,
  className,
  startEditing: startInEditMode = false,
  caret = 'all',
  onCommit,
  onEditEnd,
  onCommitAndAdd,
  onCommitAndMemo,
  onRemoveWhenEmpty,
}: {
  value: string;
  className: string;
  startEditing?: boolean;
  caret?: Caret;
  onCommit: (next: string) => void;
  onEditEnd?: () => void;
  /** Shift+Enter で確定したときに呼ばれる。確定して、続けて次の項目を足す用。 */
  onCommitAndAdd?: () => void;
  /** Tab が押されたときに呼ばれる。確定して、メモの入力へ移る用。 */
  onCommitAndMemo?: () => void;
  /**
   * 名前が空の状態で Backspace が押されたときに呼ばれる。渡さなければ何も起きない。
   *
   * childTask にだけ渡す。 Task を同じ操作で消せるようにすると、childTask の
   * 巻き添え削除と依存エッジの再接続が無言で走る。FR-1 がそこに確認を要求している。
   */
  onRemoveWhenEmpty?: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(startInEditMode);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 外を押して閉じにいっている最中。blur でフォーカスを取り返さないための目印。 */
  const closingRef = useRef(false);

  /*
    確定処理は下の document リスナからも呼ぶ。リスナは編集に入った時点の
    クロージャを掴んだままなので、そこから直接呼ぶと打った内容が見えない。
    毎レンダーで詰め替えた ref 越しに呼ぶことで、常に最新の draft を見る。
  */
  const finishRef = useRef<(alsoAdd: boolean) => void>(() => {});
  useEffect(() => {
    finishRef.current = (alsoAdd: boolean): void => {
      setEditing(false);
      onEditEnd?.();
      const trimmed = draft.trim();
      if (trimmed.length > 0 && trimmed !== value) onCommit(trimmed);
      if (alsoAdd) onCommitAndAdd?.();
    };
  });

  /*
    追加された直後に編集へ入る。

    マウント時の初期値だけを見ていたのでは間に合わない。子タスクを足す経路では
    スナップショットの反映が先に描画され、目印が立つのはその後になるため、
    「もう出来上がっている入力欄に、後から目印が届く」形になる。
  */
  useEffect(() => {
    if (!startInEditMode) return;
    log.debug('追加直後の目印が届いた。編集に入る', { value });
    setEditing(true);
  }, [startInEditMode, value]);

  // autoFocus 属性はスクリーンリーダーの読み上げ位置を突然動かすため使わない。
  // 編集に切り替わった時点で明示的にフォーカスする。
  useEffect(() => {
    if (!editing) return;
    closingRef.current = false;
    focusWhenVisible(inputRef.current, caret);
  }, [editing, caret]);

  // 編集を閉じるのは、入力欄の外が押されたときだけ。
  useCloseOnOutsidePointerDown(
    editing,
    (target) => inputRef.current?.contains(target) ?? false,
    () => {
      closingRef.current = true;
      finishRef.current(false);
    },
  );

  const begin = (): void => {
    setDraft(value);
    setEditing(true);
  };

  if (!editing) {
    // 見た目は文章だが、実際には編集を起動する操作子なので button にする。
    // ワンクリックで編集に入る。nodrag を付けてあるため、ここを掴んでも
    // ノードは動かない —— 移動は名前以外のどこを掴んでもできる。
    return (
      <button
        type="button"
        className={`${className} nodrag`}
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
      className="text-input nodrag"
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        // 外を押したときは上のリスナが先に閉じるので、ここには来ない。
        // 来るのはフォーカスを奪われたときだけ。打った文字がどこにも入らなく
        // なるので取り返す(ウィンドウごと切り替わったときは放っておく)。
        if (!closingRef.current && document.hasFocus()) inputRef.current?.focus();
      }}
      onKeyDown={(e) => {
        /*
          キャンバスのショートカット(Cmd+Z など)へ渡さない。

          止めるのは capture ではなく、この bubble 側でなければならない。
          React は listener を root にまとめて置くため、capture で
          stopPropagation すると event が入力欄まで降りてこなくなり、
          この onKeyDown 自身が呼ばれなくなる —— Enter が効かなかった原因。
        */
        e.stopPropagation();

        // 日本語入力の変換確定の Enter を、確定操作と取り違えない。
        // IME 変換中の Enter は「変換を決める」ためのものであって、
        // 入力を終える意思表示ではない。
        if (e.nativeEvent.isComposing) return;

        if (e.key === 'Enter') {
          e.preventDefault();
          // Enter は確定だけ。Shift+Enter は確定して次の項目へ進む。
          // 分解を一気に書き出す間、ボタンへ手を戻さずに済む。
          finishRef.current(e.shiftKey);
        }
        /*
          Tab は「次の欄へ」。名前の次にあるのはメモなので、そこへ移る。

          名前を打ち終えてメモを書きたいたびにマウスへ持ち替えるのでは、
          書き出しの流れが切れる。Tab 本来の意味から外れてもいない。
        */
        if (e.key === 'Tab' && !e.shiftKey && onCommitAndMemo) {
          e.preventDefault();
          finishRef.current(false);
          onCommitAndMemo();
        }

        // 空の名前で Backspace は「この項目を取り消す」。Shift+Enter で
        // 行き過ぎたぶんを、手をキーボードに置いたまま戻せるようにする。
        if (e.key === 'Backspace' && draft === '' && onRemoveWhenEmpty) {
          e.preventDefault();
          setEditing(false);
          onEditEnd?.();
          onRemoveWhenEmpty();
        }
        if (e.key === 'Escape') {
          setEditing(false);
          onEditEnd?.();
        }
      }}
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
    if (editing) focusWhenVisible(ref.current, 'all');
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
        // Enter で改行できるよう、キャンバスのショートカットへ渡さない。
        // capture 側で止めるとこのハンドラ自体が呼ばれなくなる(上と同じ理由)。
        e.stopPropagation();

        // Enter は改行。Escape で編集をやめる。
        if (e.key === 'Escape') {
          setEditing(false);
          onEditEnd();
          setDraft(memo);
        }
      }}
    />
  );
}

export function TaskNode({ data }: NodeProps): React.JSX.Element {
  const {
    task,
    children,
    projectColor,
    hideCompleted,
    autoEdit,
    send,
    requestDelete,
    onAutoEditConsumed,
    onChildChainAdd,
    onChildRemoveWhileEditing,
    onChildDropped,
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
      取っ手と接続の端は、角や辺からはみ出すため本体の外側に置く。本体の中に
      置くと overflow: hidden で切り落とされ、かといって visible にすると
      ヘッダの背景が親の丸い角を上書きして枠線が途切れる。
    */
    <div
      className="task-wrap"
      style={
        projectColor ? ({ '--project-color': projectColor } as React.CSSProperties) : undefined
      }
    >
      <div className={className}>
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
            startEditing={autoEdit?.id === task.id}
            caret={autoEdit?.caret}
            onEditEnd={onAutoEditConsumed}
            onCommit={(title) => send({ type: 'updateTaskTitle', id: task.id, title })}
            // Shift+Enter で、Task 名を打ち終えた勢いのまま分解に入れる
            onCommitAndAdd={() => onChildChainAdd(task.id)}
            // Tab で、そのままメモへ
            onCommitAndMemo={() => setMemoTarget('task')}
          />

          <span className="task-actions nodrag">
            {children.length > 0 && (
              /*
                折りたたんでいる間は件数を出す。畳んだ Task は1行の Task と
                見た目が変わらず、中身があること自体が画面から消える。
                件数は畳んでいるときだけ出す —— 開いていれば数えられる。
              */
              <button
                type="button"
                className={`state-button${task.collapsed ? ' is-collapsed' : ''}`}
                title={task.collapsed ? `展開 (${children.length} 件)` : '折りたたむ'}
                onClick={() =>
                  send({ type: 'setTaskCollapsed', id: task.id, collapsed: !task.collapsed })
                }
              >
                {task.collapsed ? `▸ ${children.length}` : '▾'}
              </button>
            )}
            <button
              type="button"
              className="state-button"
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
                  data-child-id={child.id}
                  className={`child${child.progress === 'done' ? ' is-done' : ''}`}
                >
                  <div className="child-row">
                    {/*
                      掴み手。ここから運んで、別の Task の上で離せばその下へ、
                      余白で離せば独立した Task になる(W-3)。
                      nodrag が無いと、React Flow が親ノードごと動かしてしまう。
                    */}
                    <span
                      className="child-grip nodrag"
                      title="ドラッグして、別の Task の下へ移す / 独立させる"
                      onPointerDown={(e) =>
                        startChildDrag(e, child, (at, to) => onChildDropped(child.id, at, to))
                      }
                    />
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
                      startEditing={autoEdit?.id === child.id}
                      caret={autoEdit?.caret}
                      onEditEnd={onAutoEditConsumed}
                      onCommit={(title) =>
                        send({ type: 'updateChildTaskTitle', id: child.id, title })
                      }
                      // Shift+Enter で確定したら、続けてもう1件足す。
                      // 分解は一気に書き出したいので、都度ボタンへ手を戻したくない。
                      onCommitAndAdd={() => onChildChainAdd(task.id)}
                      // Tab で、そのままメモへ
                      onCommitAndMemo={() => setMemoTarget(child.id)}
                      // 名前を空にして Backspace で、この項目を取り消す
                      onRemoveWhenEmpty={() => onChildRemoveWhileEditing(child.id)}
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
                        className="state-button"
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
      </div>

      {/*
        接続の端は、取っ手と同じ理由で本体の外側に置く。本体は角を整えるために
        overflow: hidden にしてあり、中に置くと外側の半分が切り落とされる。
        見た目は縦棒のままなのに掴める幅が実測 2.5px しかなく、狙って掴めない。
      */}
      <Handle type="target" position={HandlePosition.Left} />
      <Handle type="source" position={HandlePosition.Right} />

      {/*
        左上の頂点に重なる丸点。どの Project に属しているかの印。
        移動は本体のどこを掴んでもできるので、ここは掴む場所ではない。
      */}
      <div
        className="task-grip"
        title={projectColor ? 'この Project に所属' : 'Project に属していない'}
      >
        <span className={`task-grip-dot${projectColor ? '' : ' is-unassigned'}`} />
      </div>
    </div>
  );
}

/**
 * 枠の名前。Task 名と同じくワンクリックで改名に入る。
 *
 * フォーカスの扱いも Task 名と同じにしてある。blur を閉じる合図にすると、
 * 開いた直後に何かがフォーカスを奪うだけで畳まれ、2回クリックしないと
 * 編集に入れなくなる —— Task 名で実際に起きた。
 */
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
  const closingRef = useRef(false);

  const commitRef = useRef<() => void>(() => {});
  useEffect(() => {
    commitRef.current = (): void => {
      setEditing(false);
      const trimmed = draft.trim();
      if (trimmed.length > 0 && trimmed !== name) onRename(trimmed);
    };
  });

  useEffect(() => {
    if (!editing) return;
    closingRef.current = false;
    focusWhenVisible(inputRef.current, 'all');
  }, [editing]);

  useCloseOnOutsidePointerDown(
    editing,
    (target) => inputRef.current?.contains(target) ?? false,
    () => {
      closingRef.current = true;
      commitRef.current();
    },
  );

  if (!editing) {
    /*
      ワンクリックで改名に入る。**枠はラベル以外でも掴めるようになったので、
      ラベルを取っ手として空けておく必要がなくなった。** Task 名と揃う。
    */
    return (
      <button
        type="button"
        className="project-name nodrag"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title="クリックで改名"
      >
        {name}
      </button>
    );
  }

  return (
    <input
      className="text-input nodrag"
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!closingRef.current && document.hasFocus()) inputRef.current?.focus();
      }}
      onKeyDown={(e) => {
        // キャンバスのショートカットへ渡さない(bubble 側で止める。理由は EditableText)
        e.stopPropagation();

        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRef.current();
        }
        if (e.key === 'Escape') setEditing(false);
      }}
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
  /**
   * 大きさを変えている最中の矩形。置けるかどうかの提示に使う(FR-4)。
   * 他の枠の位置を知っているのは App 側なので、判定はそちらに任せる。
   */
  onResizing: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

/**
 * Project の枠(FR-4)
 *
 * これはタグの見た目ではなく、領域そのもの。中に入っている Task が
 * この Project に属することになる。
 *
 * 枠はどこを掴んでも動く。中の Task は手前にいるので、Task の上から始めた
 * ドラッグは Task の移動になる —— 枠が持っていくことはない。
 */
export function ProjectFrameNode({ data, selected }: NodeProps): React.JSX.Element {
  const { id, name, color, colorIndex, onRecolor, onResizeEnd, onResizing, onRename, onDelete } =
    data as unknown as ProjectNodeData;
  const [pickingColor, setPickingColor] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);

  // 色を選ばずに他所を押したときも閉じる。開いたままだと下の Task が隠れる。
  // 見本のボタン自身は「内側」に含める —— 含めないと、閉じた直後に
  // そのボタンの onClick がもう一度開いてしまう。
  useCloseOnOutsidePointerDown(
    pickingColor,
    (target) =>
      (swatchRef.current?.contains(target) ?? false) ||
      (pickerRef.current?.contains(target) ?? false),
    () => setPickingColor(false),
  );

  return (
    <>
      {/*
        大きさを変える取っ手は常に置いておく。選んでから掴む2手にすると、
        「掴めない」と受け取られる —— 取っ手が出ていないことが、選択されて
        いないせいだと分かるのは、仕組みを知っている側だけ。
        選んでいない間は薄く出し、ホバーで濃くする(styles.css)。
      */}
      <NodeResizer
        minWidth={140}
        minHeight={120}
        isVisible
        handleClassName={selected ? 'is-selected' : undefined}
        onResize={(_event, params) =>
          onResizing(id, { x: params.x, y: params.y, width: params.width, height: params.height })
        }
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
          <ProjectName name={name} onRename={(next) => onRename(id, next)} />

          <button
            type="button"
            ref={swatchRef}
            className="color-swatch nodrag"
            title="色を変える"
            onClick={() => setPickingColor((v) => !v)}
          />
          {pickingColor && (
            <span className="color-picker nodrag" ref={pickerRef}>
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
