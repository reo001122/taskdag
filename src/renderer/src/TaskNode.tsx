import { Handle, Position as HandlePosition, type NodeProps } from '@xyflow/react';
import { useContext, useEffect, useRef, useState } from 'react';
import type { ChildTaskSnapshot, Command, Progress, TaskSnapshot } from '../../shared/ipc';
import { type DropPoint, startChildDrag } from './child-drag';
import { commandFor, handOff, isImeComposing } from './keymap';
import { logger } from './log';
import { type Caret, focusInput, NodeMeasured, useCloseOnOutsidePointerDown } from './node-editing';

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
  /**
   * Shift+↑↓ で選んでいる行(FR-1)。childTask の id。null なら親 Task 自身。
   *
   * 選ばれている Task の分だけ意味を持つ。選ばれていなければ印は出さない。
   */
  cursorChildId: string | null;
  send: (command: Command) => void;
  requestDelete: (id: string) => void;
  onAutoEditConsumed: () => void;
  /** 入力中に Shift+Enter が押された。確定して、続けてもう1件足す。 */
  onChildChainAdd: (parentId: string) => void;
  /** 名前を空にして Backspace が押された。その childTask を消す。 */
  onChildRemoveWhileEditing: (childId: string) => void;
  /** childTask が掴まれて、画面上のその点で離された(W-3)。to は入る先。 */
  onChildDropped: (childId: string, at: { x: number; y: number }, to: DropPoint | null) => void;
  /** 行が押された。押した行に印を移す。childId が null なら親 Task 自身。 */
  onRowPressed: (taskId: string, childId: string | null) => void;
  /** メモの入力を開く相手(FR-10)。Task と childTask のどちらの id も入る。 */
  autoMemo: string | null;
  onAutoMemoConsumed: () => void;
};

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
      /*
        押しても、この button にはフォーカスを渡さない(FR-1)。

        行は onPointerDownCapture で自分へフォーカスを移している。その直後に
        ブラウザの既定(pointerdown)が押された button へフォーカスを移すため、
        四角を押したときだけ「印はその行、フォーカスはボタン」とずれていた。
        見た目には出ないが、そこから先のキー操作の起点になる値である。

        既定を止めるだけにして onClick は残す —— 見出しの ✎ / ＋ / × と同じ
        onPress に寄せると、キーボードで focus して Space / Enter で起動する
        経路が無くなる。
      */
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
      }}
      onClick={onToggle}
    >
      <span className="state-box" />
    </button>
  );
}

const log = logger('edit');

/**
 * 押した時点で効かせる(FR-1)。
 *
 * 名前を編集している間、入力欄のぶんノードが広い。押した瞬間に編集が閉じて
 * ノードが縮むと、ボタンが動いて指を離す位置から外れる。click は押した要素と
 * 離した要素が同じでないと成立しないので、その場合は一度も効かない。
 *
 * 左ボタンだけを見る。右クリックやペン先の副ボタンで動くと、意図しない操作になる。
 */
function onPress(run: () => void) {
  return (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    run();
  };
}

/**
 * 押された行に印とフォーカスを移す(FR-1)。
 *
 * **入力欄の中を押したときは、フォーカスを動かさない。** メモはフォーカスが
 * 外れた時点で確定する作りなので、行へ移すと、書いている途中にキャレットを
 * 動かしただけで閉じてしまう。印だけは移す —— 押した行が対象であることに
 * 変わりはない。
 */
function pressRow(event: React.PointerEvent<HTMLElement>, move: () => void): void {
  move();
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea')) return;
  event.currentTarget.focus();
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
  /** Ctrl+Enter が押されたときに呼ばれる。確定して、メモの入力へ移る用。 */
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
  /*
    編集中かどうかを、効果の中から古くならずに読むための控え。
    これを依存に入れると、編集が終わった瞬間に効果が走り直して開き直してしまう。
  */
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    if (!startInEditMode || editingRef.current) return;
    log.debug('編集に入る目印が届いた', { value });
    /*
      下書きをその時点の値から始める。

      クリックで入る経路(begin)は詰め替えていたが、こちらは editing を
      立てるだけだった。Escape で取り消した文字列や、Undo で戻る前の文字列が
      下書きに残っているので、Enter で開き直すとそれが現れる。

      既に編集中なら触らない —— 打っている最中に別の経路で value が変わったとき、
      入力中の文字を上書きしてしまう。
    */
    setDraft(value);
    setEditing(true);
  }, [startInEditMode, value]);

  // autoFocus 属性はスクリーンリーダーの読み上げ位置を突然動かすため使わない。
  // 編集に切り替わった時点で明示的にフォーカスする。
  const measured = useContext(NodeMeasured);
  useEffect(() => {
    if (!editing || !measured) return;
    closingRef.current = false;
    focusInput(inputRef.current, caret);
  }, [editing, measured, caret]);

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
        // 日本語入力の変換中のキーは、何であっても操作として扱わない。Cmd+N の判定より
        // 前に置く(keymap.ts の isImeComposing)。
        if (isImeComposing(e.nativeEvent)) {
          e.stopPropagation();
          return;
        }

        /*
          Cmd+N だけは通す(FR-1)。

          打っている途中で新しい Task に移るのは、書きかけを置き去りにする
          操作なので、まずここで確定させる。そのうえで作成はキャンバス側に
          任せる —— ＋ Task のボタンを押したときと同じ結果になる。
          確定したら handOff で印を付けて通す(keymap.ts)。キャンバス側は、この
          印の無い Cmd+N を入力欄の中から来たものとして拒否する。
          かつては「打っている間は効かない」にしていたが、ボタンでは作れて
          キーでは作れない、という食い違いが残っていた。
        */
        if (commandFor(e.nativeEvent)?.type === 'newTask') {
          finishRef.current(false);
          handOff(e.nativeEvent);
          return;
        }

        /*
          キャンバスのショートカット(Cmd+Z など)へ渡さない。

          止めるのは capture ではなく、この bubble 側でなければならない。
          React は listener を root にまとめて置くため、capture で
          stopPropagation すると event が入力欄まで降りてこなくなり、
          この onKeyDown 自身が呼ばれなくなる —— Enter が効かなかった原因。
        */
        e.stopPropagation();

        // (IME 変換中の Enter は「変換を決める」ためのもので、入力を終える意思表示では
        // ない。上で除いてある。)

        /*
          Enter の3つ。確定だけ / 確定して childTask へ / 確定してメモへ。

          修飾キーで対にしてある。分解を書き出している間、次に書きたいものが
          手順なのかメモなのかで手の形だけが変わる。ボタンへ手を戻さずに済む。
        */
        if (e.key === 'Enter') {
          e.preventDefault();
          if ((e.ctrlKey || e.metaKey) && onCommitAndMemo) {
            finishRef.current(false);
            onCommitAndMemo();
            return;
          }
          finishRef.current(e.shiftKey);
          return;
        }

        /*
          Tab は何もしない。

          かつてはメモへ移る操作だったが、Ctrl+Enter に移した。既定の動きに
          任せると入力欄から焦点が外れるが、この入力欄は焦点を取り返すので、
          一瞬だけどこかへ移って戻る形になる。止めておく。
        */
        if (e.key === 'Tab') {
          e.preventDefault();
          return;
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

  const measured = useContext(NodeMeasured);
  useEffect(() => {
    if (editing && measured) focusInput(ref.current, 'all');
  }, [editing, measured]);

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
        // IME 変換中のキーは操作として扱わない。Cmd+N の判定より前に置く(名前の欄と同じ)。
        if (isImeComposing(e.nativeEvent)) {
          e.stopPropagation();
          return;
        }

        // Cmd+N は通す。ここで確定させ、作成はキャンバス側に任せる(名前の欄と同じ)。
        if (commandFor(e.nativeEvent)?.type === 'newTask') {
          finish();
          handOff(e.nativeEvent);
          return;
        }

        // キャンバスのショートカットへ渡さない。capture 側で止めると
        // このハンドラ自体が呼ばれなくなる(上と同じ理由)。
        e.stopPropagation();

        /*
          Enter は確定、Shift+Enter は改行。

          名前の欄と同じで、Enter は「書き終えた」を意味する。改行のほうを
          修飾キー側へ置いた —— メモは1行で済むことのほうが多く、そのたびに
          枠の外を押して閉じるのでは手数が増える。
        */
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish();
          return;
        }

        if (e.key === 'Escape') {
          setEditing(false);
          onEditEnd();
          setDraft(memo);
        }
      }}
    />
  );
}

export function TaskNode({ data, selected, width }: NodeProps): React.JSX.Element {
  const {
    task,
    children,
    projectColor,
    hideCompleted,
    autoEdit,
    cursorChildId,
    onRowPressed,
    autoMemo,
    onAutoMemoConsumed,
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

  /*
    メモを閉じたら、開く合図も下ろす(FR-10)。

    下ろさないと、合図が立ったまま残る。次に同じ行でメモを開こうとしても
    値が変わらないので、開く効果が走らない —— 2回目が効かなくなる。
  */
  const endMemo = (id: string): void => {
    setMemoTarget(null);
    if (autoMemo === id) onAutoMemoConsumed();
  };

  const visibleChildren = hideCompleted ? children.filter((c) => c.progress !== 'done') : children;
  const showChildren = !task.collapsed && children.length > 0;

  /*
    印を出す行(FR-1)。Enter が触る相手と同じでなければならない。

    指している childTask が見当たらなければ親へ戻す。完了を非表示にした、
    別の Task へ移した、消した —— 指す先が消える経路は複数ある。そのまま
    どこにも印が出ない状態にすると、Enter が何を開くのか画面から読めない。
  */
  const cursorRow =
    cursorChildId !== null && visibleChildren.some((c) => c.id === cursorChildId)
      ? cursorChildId
      : null;

  const className = [
    'task',
    isDone && 'is-done',
    isActive && 'is-active',
    isBlocked && 'is-blocked',
    isReady && 'is-ready',
  ]
    .filter(Boolean)
    .join(' ');

  // 測り終えるまで隠れている。その間はフォーカスを当てても何も起きない。
  const measured = width != null && width > 0;

  return (
    /*
      取っ手と接続の端は、角や辺からはみ出すため本体の外側に置く。本体の中に
      置くと overflow: hidden で切り落とされ、かといって visible にすると
      ヘッダの背景が親の丸い角を上書きして枠線が途切れる。
    */
    <NodeMeasured.Provider value={measured}>
      <div
        className="task-wrap"
        style={
          projectColor ? ({ '--project-color': projectColor } as React.CSSProperties) : undefined
        }
      >
        <div className={className}>
          {/*
          親 Task 自身の部分。選ばれたときに囲むのはここまでで、childTask の
          並びは含めない。Enter が触るのは親の名前で、メモも親のものだが、
          childTask はそれぞれ別の対象だから。
        */}
          {/*
          押された行に印を移し、フォーカスもその行へ移す(FR-1)。

          押した時点で移す。クリックの成立を待つと、名前を編集している間に
          レイアウトが動いたときに取りこぼす —— ボタンで実際に起きた。

          フォーカスを行が受けるのは、印と食い違わせないため。放っておくと
          React Flow が Task ノード全体に当てるので、childTask を押したのに
          フォーカスは親、という状態になる。見た目には出ないが、ここから先の
          キー操作の起点になる値である。
        */}
          <div
            className={`task-own${selected && cursorRow === null ? ' is-cursor' : ''}`}
            tabIndex={-1}
            onPointerDownCapture={(e) => pressRow(e, () => onRowPressed(task.id, null))}
          >
            <div className="task-head">
              {/*
              掴み手。ここからだけ動かせる(FR-6)。
  
              childTask 側に取っ手を出したことで、取っ手の無いものは掴めない、と
              読めるようになった。実際 Task 本体は掴む場所が分からない、という
              報告が出た。同じ形の取っ手を同じ位置に置いて揃える。
            */}
              <span className="task-grip" title="ドラッグして動かす" />
              <StateToggle
                progress={task.progress}
                onToggle={() =>
                  send({
                    type: 'setTaskProgress',
                    id: task.id,
                    progress: nextProgress(task.progress),
                  })
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
                // Ctrl+Enter で、そのままメモへ
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
                {/*
                  押した時点で効かせる(onClick ではなく onPointerDown)。
  
                  名前を編集している間、入力欄のぶんノードが広い。押した瞬間に
                  編集が閉じてノードが縮み、ボタンが左へ動く(実測 201px)。
                  離す位置にはもうボタンが無いので、click は成立しない ——
                  名前の編集中はこの3つが一度も効かなかった。
  
                  代償として、押したまま指をずらして取り消すことができない。
                  3つとも取り返しのつかない操作ではない(× も確認を出すだけ)。
                */}
                <button
                  type="button"
                  className="state-button"
                  title="メモ"
                  onPointerDown={onPress(() => setMemoTarget('task'))}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="state-button"
                  title="子タスクを追加"
                  onPointerDown={onPress(() => onChildChainAdd(task.id))}
                >
                  ＋
                </button>
                <button
                  type="button"
                  className="state-button"
                  title="この Task を削除"
                  onPointerDown={onPress(() => requestDelete(task.id))}
                >
                  ×
                </button>
              </span>
            </div>

            <Memo
              memo={task.memo}
              startEditing={memoTarget === 'task' || autoMemo === task.id}
              onCommit={(memo) => send({ type: 'setTaskMemo', id: task.id, memo })}
              onEditEnd={() => endMemo(task.id)}
            />
          </div>

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
                    className={`child${child.progress === 'done' ? ' is-done' : ''}${
                      child.progress === 'in_progress' ? ' is-active' : ''
                    }${selected && cursorRow === child.id ? ' is-cursor' : ''}`}
                    tabIndex={-1}
                    /*
                      捕捉の段階で受ける。取っ手は運搬を始めるために pointerdown を
                      止めており(child-drag.ts)、bubble 側では届かない —— 取っ手を
                      押したときだけ印が動かない、という形で実際に出た。
                    */
                    onPointerDownCapture={(e) => pressRow(e, () => onRowPressed(task.id, child.id))}
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
                        // Ctrl+Enter で、そのままメモへ
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
                      startEditing={memoTarget === child.id || autoMemo === child.id}
                      onCommit={(memo) => send({ type: 'setChildTaskMemo', id: child.id, memo })}
                      onEditEnd={() => endMemo(child.id)}
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
        移動は見出しの左端の取っ手からだけできる(FR-6)。ここは掴む場所ではない。
      */}
        <div
          className="task-project-mark"
          title={projectColor ? 'この Project に所属' : 'Project に属していない'}
        >
          <span className={`task-project-dot${projectColor ? '' : ' is-unassigned'}`} />
        </div>
      </div>
    </NodeMeasured.Provider>
  );
}
