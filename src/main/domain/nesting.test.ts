import { describe, expect, it } from 'vitest';
import { demoteTaskToChild, moveChildTask, promoteChildTask } from './nesting';
import { buildGraph, C, T } from './test-helpers';
import { sequentialIds } from './test-ids';

/** 末尾へ。位置を問わない検査では、表示の数を持ち出さずにこれを渡す。 */
const END = Number.POSITIVE_INFINITY;

/** 親Taskの childTask のタイトルを、並び順に並べて返す。 */
const titlesOf = (graph: ReturnType<typeof buildGraph>, parent: string) =>
  (graph.tasks.get(T(parent))?.childTaskIds ?? []).map((id) => graph.childTasks.get(id)?.title);

/** 依存を "from→to" の集合にする。 */
const edgesOf = (graph: ReturnType<typeof buildGraph>) =>
  [...graph.edges.values()].map((e) => `${e.from}→${e.to}`).sort();

describe('Task を childTask にする(W-3)', () => {
  it('W-3: Task が消えて、相手の childTask として末尾に付く', () => {
    const graph = buildGraph({ tasks: { A: { children: ['既にある'] }, T: {} } });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tasks.has(T('T'))).toBe(false);
    expect(titlesOf(result.value, 'A')).toEqual(['既にある', 'T']);
  });

  it('W-3: 状態とメモは引き継ぐ', () => {
    const graph = buildGraph({
      tasks: { A: {}, T: { progress: 'in_progress', memo: '途中まで' } },
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = [...result.value.childTasks.values()].find((c) => c.title === 'T');
    expect(moved?.progress).toBe('in_progress');
    expect(moved?.memo).toBe('途中まで');
  });

  it('W-3: 依存は新しい親へ付け替わる(X→T は X→A、T→Y は A→Y)', () => {
    const graph = buildGraph({
      tasks: { X: {}, A: {}, T: {}, Y: {} },
      edges: [
        ['X', 'T'],
        ['T', 'Y'],
      ],
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(edgesOf(result.value)).toEqual(['A→Y', 'X→A']);
  });

  it('W-3: 新しい親との間の依存は落とす(自己ループになるため)', () => {
    const graph = buildGraph({ tasks: { A: {}, T: {} }, edges: [['A', 'T']] });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(edgesOf(result.value)).toEqual([]);
  });

  it('W-3: 付け替えると重複する依存は落とす', () => {
    const graph = buildGraph({
      tasks: { X: {}, A: {}, T: {} },
      edges: [
        ['X', 'T'],
        ['X', 'A'],
      ],
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(edgesOf(result.value)).toEqual(['X→A']);
  });

  it('W-3: 付け替えると循環する依存は落とす', () => {
    // A→X→T。T が A の下に入ると X→A になり、A→X と合わせて循環する。
    const graph = buildGraph({
      tasks: { A: {}, X: {}, T: {} },
      edges: [
        ['A', 'X'],
        ['X', 'T'],
      ],
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(edgesOf(result.value)).toEqual(['A→X']);
  });

  it('W-3: childTask を持っていた場合、新しい親の下へ並べ直す(孫は作らない)', () => {
    const graph = buildGraph({
      tasks: { A: { children: ['A の手順'] }, T: { children: ['手順1', '手順2'] } },
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(titlesOf(result.value, 'A')).toEqual(['A の手順', 'T', '手順1', '手順2']);
  });

  it('W-3: 指定した位置に入る', () => {
    const graph = buildGraph({
      tasks: { A: { children: ['先', '後'] }, T: {} },
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), 1, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(titlesOf(result.value, 'A')).toEqual(['先', 'T', '後']);
  });

  it('W-3: childTask を持っていたら、その位置にまとめて入る', () => {
    const graph = buildGraph({
      tasks: { A: { children: ['先', '後'] }, T: { children: ['手順1', '手順2'] } },
    });
    const result = demoteTaskToChild(graph, T('T'), T('A'), 1, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(titlesOf(result.value, 'A')).toEqual(['先', 'T', '手順1', '手順2', '後']);
  });

  it('W-3: 自分自身の下には入れられない', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = demoteTaskToChild(graph, T('A'), T('A'), END, sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('cannot_nest_into_itself');
  });
});

describe('childTask を独立させる(W-3)', () => {
  it('W-3: 親から外れて、独立した Task になる', () => {
    const graph = buildGraph({ tasks: { A: { children: [{ id: 'c1' }, { id: 'c2' }] } } });
    const result = promoteChildTask(graph, C('c1'), { x: 10, y: 20 }, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.childTasks.has(C('c1'))).toBe(false);
    expect(titlesOf(result.value, 'A')).toEqual(['c2']);
    expect([...result.value.tasks.values()].some((t) => t.title === 'c1')).toBe(true);
  });

  it('W-3: 落とした場所がそのまま座標になる(所属はそこから導かれる)', () => {
    const graph = buildGraph({ tasks: { A: { children: [{ id: 'c1' }] } } });
    const result = promoteChildTask(graph, C('c1'), { x: 300, y: 400 }, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = [...result.value.tasks.values()].find((t) => t.title === 'c1');
    expect(created?.position).toEqual({ x: 300, y: 400 });
  });

  it('W-3: 元の親の依存はそのまま。独立した Task には依存が付かない', () => {
    const graph = buildGraph({
      tasks: { X: {}, A: { children: [{ id: 'c1' }] } },
      edges: [['X', 'A']],
    });
    const result = promoteChildTask(graph, C('c1'), { x: 0, y: 0 }, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(edgesOf(result.value)).toEqual(['X→A']);
  });
});

describe('childTask を別の Task へ移す(W-3)', () => {
  it('W-3: 元の親から外れ、移した先の末尾に付く', () => {
    const graph = buildGraph({
      tasks: { A: { children: [{ id: 'c1' }, { id: 'c2' }] }, B: { children: [{ id: 'b1' }] } },
    });
    const result = moveChildTask(graph, C('c1'), T('B'), END);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(titlesOf(result.value, 'A')).toEqual(['c2']);
    expect(titlesOf(result.value, 'B')).toEqual(['b1', 'c1']);
    expect(result.value.childTasks.get(C('c1'))?.parentId).toBe(T('B'));
  });

  it('W-3: 移す先の、指定した位置に入る', () => {
    const graph = buildGraph({
      tasks: { A: { children: [{ id: 'c1' }] }, B: { children: [{ id: 'b1' }, { id: 'b2' }] } },
    });
    const result = moveChildTask(graph, C('c1'), T('B'), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(titlesOf(result.value, 'B')).toEqual(['b1', 'c1', 'b2']);
  });

  it('W-3: 同じ親の中で動かすと並べ替えになる', () => {
    const graph = buildGraph({
      tasks: { A: { children: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] } },
    });
    const result = moveChildTask(graph, C('c1'), T('A'), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 表示の並びで「c3 の手前」。自分が抜けるぶん後ろがずれるのを吸収する。
    expect(titlesOf(result.value, 'A')).toEqual(['c2', 'c1', 'c3']);
  });

  it('W-3: 同じ親で、元の位置へ戻すと並びは変わらない', () => {
    const graph = buildGraph({
      tasks: { A: { children: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] } },
    });
    const result = moveChildTask(graph, C('c2'), T('A'), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(titlesOf(result.value, 'A')).toEqual(['c1', 'c2', 'c3']);
  });
});
