import { describe, expect, it } from 'vitest';
import { TaskGraphStore } from './store';
import { buildGraph, edgePairs, T } from './test-helpers';
import { sequentialIds } from './test-ids';

const chain = () =>
  buildGraph({
    tasks: { A: {}, B: {}, C: {} },
    edges: [
      ['A', 'B'],
      ['B', 'C'],
    ],
  });

const storeOf = (graph = chain(), maxHistory?: number) =>
  new TaskGraphStore(graph, sequentialIds(), maxHistory);

describe('TaskGraphStore — Undo / Redo(FR-8)', () => {
  it('削除+再接続が1回の Undo で完全に戻る', () => {
    const store = storeOf();
    expect(store.deleteTask(T('B')).ok).toBe(true);
    expect(edgePairs(store.graph)).toEqual(['A->C']);

    expect(store.undo()).toBe(true);
    expect(store.graph.tasks.has(T('B'))).toBe(true);
    expect(edgePairs(store.graph)).toEqual(['A->B', 'B->C']);
  });

  it('Redo で削除後の状態に戻せる', () => {
    const store = storeOf();
    store.deleteTask(T('B'));
    store.undo();

    expect(store.redo()).toBe(true);
    expect(store.graph.tasks.has(T('B'))).toBe(false);
    expect(edgePairs(store.graph)).toEqual(['A->C']);
  });

  it('履歴がないとき undo / redo は false を返す(エラーにはしない)', () => {
    const store = storeOf();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('Undo 後に新しい操作を行うと Redo 履歴が破棄される', () => {
    const store = storeOf();
    store.deleteTask(T('B'));
    store.undo();
    expect(store.canRedo).toBe(true);

    store.setTaskProgress(T('A'), 'done');
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('失敗した操作は履歴に積まれない', () => {
    const store = storeOf();
    const result = store.deleteTask(T('missing'));

    expect(result.ok).toBe(false);
    expect(store.canUndo).toBe(false);
  });

  it('深さの上限を超えると古い履歴から破棄される', () => {
    const store = storeOf(buildGraph({ tasks: { A: {} } }), 3);
    for (const title of ['t1', 't2', 't3', 't4', 't5']) {
      store.updateTaskTitle(T('A'), title);
    }
    expect(store.graph.tasks.get(T('A'))?.title).toBe('t5');

    // 3手ぶんだけ戻れる
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
    expect(store.graph.tasks.get(T('A'))?.title).toBe('t2');
  });

  it('既定の深さは 50(domain-design §4)', () => {
    const store = storeOf(buildGraph({ tasks: { A: {} } }));
    for (let i = 0; i < 60; i += 1) store.updateTaskTitle(T('A'), `t${i}`);

    let undone = 0;
    while (store.undo()) undone += 1;
    expect(undone).toBe(50);
  });
});

describe('TaskGraphStore — batch(FR-8: 操作の粒度)', () => {
  it('まとめた複数操作が1回の Undo で戻る', () => {
    const store = storeOf(buildGraph({ tasks: { A: {}, B: {}, C: {} } }));

    const result = store.batch(() => {
      const a = store.setTaskProgress(T('A'), 'done');
      if (!a.ok) return a;
      const b = store.setTaskProgress(T('B'), 'done');
      if (!b.ok) return b;
      return store.setTaskProgress(T('C'), 'done');
    });
    expect(result.ok).toBe(true);
    expect(store.graph.tasks.get(T('C'))?.progress).toBe('done');

    expect(store.undo()).toBe(true);
    expect(store.graph.tasks.get(T('A'))?.progress).toBe('not_done');
    expect(store.graph.tasks.get(T('B'))?.progress).toBe('not_done');
    expect(store.graph.tasks.get(T('C'))?.progress).toBe('not_done');
    expect(store.canUndo).toBe(false);
  });

  it('batch 内で失敗したら全体がロールバックされる(部分適用しない)', () => {
    const store = storeOf(buildGraph({ tasks: { A: {}, B: {} } }));

    const result = store.batch(() => {
      const a = store.setTaskProgress(T('A'), 'done');
      if (!a.ok) return a;
      return store.setTaskProgress(T('missing'), 'done');
    });

    expect(result.ok).toBe(false);
    // 1つ目の変更も取り消されていること
    expect(store.graph.tasks.get(T('A'))?.progress).toBe('not_done');
    expect(store.canUndo).toBe(false);
  });

  it('AIが5件まとめて削除した場合、Undo 1回で全て戻る', () => {
    const store = storeOf(buildGraph({ tasks: { A: {}, B: {}, C: {}, D: {}, E: {}, F: {} } }));

    store.batch(() => {
      for (const id of ['A', 'B', 'C', 'D', 'E']) {
        const r = store.deleteTask(T(id));
        if (!r.ok) return r;
      }
      return { ok: true, value: undefined } as const;
    });
    expect(store.graph.tasks.size).toBe(1);

    expect(store.undo()).toBe(true);
    expect(store.graph.tasks.size).toBe(6);
  });
});

describe('TaskGraphStore — 導出値', () => {
  it('Ready / Blocked を問い合わせられる(永続化せず常に導出)', () => {
    const store = storeOf();
    expect(store.readinessOf(T('A'))).toBe('ready');
    expect(store.readinessOf(T('B'))).toBe('blocked');

    store.setTaskProgress(T('A'), 'done');
    expect(store.readinessOf(T('B'))).toBe('ready');
  });

  it('接続可否を判定できる(UIの isValidConnection 用)', () => {
    const store = storeOf();
    expect(store.canConnect(T('C'), T('A'))).toBe(false);
    expect(store.canConnect(T('A'), T('C'))).toBe(true);
  });
});
