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

/** 解釈する。対応する操作が無ければ null。 */
export function commandFor(e: KeyInput): KeyCommand | null {
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    return { type: 'editName' };
  }
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return { type: 'addChild' };
  }
  if (
    (e.key === 'Delete' || e.key === 'Backspace') &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    return { type: 'deleteRow' };
  }
  if (e.key === 'Enter' && mod && !e.shiftKey && !e.altKey) {
    return { type: 'openMemo' };
  }
  if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    return { type: 'moveMark', delta: e.key === 'ArrowDown' ? 1 : -1 };
  }
  if (e.key.startsWith('Arrow')) return { type: 'blockArrow' };

  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
  if (key === 'n') return { type: 'newTask' };
  return null;
}

/** 押された場所と画面の状態。呼び出し側が DOM から作る。 */
export type KeyContext = {
  /** input / textarea / contenteditable の中から来たキー */
  fromEditable: boolean;
  /** button / select / combobox / menu / listbox の中から来たキー(自分でキーを使う部品) */
  fromKeyOwningUi: boolean;
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
  editName: (c) => c.dialogOpen || c.fromEditable || c.fromDialog,
  addChild: (c) => c.dialogOpen || c.fromEditable || c.fromDialog,
  openMemo: (c) => c.dialogOpen || c.fromEditable || c.fromDialog,
  // D-13: 入力欄が画面のどこかに開いていれば、その打鍵は入力欄のもの。
  deleteRow: (c) => c.dialogOpen || c.fromEditable || c.fromDialog || c.inputOpen,
  undo: (c) => c.dialogOpen,
  redo: (c) => c.dialogOpen,
  newTask: (c) => c.dialogOpen,
  moveMark: (c) => c.fromEditable || c.fromDialog,
  // 入力欄の中では止めない(文字の移動に使うため)。
  blockArrow: (c) => c.fromEditable,
};

export function allowed(command: KeyCommand, context: KeyContext): boolean {
  return !REFUSED_WHEN[command.type](context);
}
