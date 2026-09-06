import { describe, expect, it } from 'vitest';
import { getAllReadiness, readinessOf } from './readiness';
import { buildGraph, T } from './test-helpers';

describe('readinessOf', () => {
  it('FR-5: 入力エッジを持たないTaskは常に ready', () => {
    const graph = buildGraph({ tasks: { A: 'not_done' } });
    expect(readinessOf(graph, T('A'))).toBe('ready');
  });

  it('FR-5: 全ての先行TaskがDoneなら ready', () => {
    const graph = buildGraph({
      tasks: { A: 'done', B: 'done', C: 'not_done' },
      edges: [
        ['A', 'C'],
        ['B', 'C'],
      ],
    });
    expect(readinessOf(graph, T('C'))).toBe('ready');
  });

  it('FR-5: 先行Taskが1つでも not_done なら blocked', () => {
    const graph = buildGraph({
      tasks: { A: 'done', B: 'not_done', C: 'not_done' },
      edges: [
        ['A', 'C'],
        ['B', 'C'],
      ],
    });
    expect(readinessOf(graph, T('C'))).toBe('blocked');
  });

  it('FR-5: 先行Taskが in_progress でも blocked(解放条件は Done のみ)', () => {
    const graph = buildGraph({
      tasks: { A: 'in_progress', B: 'not_done' },
      edges: [['A', 'B']],
    });
    expect(readinessOf(graph, T('B'))).toBe('blocked');
  });

  it('FR-5: 判定は直接の先行のみを見る。推移的なブロックは自然に伝播する', () => {
    // A(not_done) -> B(not_done) -> C
    // B は blocked。C の直接の先行である B が未Done なので C も blocked。
    const graph = buildGraph({
      tasks: { A: 'not_done', B: 'not_done', C: 'not_done' },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    expect(readinessOf(graph, T('B'))).toBe('blocked');
    expect(readinessOf(graph, T('C'))).toBe('blocked');
  });

  it('意図的な帰結: 「Blocked かつ Done」のTaskの後続は ready になる(domain-design §3.3)', () => {
    // A は未Done。ユーザーは B を Done にできる(軸aは軸bを制限しない)。
    // このとき B は blocked かつ done。B が done である以上、C は ready。
    const graph = buildGraph({
      tasks: { A: 'not_done', B: 'done', C: 'not_done' },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    expect(readinessOf(graph, T('B'))).toBe('blocked');
    expect(readinessOf(graph, T('C'))).toBe('ready');
  });

  it('存在しないTaskを問い合わせたら例外を投げる', () => {
    const graph = buildGraph({ tasks: { A: 'not_done' } });
    expect(() => readinessOf(graph, T('missing'))).toThrow();
  });
});

describe('getAllReadiness', () => {
  it('全Taskぶんの導出結果を返す', () => {
    const graph = buildGraph({
      tasks: { A: 'done', B: 'not_done', C: 'not_done' },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    const all = getAllReadiness(graph);
    expect(all.get(T('A'))).toBe('ready');
    expect(all.get(T('B'))).toBe('ready');
    expect(all.get(T('C'))).toBe('blocked');
    expect(all.size).toBe(3);
  });
});
