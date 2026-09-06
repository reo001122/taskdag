import { describe, expect, it } from 'vitest';
import { deleteTask, planDeleteTask } from './delete-task';
import { isReachable } from './graph-query';
import { buildGraph, C, edgePairs, T } from './test-helpers';
import { sequentialIds } from './test-ids';

/** 削除が成功する前提で新しいグラフを取り出す。失敗したらテストを落とす。 */
function afterDelete(
  graph: Parameters<typeof deleteTask>[0],
  id: Parameters<typeof deleteTask>[1],
) {
  const result = deleteTask(graph, id, sequentialIds());
  if (!result.ok) throw new Error(`expected delete to succeed: ${result.error.type}`);
  return result.value;
}

describe('deleteTask — 依存エッジの再接続ルール(FR-3)', () => {
  it('入力1・出力1: A→B→C から B を消すと A→C に再接続する', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual(['A->C']);
  });

  it('入力が複数・出力1: A1→B, A2→B, B→C なら A1→C と A2→C になる', () => {
    const graph = buildGraph({
      tasks: { A1: {}, A2: {}, B: {}, C: {} },
      edges: [
        ['A1', 'B'],
        ['A2', 'B'],
        ['B', 'C'],
      ],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual(['A1->C', 'A2->C']);
  });

  it('入力1・出力が複数: A→B, B→C1, B→C2 なら A→C1 と A→C2 になる', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C1: {}, C2: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C1'],
        ['B', 'C2'],
      ],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual(['A->C1', 'A->C2']);
  });

  it('入力・出力とも複数: 再接続せず、繋がっていたエッジを削除するのみ', () => {
    const graph = buildGraph({
      tasks: { A1: {}, A2: {}, B: {}, C1: {}, C2: {} },
      edges: [
        ['A1', 'B'],
        ['A2', 'B'],
        ['B', 'C1'],
        ['B', 'C2'],
      ],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual([]);
  });

  it('入力なし: 繋ぐ相手がいないので再接続しない', () => {
    const graph = buildGraph({
      tasks: { B: {}, C: {} },
      edges: [['B', 'C']],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual([]);
  });

  it('出力なし: 繋ぐ相手がいないので再接続しない', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {} },
      edges: [['A', 'B']],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual([]);
  });

  it('再接続先が既存エッジと重複する場合、重複を作らない(INV-4, 冪等)', () => {
    // A→B→C に加えて A→C が既にある。B を消すと A→C を作ろうとするが、既存を維持する。
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
        ['A', 'C'],
      ],
    });
    expect(edgePairs(afterDelete(graph, T('B')))).toEqual(['A->C']);
  });

  it('再接続後も循環が存在しない(domain-design §3.2 の証明の検証)', () => {
    // 合流と分岐が混ざった DAG から中間ノードを消す
    const graph = buildGraph({
      tasks: { A1: {}, A2: {}, B: {}, C: {}, D: {} },
      edges: [
        ['A1', 'B'],
        ['A2', 'B'],
        ['B', 'C'],
        ['C', 'D'],
      ],
    });
    const after = afterDelete(graph, T('B'));
    for (const edge of after.edges.values()) {
      // to から from に戻れてしまうなら循環している
      expect(isReachable(after, edge.to, edge.from)).toBe(false);
    }
  });
});

describe('deleteTask — Task と childTask の削除(FR-1)', () => {
  it('Task を削除するとそのchildTaskも削除される', () => {
    const graph = buildGraph({
      tasks: { A: { children: ['a1', 'a2'] }, B: { children: ['b1'] } },
    });
    const after = afterDelete(graph, T('A'));

    expect(after.tasks.has(T('A'))).toBe(false);
    expect(after.childTasks.has(C('a1'))).toBe(false);
    expect(after.childTasks.has(C('a2'))).toBe(false);

    // 他のTaskのchildTaskは残る
    expect(after.tasks.has(T('B'))).toBe(true);
    expect(after.childTasks.has(C('b1'))).toBe(true);
  });

  it('存在しないTaskの削除は task_not_found を返す', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = deleteTask(graph, T('missing'), sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('task_not_found');
  });

  it('元のグラフを変更しない(イミュータブル)', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    afterDelete(graph, T('B'));
    expect(graph.tasks.has(T('B'))).toBe(true);
    expect(edgePairs(graph)).toEqual(['A->B', 'B->C']);
  });
});

describe('planDeleteTask — 削除前の変更内容の提示(FR-1)', () => {
  it('消えるエッジ・追加されるエッジ・消えるchildTaskを列挙する', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: { children: ['b1', 'b2'] }, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    const result = planDeleteTask(graph, T('B'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const plan = result.value;
    expect(plan.removedEdges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['A->B', 'B->C']);
    expect(plan.addedEdges.map((e) => `${e.from}->${e.to}`)).toEqual(['A->C']);
    expect(plan.removedChildTaskIds).toEqual([C('b1'), C('b2')]);
  });

  it('再接続されない場合、addedEdges は空になる(失われる依存が見えること)', () => {
    const graph = buildGraph({
      tasks: { A1: {}, A2: {}, B: {}, C1: {}, C2: {} },
      edges: [
        ['A1', 'B'],
        ['A2', 'B'],
        ['B', 'C1'],
        ['B', 'C2'],
      ],
    });
    const result = planDeleteTask(graph, T('B'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.removedEdges).toHaveLength(4);
    expect(result.value.addedEdges).toEqual([]);
  });
});
