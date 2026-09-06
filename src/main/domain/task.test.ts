import { describe, expect, it } from 'vitest';
import { canConnect } from './connect';
import {
  applyLayout,
  connect,
  createTask,
  disconnect,
  moveTask,
  setTaskCollapsed,
  setTaskMemo,
  setTaskProgress,
} from './task';
import { buildGraph, edgePairs, T } from './test-helpers';
import { sequentialIds } from './test-ids';

describe('createTask(FR-1)', () => {
  it('Task を作成できる', () => {
    const result = createTask(buildGraph({}), 'first', { x: 10, y: 20 }, sequentialIds());
    if (!result.ok) throw new Error('expected success');
    const task = [...result.value.tasks.values()][0];
    expect(task?.title).toBe('first');
    expect(task?.position).toEqual({ x: 10, y: 20 });
    expect(task?.progress).toBe('not_done');
    expect(task?.childTaskIds).toEqual([]);
    // Project への所属は Task 側に持たない。位置から導出する(FR-4)
    expect('projectId' in (task ?? {})).toBe(false);
  });
});

describe('setTaskProgress(FR-5)', () => {
  it('Blocked な Task でも軸b を変更できる(軸aは操作を制限しない)', () => {
    const graph = buildGraph({
      tasks: { A: 'not_done', B: 'not_done' },
      edges: [['A', 'B']],
    });
    // B は blocked。それでも In Progress にできる。
    const result = setTaskProgress(graph, T('B'), 'in_progress');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tasks.get(T('B'))?.progress).toBe('in_progress');
  });

  it('childTask の軸b は連動しない(FR-5: 親子は独立)', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1'] } } });
    const result = setTaskProgress(graph, T('A'), 'done');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.childTasks.values().next().value?.progress).toBe('not_done');
  });
});

describe('moveTask / setTaskCollapsed(FR-6)', () => {
  it('座標を更新できる(手動配置を保持する)', () => {
    const graph = buildGraph({ tasks: { A: { position: { x: 0, y: 0 } } } });
    const result = moveTask(graph, T('A'), { x: 300, y: 150 });
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.position).toEqual({ x: 300, y: 150 });
  });

  it('折りたたみ状態を切り替えられる', () => {
    const graph = buildGraph({ tasks: { A: { collapsed: false } } });
    const result = setTaskCollapsed(graph, T('A'), true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.collapsed).toBe(true);
  });
});

describe('setTaskMemo(FR-10)', () => {
  it('メモを書き込める', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = setTaskMemo(graph, T('A'), 'ここまでやった');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.memo).toBe('ここまでやった');
  });

  it('既定は空文字(メモなし)', () => {
    const result = createTask(buildGraph({}), 'x', { x: 0, y: 0 }, sequentialIds());
    if (!result.ok) throw new Error('expected success');
    expect([...result.value.tasks.values()][0]?.memo).toBe('');
  });

  it('空文字を渡すとメモを消せる', () => {
    const graph = buildGraph({ tasks: { A: { memo: '古いメモ' } } });
    const result = setTaskMemo(graph, T('A'), '');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.memo).toBe('');
  });

  it('改行を含む本文をそのまま保てる', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = setTaskMemo(graph, T('A'), '1行目\n2行目\n\n4行目');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.memo).toBe('1行目\n2行目\n\n4行目');
  });

  it('存在しない Task は task_not_found', () => {
    const result = setTaskMemo(buildGraph({}), T('missing'), 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('task_not_found');
  });
});

describe('connect / disconnect(FR-3)', () => {
  it('依存エッジを張れる', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} } });
    const result = connect(graph, T('A'), T('B'), sequentialIds());
    if (!result.ok) throw new Error('expected success');
    expect(edgePairs(result.value)).toEqual(['A->B']);
  });

  it('循環する接続は canConnect と同じ理由で拒否される', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} }, edges: [['B', 'A']] });
    const result = connect(graph, T('A'), T('B'), sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('would_create_cycle');
    // 判定ロジックが canConnect と共有されていること
    expect(canConnect(graph, T('A'), T('B')).ok).toBe(false);
  });

  it('依存エッジを外せる', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} }, edges: [['A', 'B']] });
    const edge = [...graph.edges.keys()][0];
    if (!edge) throw new Error('no edge');
    const result = disconnect(graph, edge);
    if (!result.ok) throw new Error('expected success');
    expect(edgePairs(result.value)).toEqual([]);
  });
});

describe('applyLayout(FR-6)', () => {
  it('複数Taskの座標をまとめて更新する(整列操作)', () => {
    const graph = buildGraph({ tasks: { A: {}, B: {} } });
    const result = applyLayout(graph, [
      { id: T('A'), position: { x: 100, y: 0 } },
      { id: T('B'), position: { x: 200, y: 0 } },
    ]);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.position).toEqual({ x: 100, y: 0 });
    expect(result.value.tasks.get(T('B'))?.position).toEqual({ x: 200, y: 0 });
  });

  it('存在しないTaskが含まれていたら全体を失敗させる(部分適用しない)', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = applyLayout(graph, [
      { id: T('A'), position: { x: 100, y: 0 } },
      { id: T('missing'), position: { x: 0, y: 0 } },
    ]);
    expect(result.ok).toBe(false);
  });
});
