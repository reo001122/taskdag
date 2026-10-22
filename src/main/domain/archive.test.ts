import { describe, expect, it } from 'vitest';
import { archiveCompletedTasks, archiveTasks, planArchive } from './archive';
import { deleteTask } from './delete-task';
import { getAllReadiness } from './readiness';
import { TaskGraphStore } from './store';
import { buildGraph, edgePairs, P, T } from './test-helpers';
import { sequentialIds } from './test-ids';

const AT = 1_700_000_000_000;

function archived(
  graph: Parameters<typeof archiveTasks>[0],
  ids: string[],
  at = AT,
): ReturnType<typeof buildGraph> {
  const result = archiveTasks(graph, ids.map(T), sequentialIds(), at);
  if (!result.ok) throw new Error(`expected archive to succeed: ${result.error.type}`);
  return result.value;
}

describe('archiveTasks — 対象(FR-11)', () => {
  it('FR-11: 完了した Task だけがアーカイブできる', () => {
    const graph = buildGraph({ tasks: { A: 'not_done', B: 'in_progress', C: 'done' } });
    for (const id of ['A', 'B']) {
      const result = archiveTasks(graph, [T(id)], sequentialIds(), AT);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toEqual({ type: 'task_not_done', id: T(id) });
    }
    expect(archiveTasks(graph, [T('C')], sequentialIds(), AT).ok).toBe(true);
  });

  it('FR-11: 存在しない Task は task_not_found', () => {
    const result = archiveTasks(buildGraph({}), [T('x')], sequentialIds(), AT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('task_not_found');
  });

  it('FR-11: 1件でも完了していなければ、まとめて指定しても何も移らない', () => {
    const graph = buildGraph({ tasks: { A: 'done', B: 'not_done' } });
    expect(archiveTasks(graph, [T('A'), T('B')], sequentialIds(), AT).ok).toBe(false);
    expect(graph.archived).toEqual([]);
    expect(graph.tasks.has(T('A'))).toBe(true);
  });

  it('FR-11: 記録は名前・メモ・childTask(名前・状態・メモ)・時刻を持つ', () => {
    const graph = buildGraph({
      tasks: {
        A: {
          progress: 'done',
          memo: 'メモ',
          children: ['a1', { id: 'a2', progress: 'done', memo: 'm2' }],
        },
      },
    });
    const after = archived(graph, ['A']);
    expect(after.tasks.size).toBe(0);
    expect(after.childTasks.size).toBe(0);
    expect(after.archived).toEqual([
      {
        id: T('A'),
        title: 'A',
        memo: 'メモ',
        childTasks: [
          { title: 'a1', progress: 'not_done', memo: '' },
          { title: 'a2', progress: 'done', memo: 'm2' },
        ],
        archivedAt: AT,
        projectName: null,
      },
    ]);
  });

  it('FR-11: childTask は完了かどうかに関わらず一緒に移る', () => {
    const graph = buildGraph({
      tasks: { A: { progress: 'done', children: ['a1'] }, B: { children: ['b1'] } },
    });
    const after = archived(graph, ['A']);
    expect(after.childTasks.size).toBe(1);
    expect(after.tasks.has(T('B'))).toBe(true);
    expect(after.archived[0]?.childTasks).toHaveLength(1);
  });

  it('FR-11, FR-4: アーカイブの時点で属していた Project の名前を写す', () => {
    const graph = buildGraph({
      tasks: {
        A: { progress: 'done', position: { x: 10, y: 10 } },
        B: { progress: 'done', position: { x: 5000, y: 5000 } },
      },
      projects: { p1: { name: '設計', w: 100, h: 100 } },
    });
    const after = archived(graph, ['A', 'B']);
    expect(after.archived.map((r) => [r.id, r.projectName])).toEqual([
      [T('A'), '設計'],
      [T('B'), null],
    ]);
    // Project の名前が後で変わっても記録は変わらない
    expect(graph.projects.get(P('p1'))?.name).toBe('設計');
  });

  it('FR-11: 元のグラフを変更しない(イミュータブル)', () => {
    const graph = buildGraph({ tasks: { A: 'done' } });
    archived(graph, ['A']);
    expect(graph.tasks.has(T('A'))).toBe(true);
    expect(graph.archived).toEqual([]);
  });
});

describe('archiveTasks — 依存の扱いは削除と同じ(FR-3)', () => {
  const chain = () =>
    buildGraph({
      tasks: { A: 'not_done', B: 'done', C: 'not_done' },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });

  it('FR-3, FR-11: A→B(完了)→C で B をアーカイブすると A→C に繋ぎ直る', () => {
    expect(edgePairs(archived(chain(), ['B']))).toEqual(['A->C']);
  });

  it('FR-3, FR-11: 入力・出力とも複数なら繋ぎ直さない', () => {
    const graph = buildGraph({
      tasks: { A1: {}, A2: {}, B: 'done', C1: {}, C2: {} },
      edges: [
        ['A1', 'B'],
        ['A2', 'B'],
        ['B', 'C1'],
        ['B', 'C2'],
      ],
    });
    expect(edgePairs(archived(graph, ['B']))).toEqual([]);
  });

  it('FR-3, FR-11: 結果のエッジは deleteTask と同じ', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: 'done', C1: {}, C2: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C1'],
        ['B', 'C2'],
      ],
    });
    const deleted = deleteTask(graph, T('B'), sequentialIds());
    if (!deleted.ok) throw new Error('unreachable');
    expect(edgePairs(archived(graph, ['B']))).toEqual(edgePairs(deleted.value));
  });

  it('FR-11: A→B(完了)→C で B をアーカイブしても、A が未完了の間は C は Blocked のまま', () => {
    const after = archived(chain(), ['B']);
    expect(getAllReadiness(after).get(T('C'))).toBe('blocked');
  });

  it('FR-11: アーカイブした Task は Ready 判定の対象にも、先行としても現れない', () => {
    // 完了していない先行がいない C は、B を移したあとも Ready のまま
    const graph = buildGraph({
      tasks: { A: 'done', B: 'done', C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    const after = archived(graph, ['B']);
    const readiness = getAllReadiness(after);
    expect([...readiness.keys()].sort()).toEqual([T('A'), T('C')]);
    expect(readiness.get(T('C'))).toBe('ready');
  });
});

describe('archiveCompletedTasks — まとめて(FR-11)', () => {
  const graph = () =>
    buildGraph({
      tasks: {
        A: 'not_done',
        B: 'done',
        C: 'done',
        D: 'not_done',
        E: 'done',
        F: 'done',
        G: 'done',
      },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['A', 'E'],
        ['A', 'F'],
        ['E', 'G'],
        ['F', 'G'],
      ],
    });

  it('FR-11: 完了している Task をすべて移し、未完了は残す', () => {
    const result = archiveCompletedTasks(graph(), sequentialIds(), AT);
    if (!result.ok) throw new Error('expected success');
    expect([...result.value.tasks.keys()].sort()).toEqual([T('A'), T('D')]);
    expect(result.value.archived).toHaveLength(5);
  });

  it('FR-3, FR-11: まとめて移した結果は、1件ずつ同じ規則を順に適用した結果と一致する', () => {
    const batch = archiveCompletedTasks(graph(), sequentialIds(), AT);
    if (!batch.ok) throw new Error('expected success');

    let seq = graph();
    const ids = sequentialIds();
    for (const id of ['B', 'C', 'E', 'F', 'G']) {
      const next = archiveTasks(seq, [T(id)], ids, AT);
      if (!next.ok) throw new Error('expected success');
      seq = next.value;
    }
    expect(edgePairs(batch.value)).toEqual(edgePairs(seq));
    expect(batch.value.archived).toEqual(seq.archived);
    expect(edgePairs(batch.value)).toEqual(['A->D']);
  });

  it('FR-11: 完了した Task が無ければグラフをそのまま返す', () => {
    const g = buildGraph({ tasks: { A: {} } });
    const result = archiveCompletedTasks(g, sequentialIds(), AT);
    expect(result.ok && result.value === g).toBe(true);
  });
});

describe('planArchive — 実行前の提示(FR-11)', () => {
  it('FR-11: 消える依存・繋ぎ直される依存・移る childTask の数を返す', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: { progress: 'done', children: ['b1', 'b2'] }, C: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    const result = planArchive(graph, [T('B')]);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.removedEdges.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
      'A->B',
      'B->C',
    ]);
    expect(result.value.addedEdges).toEqual([{ from: T('A'), to: T('C') }]);
    expect(result.value.childTaskCount).toBe(2);
    expect(graph.tasks.has(T('B'))).toBe(true);
  });

  it('FR-11: 実際に起きる結果と一致する(まとめて)', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: 'done', C: 'done', D: {} },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
      ],
    });
    const plan = planArchive(graph, [T('B'), T('C')]);
    if (!plan.ok) throw new Error('expected success');
    expect(plan.value.addedEdges).toEqual([{ from: T('A'), to: T('D') }]);
    expect(plan.value.removedEdges.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
      'A->B',
      'B->C',
      'C->D',
    ]);
  });

  it('FR-11: 完了していない Task を含むとエラー', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    expect(planArchive(graph, [T('A')]).ok).toBe(false);
  });
});

describe('TaskGraphStore — アーカイブと Undo(FR-11, FR-8)', () => {
  const store = () =>
    new TaskGraphStore(
      buildGraph({
        tasks: { A: {}, B: { progress: 'done', children: ['b1'] }, C: 'done' },
        edges: [['A', 'B']],
      }),
      sequentialIds(),
    );

  it('FR-11, FR-8: Cmd+Z 1回で、グラフへの復帰と記録の取り消しが揃って起きる', () => {
    const s = store();
    expect(s.archiveCompletedTasks(AT).ok).toBe(true);
    expect(s.graph.archived).toHaveLength(2);
    expect(s.graph.tasks.size).toBe(1);

    expect(s.undo()).toBe(true);
    expect(s.graph.archived).toEqual([]);
    expect([...s.graph.tasks.keys()].sort()).toEqual([T('A'), T('B'), T('C')]);
    expect(s.graph.childTasks.size).toBe(1);
    expect(edgePairs(s.graph)).toEqual(['A->B']);
  });

  it('FR-8: Redo でアーカイブ後の状態に戻る', () => {
    const s = store();
    s.archiveTask(T('B'), AT);
    s.undo();
    expect(s.redo()).toBe(true);
    expect(s.graph.archived.map((r) => r.id)).toEqual([T('B')]);
  });

  it('FR-11: 完了していない Task の失敗は状態も履歴も変えない', () => {
    const s = store();
    expect(s.archiveTask(T('A'), AT).ok).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('FR-11: 移す対象が無いまとめてのアーカイブは履歴に積まない', () => {
    const s = new TaskGraphStore(buildGraph({ tasks: { A: {} } }), sequentialIds());
    expect(s.archiveCompletedTasks(AT).ok).toBe(true);
    expect(s.canUndo).toBe(false);
  });
});
