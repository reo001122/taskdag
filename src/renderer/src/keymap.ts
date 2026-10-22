/**
 * キーの扱いを3つに分けた、最初の2つ(D-14)。
 *
 *   1. 解釈   — commandFor: このキーは何の操作か
 *   2. 可否   — allowed:    いま実行してよいか
 *   3. 対象   — App.tsx:    どの Task / 行に効かせるか(React Flow の選択に依存する)
 *
 * どちらも DOM を見ない純粋関数。DOM を見て作る値は context として呼び出し側が
 * 渡す。これにより、キーの扱いを画面抜きで試せる。
 */

/** キーイベントのうち、解釈に使うもの。KeyboardEvent がそのまま入る。 */
export type KeyInput = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export type KeyCommand =
  | { type: 'editName' }
  | { type: 'addChild' }
  | { type: 'openMemo' }
  | { type: 'deleteRow' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'newTask' }
  | { type: 'moveMark'; delta: 1 | -1 }
  /** React Flow の矢印移動を止めるだけ(FR-6)。印は動かさない。 */
  | { type: 'blockArrow' };

export type CommandType = KeyCommand['type'];

/**
 * IME の変換中か。変換確定の Enter や、変換中に打たれたキーを操作と取り違えない。
 *
 * isComposing だけでは足りない。Chromium は変換を確定した keydown で isComposing を
 * すでに false にして、keyCode だけを 229 のまま届けることがある。
 * 入力欄の keydown も同じ関数で判定する(Cmd+N の判定より前に置く)。
 */
export function isImeComposing(e: { isComposing?: boolean; keyCode?: number }): boolean {
  return e.isComposing === true || e.keyCode === 229;
}

/** 解釈する。対応する操作が無ければ null。 */
export function commandFor(e: KeyInput): KeyCommand | null {
  if (isImeComposing(e)) return null;

  // 修飾キーは完全一致。余分な Shift や Alt が付いたものを、別の操作と取り違えない。
  const mod = e.metaKey || e.ctrlKey;
  const bare = !mod && !e.shiftKey && !e.altKey;
  const key = e.key.toLowerCase();

  // キーリピートで繰り返してはいけないもの: 押しっぱなしで Task や行が量産・消費される。
  // 印の移動と Undo / Redo は、押し続けて連続して動かせてよい。
  const command = ((): KeyCommand | null => {
    if (e.key === 'Enter' && bare) return { type: 'editName' };
    if (e.key === 'Enter' && e.shiftKey && !mod && !e.altKey) return { type: 'addChild' };
    if (e.key === 'Enter' && mod && !e.shiftKey && !e.altKey) return { type: 'openMemo' };
    if ((e.key === 'Delete' || e.key === 'Backspace') && bare) return { type: 'deleteRow' };

    if (e.shiftKey && !mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return { type: 'moveMark', delta: e.key === 'ArrowDown' ? 1 : -1 };
    }
    if (e.key.startsWith('Arrow')) return { type: 'blockArrow' };

    if (mod && !e.altKey && key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (mod && !e.altKey && !e.shiftKey && key === 'n') return { type: 'newTask' };
    return null;
  })();

  if (command !== null && e.repeat === true && NO_REPEAT.has(command.type)) return null;
  return command;
}

const NO_REPEAT: ReadonlySet<CommandType> = new Set<CommandType>([
  'newTask',
  'addChild',
  'deleteRow',
  'editName',
  'openMemo',
]);

/** 押された場所と画面の状態。呼び出し側が DOM から作る。 */
export type KeyContext = {
  /** input / textarea / contenteditable の中から来たキー */
  fromEditable: boolean;
  fromDialog: boolean;
  dialogOpen: boolean;
  /** Task 名・メモの入力欄が画面のどこかに開いている */
  inputOpen: boolean;
  /** 入力欄が確定を済ませたうえで、キャンバスへ渡したキー(handOff) */
  handedOff: boolean;
};

/**
 * 実行してよいかの表。true は「拒否」。
 *
 * 判断の条件はここにだけ書く。操作ごとの例外は、その操作の行の中に書く。
 */
const REFUSED_WHEN: Record<CommandType, (c: KeyContext) => boolean> = {
  // ダイアログが開いていれば全操作を拒否する(矢印の capture 側も同じ)。
  // 入力欄の中のキーは入力欄のもの。ボタンの上の Enter は、ボタンではなく印の付いた行に効く
  // (かつて「ボタンのもの」としたが、使い手の確認で不要とされた。D-14)。
  // 入力欄が画面に開いている間は、その打鍵は入力欄のものとして扱う(D-13, D-14)。
  editName: (c) => c.dialogOpen || c.fromDialog || c.fromEditable || c.inputOpen,
  addChild: (c) => c.dialogOpen || c.fromDialog || c.fromEditable || c.inputOpen,
  openMemo: (c) => c.dialogOpen || c.fromDialog || c.fromEditable || c.inputOpen,
  deleteRow: (c) => c.dialogOpen || c.fromDialog || c.fromEditable || c.inputOpen,
  undo: (c) => c.dialogOpen || c.fromDialog || c.fromEditable || c.inputOpen,
  redo: (c) => c.dialogOpen || c.fromDialog || c.fromEditable || c.inputOpen,
  // 入力欄が開いていても作れる(確定してから作る。FR-1)。ただし入力欄の中から届いた
  // Cmd+N は、入力欄が確定を済ませて handOff したものだけを通す。確定を書き忘れた
  // 新しい入力欄からは、書きかけのまま Task が作られない。
  newTask: (c) => c.dialogOpen || c.fromDialog || (c.fromEditable && !c.handedOff),
  moveMark: (c) => c.dialogOpen || c.fromDialog || c.fromEditable,
  // 入力欄の中では止めない(文字の移動に使うため)。
  blockArrow: (c) => c.dialogOpen || c.fromEditable,
};

export function allowed(command: KeyCommand, context: KeyContext): boolean {
  return !REFUSED_WHEN[command.type](context);
}

/*
  入力欄からキャンバスへ渡したキー(Cmd+N)の印。

  入力欄は Cmd+N を受けたら**確定処理をしてから** handOff し、stopPropagation せずに
  通す。キャンバス側はこの印の付いたものだけを、入力欄の中から来たキーとして通す。
  印はイベントそのものに付ける(WeakSet)ので、別のイベントには移らない。
*/
const handedOff = new WeakSet<object>();

/** 確定を済ませた入力欄が、このキーをキャンバスへ渡すと宣言する。 */
export function handOff(event: object): void {
  handedOff.add(event);
}

export function isHandedOff(event: object): boolean {
  return handedOff.has(event);
}
