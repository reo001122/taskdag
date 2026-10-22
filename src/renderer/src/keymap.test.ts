import { describe, expect, it } from 'vitest';
import { allowed, type CommandType, commandFor, type KeyContext, type KeyInput } from './keymap';

const ALL: CommandType[] = [
  'editName',
  'addChild',
  'openMemo',
  'deleteRow',
  'undo',
  'redo',
  'newTask',
  'moveMark',
  'blockArrow',
];

/** 何も起きていない画面(キャンバスにフォーカスがあり、入力欄もダイアログも無い)。 */
const quiet: KeyContext = {
  fromEditable: false,
  fromKeyOwningUi: false,
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

describe('allowed: 実行してよいか', () => {
  it('ダイアログが開いていれば、グラフに触れる操作はすべて拒否する', () => {
    const open = { ...quiet, dialogOpen: true };
    for (const type of ALL.filter((t) => t !== 'moveMark' && t !== 'blockArrow')) {
      expect(allowed(of(type), open), type).toBe(false);
    }
  });

  it('入力欄の中のキーは、Enter 系・削除に届かない', () => {
    const typing = { ...quiet, fromEditable: true, inputOpen: true };
    for (const type of ['editName', 'addChild', 'openMemo', 'deleteRow'] as const) {
      expect(allowed(of(type), typing), type).toBe(false);
    }
  });

  it('入力欄が画面に開いている間は、フォーカスが外れていても Delete は効かない(D-13)', () => {
    expect(allowed(of('deleteRow'), { ...quiet, inputOpen: true })).toBe(false);
    expect(allowed(of('deleteRow'), quiet)).toBe(true);
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
