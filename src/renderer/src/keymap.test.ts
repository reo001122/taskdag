import { describe, expect, it } from 'vitest';
import {
  allowed,
  type CommandType,
  commandFor,
  handOff,
  INPUT_SHORTCUTS,
  isHandedOff,
  type KeyContext,
  type KeyInput,
  SHORTCUTS,
} from './keymap';

const ALL: CommandType[] = [
  'editName',
  'addChild',
  'openMemo',
  'deleteRow',
  'undo',
  'redo',
  'newTask',
  'moveMark',
  'toggleHelp',
  'blockArrow',
  'blockTab',
];

/** 何も起きていない画面(キャンバスにフォーカスがあり、入力欄もダイアログも無い)。 */
const quiet: KeyContext = {
  fromEditable: false,
  fromDialog: false,
  dialogOpen: false,
  inputOpen: false,
  handedOff: false,
};

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

/** 種類だけで操作を作る(moveMark / blockArrow にも使う)。 */
const of = (type: CommandType) =>
  type === 'moveMark' ? ({ type, delta: 1 } as const) : ({ type } as never);

describe('commandFor: キーの解釈', () => {
  it('修飾キーなしの Enter は名前の編集、Shift+Enter は childTask の追加', () => {
    expect(commandFor(key('Enter'))?.type).toBe('editName');
    expect(commandFor(key('Enter', { shiftKey: true }))?.type).toBe('addChild');
  });

  it('Ctrl+Enter / Cmd+Enter はメモ(FR-10)', () => {
    expect(commandFor(key('Enter', { ctrlKey: true }))?.type).toBe('openMemo');
    expect(commandFor(key('Enter', { metaKey: true }))?.type).toBe('openMemo');
  });

  it('Delete / Backspace は行の削除(FR-1)', () => {
    expect(commandFor(key('Delete'))?.type).toBe('deleteRow');
    expect(commandFor(key('Backspace'))?.type).toBe('deleteRow');
  });

  it('Cmd+Z は undo、Cmd+Shift+Z は redo、Cmd+N は新規 Task(FR-8, FR-1)', () => {
    expect(commandFor(key('z', { metaKey: true }))?.type).toBe('undo');
    expect(commandFor(key('Z', { metaKey: true, shiftKey: true }))?.type).toBe('redo');
    expect(commandFor(key('n', { ctrlKey: true }))?.type).toBe('newTask');
  });

  it('Shift+↑↓ は印の移動、ほかの矢印は React Flow の移動を止めるだけ', () => {
    expect(commandFor(key('ArrowDown', { shiftKey: true }))).toEqual({
      type: 'moveMark',
      delta: 1,
    });
    expect(commandFor(key('ArrowUp', { shiftKey: true }))).toEqual({ type: 'moveMark', delta: -1 });
    expect(commandFor(key('ArrowLeft'))?.type).toBe('blockArrow');
  });

  it('無関係なキーは null', () => {
    expect(commandFor(key('a'))).toBeNull();
    expect(commandFor(key('a', { metaKey: true }))).toBeNull();
  });
});

describe('commandFor: 余分な修飾キーを別の操作と取り違えない', () => {
  it('Alt や余分な Shift の付いた Enter は、名前の編集・追加・メモのどれでもない', () => {
    expect(commandFor(key('Enter', { altKey: true }))).toBeNull();
    expect(commandFor(key('Enter', { shiftKey: true, altKey: true }))).toBeNull();
    expect(commandFor(key('Enter', { shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(commandFor(key('Enter', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('Delete は修飾キーが付いていれば削除にならない', () => {
    for (const mods of [
      { shiftKey: true },
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
    ]) {
      expect(commandFor(key('Backspace', mods)), JSON.stringify(mods)).toBeNull();
    }
  });

  it('Undo / Redo / 新規 Task は Alt が付いていれば別のキー', () => {
    expect(commandFor(key('z', { metaKey: true, altKey: true }))).toBeNull();
    expect(commandFor(key('z', { metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
    expect(commandFor(key('n', { metaKey: true, altKey: true }))).toBeNull();
  });

  it('Cmd+Shift+N は新規 Task ではない', () => {
    expect(commandFor(key('n', { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('印の移動は Shift だけ。Cmd / Ctrl / Alt が付けば移動にならない', () => {
    for (const mods of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const c = commandFor(key('ArrowDown', { shiftKey: true, ...mods }));
      expect(c?.type, JSON.stringify(mods)).not.toBe('moveMark');
    }
  });
});

describe('commandFor: IME とキーリピート', () => {
  it('IME の変換中(isComposing、または keyCode 229)は、どのキーも null', () => {
    const keys: KeyInput[] = [
      key('Enter'),
      key('Enter', { shiftKey: true }),
      key('Enter', { metaKey: true }),
      key('Backspace'),
      key('z', { metaKey: true }),
      key('n', { metaKey: true }),
      key('ArrowDown', { shiftKey: true }),
      key('ArrowLeft'),
    ];
    for (const k of keys) {
      expect(commandFor({ ...k, isComposing: true }), `${k.key} isComposing`).toBeNull();
      expect(commandFor({ ...k, keyCode: 229 }), `${k.key} 229`).toBeNull();
    }
  });

  it('リピートでは、Task を増やす・行を消す・編集を開く操作は null', () => {
    for (const k of [
      key('n', { metaKey: true }),
      key('Delete'),
      key('Backspace'),
      key('Enter'),
      key('Enter', { shiftKey: true }),
      key('Enter', { ctrlKey: true }),
    ]) {
      expect(commandFor({ ...k, repeat: true }), k.key).toBeNull();
      expect(commandFor({ ...k, repeat: false }), `${k.key} (単発)`).not.toBeNull();
    }
  });

  it('リピートでも、印の移動・Undo・Redo・矢印の抑止は通る', () => {
    expect(commandFor({ ...key('ArrowDown', { shiftKey: true }), repeat: true })?.type).toBe(
      'moveMark',
    );
    expect(commandFor({ ...key('z', { metaKey: true }), repeat: true })?.type).toBe('undo');
    expect(commandFor({ ...key('z', { metaKey: true, shiftKey: true }), repeat: true })?.type).toBe(
      'redo',
    );
    expect(commandFor({ ...key('ArrowLeft'), repeat: true })?.type).toBe('blockArrow');
  });
});

describe('allowed: 実行してよいか', () => {
  it('ダイアログが開いていれば、すべての操作を拒否する(矢印の capture 側も)', () => {
    const open = { ...quiet, dialogOpen: true };
    for (const type of ALL) {
      expect(allowed(of(type), open), type).toBe(false);
    }
  });

  it('入力欄の中のキーは、Enter 系・削除に届かない', () => {
    const typing = { ...quiet, fromEditable: true, inputOpen: true };
    for (const type of ['editName', 'addChild', 'openMemo', 'deleteRow'] as const) {
      expect(allowed(of(type), typing), type).toBe(false);
    }
  });

  it('入力欄からの Undo / Redo はグラフに届かない', () => {
    const typing = { ...quiet, fromEditable: true };
    expect(allowed(of('undo'), typing)).toBe(false);
    expect(allowed(of('redo'), typing)).toBe(false);
  });

  it('入力欄が画面に開いている間は、フォーカスが外れていても削除・編集・Undo は効かない(D-13)', () => {
    const open = { ...quiet, inputOpen: true };
    for (const type of ['deleteRow', 'editName', 'addChild', 'openMemo', 'undo', 'redo'] as const) {
      expect(allowed(of(type), open), type).toBe(false);
      expect(allowed(of(type), quiet), `${type} (入力欄なし)`).toBe(true);
    }
  });

  it('入力欄が開いていても、新規 Task と印の移動は止めない', () => {
    const open = { ...quiet, inputOpen: true };
    expect(allowed(of('newTask'), open)).toBe(true);
    expect(allowed(of('moveMark'), open)).toBe(true);
  });

  it('Tab はダイアログの中だけで使え、それ以外(入力欄の中も)では止める', () => {
    expect(commandFor(key('Tab'))?.type).toBe('blockTab');
    expect(commandFor({ ...key('Tab'), shiftKey: true })?.type).toBe('blockTab');
    expect(commandFor({ ...key('Tab'), metaKey: true })).toBeNull();
    expect(allowed(of('blockTab'), quiet)).toBe(true);
    expect(allowed(of('blockTab'), { ...quiet, fromEditable: true })).toBe(true);
    expect(allowed(of('blockTab'), { ...quiet, dialogOpen: true })).toBe(false);
  });

  it('矢印は入力欄の中では止めない(文字の移動に使う)', () => {
    expect(allowed(of('blockArrow'), { ...quiet, fromEditable: true })).toBe(false);
    expect(allowed(of('blockArrow'), quiet)).toBe(true);
  });

  it('印の移動は入力欄とダイアログの中では動かない', () => {
    expect(allowed(of('moveMark'), { ...quiet, fromEditable: true })).toBe(false);
    expect(allowed(of('moveMark'), { ...quiet, fromDialog: true })).toBe(false);
    expect(allowed(of('moveMark'), quiet)).toBe(true);
  });
});

describe('handOff: 入力欄からの Cmd+N', () => {
  it('入力欄の中から来た Cmd+N は、確定して渡されたときだけ通る', () => {
    const typing = { ...quiet, fromEditable: true, inputOpen: true };
    expect(allowed(of('newTask'), typing)).toBe(false);
    expect(allowed(of('newTask'), { ...typing, handedOff: true })).toBe(true);
  });

  it('handOff の印は、渡したイベントにだけ付く', () => {
    const first = key('n', { metaKey: true });
    const second = key('n', { metaKey: true });
    expect(isHandedOff(first)).toBe(false);
    handOff(first);
    expect(isHandedOff(first)).toBe(true);
    expect(isHandedOff(second)).toBe(false);
  });

  it('渡されても、ダイアログが開いていれば通らない', () => {
    expect(
      allowed(of('newTask'), { ...quiet, fromEditable: true, handedOff: true, dialogOpen: true }),
    ).toBe(false);
  });
});

describe('toggleHelp: ? キー', () => {
  it('? は Shift の有無を問わず一覧の開閉。Cmd / Ctrl / Alt 付きは別のキー', () => {
    expect(commandFor(key('?'))?.type).toBe('toggleHelp');
    expect(commandFor(key('?', { shiftKey: true }))?.type).toBe('toggleHelp');
    for (const mods of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      expect(commandFor(key('?', mods)), JSON.stringify(mods)).toBeNull();
    }
  });

  it('キーリピートでは開閉を繰り返さない', () => {
    expect(commandFor({ ...key('?'), repeat: true })).toBeNull();
  });

  it('ダイアログ・入力欄の中・入力欄が開いている間は拒否、何も無ければ許可', () => {
    const c = { type: 'toggleHelp' } as const;
    expect(allowed(c, quiet)).toBe(true);
    expect(allowed(c, { ...quiet, dialogOpen: true })).toBe(false);
    expect(allowed(c, { ...quiet, fromDialog: true })).toBe(false);
    expect(allowed(c, { ...quiet, fromEditable: true })).toBe(false);
    expect(allowed(c, { ...quiet, inputOpen: true })).toBe(false);
  });
});

describe('SHORTCUTS: キー操作の一覧', () => {
  it('利用者が使う操作が、1件ずつ載っている', () => {
    // blockArrow / blockTab は既定の動きを止めるだけ。toggleHelp は一覧そのものを開閉する
    // 操作で、一覧に載せても読む人の役に立たない。
    const hidden: CommandType[] = ['blockArrow', 'blockTab', 'toggleHelp'];
    const expected = ALL.filter((t) => !hidden.includes(t)).sort();
    expect(SHORTCUTS.map((s) => s.command).sort()).toEqual(expected);
  });

  it('載せたキーは、実際にその操作として解釈される', () => {
    const toInput = (tokens: readonly string[]): KeyInput => {
      const k = tokens[tokens.length - 1] ?? '';
      const name = { '↑': 'ArrowUp', '↓': 'ArrowDown' }[k] ?? k;
      return key(name.length === 1 ? name.toLowerCase() : name, {
        shiftKey: tokens.includes('Shift'),
        ctrlKey: tokens.includes('Mod'),
      });
    };
    for (const s of SHORTCUTS) {
      for (const keys of s.keys) {
        expect(commandFor(toInput(keys))?.type, `${s.command}: ${keys.join('+')}`).toBe(s.command);
      }
    }
  });

  it('すべての項目が group を持ち、Task を選んでいるとき / いつでも に分かれる', () => {
    for (const s of SHORTCUTS) expect(['selected', 'always'], s.command).toContain(s.group);
    const group = (c: string) => SHORTCUTS.find((s) => s.command === c)?.group;
    expect(group('editName')).toBe('selected');
    expect(group('newTask')).toBe('always');
  });

  it('説明が空でなく、入力中の操作も載っている', () => {
    for (const s of SHORTCUTS) expect(s.description).not.toBe('');
    expect(INPUT_SHORTCUTS.map((g) => g.title)).toEqual(['名前', 'メモ']);
    for (const g of INPUT_SHORTCUTS) expect(g.items.length).toBeGreaterThan(0);
  });
});
