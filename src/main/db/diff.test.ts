import { describe, expect, it } from 'vitest';
import { buildGraph, C, T } from '../domain/test-helpers';
import { computeDiff, isEmptyDiff } from './diff';

describe('computeDiff', () => {
  it('変化がなければ空の差分を返す', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} }, edges: [['A', 'B']] });
    expect(isEmptyDiff(computeDiff(graph, graph))).toBe(true);
  });

  it('追加されたTaskを inserted として拾う', () => {
    const before = buildGraph({ tasks: { A: {} } });
    const after = buildGraph({ tasks: { A: {}, B: {} } });
    const diff = computeDiff(before, after);
    expect(diff.tasks.inserted.map((r) => r.id)).toEqual(['B']);
    expect(diff.tasks.updated).toEqual([]);
    expect(diff.tasks.deleted).toEqual([]);
  });

  it('削除されたTaskを deleted として拾う', () => {
    const before = buildGraph({ tasks: { A: {}, B: {} } });
    const after = buildGraph({ tasks: { A: {} } });
    expect(computeDiff(before, after).tasks.deleted).toEqual(['B']);
  });

  it('変更されたフィールドだけを updated として拾う', () => {
    const before = buildGraph({ tasks: { A: 'not_done', B: {} } });
    const after = buildGraph({ tasks: { A: 'done', B: {} } });
    const diff = computeDiff(before, after);
    expect(diff.tasks.updated.map((r) => r.id)).toEqual(['A']);
    expect(diff.tasks.inserted).toEqual([]);
  });

  it('座標の変更を検出する', () => {
    const before = buildGraph({ tasks: { A: { position: { x: 0, y: 0 } } } });
    const after = buildGraph({ tasks: { A: { position: { x: 10, y: 0 } } } });
    expect(computeDiff(before, after).tasks.updated).toHaveLength(1);
  });

  it('エッジの追加・削除を検出する', () => {
    const before = buildGraph({ tasks: { A: {}, B: {} } });
    const after = buildGraph({ tasks: { A: {}, B: {} }, edges: [['A', 'B']] });

    const added = computeDiff(before, after);
    expect(added.edges.inserted).toHaveLength(1);

    const removed = computeDiff(after, before);
    expect(removed.edges.deleted).toEqual(['A->B']);
  });

  it('childTask の並べ替えを order_index の更新として検出する', () => {
    // ドメイン上は親の配列が変わるだけだが、DB では子の order_index が変わる。
    const before = buildGraph({ tasks: { A: { children: ['a1', 'a2'] } } });
    const after = buildGraph({ tasks: { A: { children: ['a2', 'a1'] } } });
    const diff = computeDiff(before, after);

    expect(diff.tasks.updated).toEqual([]); // 親Task自体の列は変わらない
    expect(diff.childTasks.updated).toHaveLength(2);

    const byId = new Map(diff.childTasks.updated.map((r) => [r.id, r.order_index]));
    expect(byId.get(C('a2'))).toBe(0);
    expect(byId.get(C('a1'))).toBe(1);
  });

  it('childTask の追加は inserted、親Taskは変更なしとして扱う', () => {
    const before = buildGraph({ tasks: { A: { children: ['a1'] } } });
    const after = buildGraph({ tasks: { A: { children: ['a1', 'a2'] } } });
    const diff = computeDiff(before, after);

    expect(diff.childTasks.inserted.map((r) => r.id)).toEqual([C('a2')]);
    expect(diff.tasks.updated).toEqual([]);
  });

  it('Task削除に伴う childTask とエッジの削除をまとめて拾う', () => {
    const before = buildGraph({
      tasks: { A: {}, B: { children: ['b1', 'b2'] }, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    const after = buildGraph({ tasks: { A: {}, C: {} }, edges: [] });
    const diff = computeDiff(before, after);

    expect(diff.tasks.deleted).toEqual([T('B')]);
    expect([...diff.childTasks.deleted].sort()).toEqual([C('b1'), C('b2')]);
    expect([...diff.edges.deleted].sort()).toEqual(['A->B', 'B->C']);
  });
});
