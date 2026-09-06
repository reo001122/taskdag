import { describe, expect, it } from 'vitest';
import { canConnect } from './connect';
import { buildGraph, T } from './test-helpers';

describe('canConnect', () => {
  it('FR-3: 循環にならない接続は許可する', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} } });
    expect(canConnect(graph, T('A'), T('B')).ok).toBe(true);
  });

  it('FR-3: 自己ループを拒否する(INV-5)', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = canConnect(graph, T('A'), T('A'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('self_loop');
  });

  it('FR-3: 既存エッジと重複する接続を拒否する(INV-4)', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} }, edges: [['A', 'B']] });
    const result = canConnect(graph, T('A'), T('B'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('edge_already_exists');
  });

  it('FR-3: 直接の逆方向を拒否する(B->A がある時の A->B)', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} }, edges: [['B', 'A']] });
    const result = canConnect(graph, T('A'), T('B'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('would_create_cycle');
  });

  it('FR-3: 間接的な循環を拒否する(A->B->C がある時の C->A)', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    const result = canConnect(graph, T('C'), T('A'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('would_create_cycle');
  });

  it('FR-3: 長い経路を跨ぐ循環も検知する', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {}, D: {}, E: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'E'],
      ],
    });
    const result = canConnect(graph, T('E'), T('A'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('would_create_cycle');
  });

  it('FR-3: 合流はするが循環しない形(ダイヤモンド)は許可する', () => {
    // A->B, A->C, B->D, C->D は DAG。A->D を足しても循環しない。
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {}, D: {} },
      edges: [
        ['A', 'B'],
        ['A', 'C'],
        ['B', 'D'],
        ['C', 'D'],
      ],
    });
    expect(canConnect(graph, T('A'), T('D')).ok).toBe(true);
  });

  it('FR-3: 別の Project の領域にある Task へも接続できる', () => {
    const graph = buildGraph({
      projects: {
        p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 },
        p2: { name: 'BBB', x: 500, y: 0, w: 100, h: 100 },
      },
      tasks: { A: { position: { x: 10, y: 10 } }, B: { position: { x: 510, y: 10 } } },
    });
    expect(canConnect(graph, T('A'), T('B')).ok).toBe(true);
  });

  it('存在しないTaskへの接続を拒否する(INV-1)', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const from = canConnect(graph, T('missing'), T('A'));
    expect(from.ok).toBe(false);
    if (!from.ok) expect(from.error.type).toBe('task_not_found');

    const to = canConnect(graph, T('A'), T('missing'));
    expect(to.ok).toBe(false);
    if (!to.ok) expect(to.error.type).toBe('task_not_found');
  });
});
