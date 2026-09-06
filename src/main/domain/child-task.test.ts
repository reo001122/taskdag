import { describe, expect, it } from 'vitest';
import {
  createChildTask,
  deleteChildTask,
  reorderChildTask,
  setChildTaskProgress,
} from './child-task';
import type { TaskGraph } from './model';
import { buildGraph, C, T } from './test-helpers';
import { sequentialIds } from './test-ids';

/** 親Task配下のchildTaskのタイトルを、表示順どおりに取り出す。 */
function orderOf(graph: TaskGraph, parent = T('A')): string[] {
  const task = graph.tasks.get(parent);
  if (!task) throw new Error('parent not found');
  return task.childTaskIds.map((id) => {
    const child = graph.childTasks.get(id);
    if (!child) throw new Error(`INV-8 violated: ${id} is listed but does not exist`);
    return child.title;
  });
}

describe('createChildTask(FR-2)', () => {
  it('追加した childTask は末尾に入る', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1', 'a2'] } } });
    const result = createChildTask(graph, T('A'), 'a3', sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderOf(result.value)).toEqual(['a1', 'a2', 'a3']);
  });

  it('親が存在しなければ task_not_found', () => {
    const graph = buildGraph({ tasks: { A: {} } });
    const result = createChildTask(graph, T('missing'), 'x', sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('task_not_found');
  });

  it('childTask は Project の情報を保持しない(FR-4: 親の位置から導出するため)', () => {
    const graph = buildGraph({
      projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
      tasks: { A: { position: { x: 10, y: 10 } } },
    });
    const result = createChildTask(graph, T('A'), 'a1', sequentialIds());
    if (!result.ok) throw new Error('expected success');
    const child = [...result.value.childTasks.values()][0];
    expect(child).toBeDefined();
    expect(child && 'projectId' in child).toBe(false);
  });
});

describe('reorderChildTask(FR-2)', () => {
  const base = () => buildGraph({ tasks: { A: { children: ['a1', 'a2', 'a3'] } } });

  it('先頭へ移動できる', () => {
    const result = reorderChildTask(base(), C('a3'), 0);
    if (!result.ok) throw new Error('expected success');
    expect(orderOf(result.value)).toEqual(['a3', 'a1', 'a2']);
  });

  it('末尾へ移動できる', () => {
    const result = reorderChildTask(base(), C('a1'), 2);
    if (!result.ok) throw new Error('expected success');
    expect(orderOf(result.value)).toEqual(['a2', 'a3', 'a1']);
  });

  it('中間へ移動できる', () => {
    const result = reorderChildTask(base(), C('a1'), 1);
    if (!result.ok) throw new Error('expected success');
    expect(orderOf(result.value)).toEqual(['a2', 'a1', 'a3']);
  });

  it('同じ位置への移動は順序を変えない', () => {
    const result = reorderChildTask(base(), C('a2'), 1);
    if (!result.ok) throw new Error('expected success');
    expect(orderOf(result.value)).toEqual(['a1', 'a2', 'a3']);
  });

  it('範囲外のインデックスを拒否する', () => {
    for (const index of [-1, 3, 99]) {
      const result = reorderChildTask(base(), C('a1'), index);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.type).toBe('index_out_of_range');
    }
  });

  it('存在しない childTask は child_task_not_found', () => {
    const result = reorderChildTask(base(), C('missing'), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('child_task_not_found');
  });

  it('並べ替え後も INV-8(配列と実体の一致)が保たれる', () => {
    const result = reorderChildTask(base(), C('a3'), 0);
    if (!result.ok) throw new Error('expected success');
    const after = result.value;

    const listed = after.tasks.get(T('A'))?.childTaskIds ?? [];
    const owned = [...after.childTasks.values()]
      .filter((c) => c.parentId === T('A'))
      .map((c) => c.id);

    expect([...listed].sort()).toEqual(owned.sort());
  });
});

describe('deleteChildTask(FR-2)', () => {
  it('削除後も残りの順序が保たれる', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1', 'a2', 'a3'] } } });
    const result = deleteChildTask(graph, C('a2'));
    if (!result.ok) throw new Error('expected success');
    expect(orderOf(result.value)).toEqual(['a1', 'a3']);
  });

  it('親の childTaskIds からも取り除かれる(INV-8)', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1', 'a2'] } } });
    const result = deleteChildTask(graph, C('a1'));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.childTaskIds).toEqual([C('a2')]);
    expect(result.value.childTasks.has(C('a1'))).toBe(false);
  });
});

describe('setChildTaskProgress(FR-5)', () => {
  it('childTask の軸b を変更できる', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1'] } } });
    const result = setChildTaskProgress(graph, C('a1'), 'done');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.childTasks.get(C('a1'))?.progress).toBe('done');
  });

  it('親の軸b は連動しない(FR-5: 親子のDoneは独立)', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1'] } } });
    const result = setChildTaskProgress(graph, C('a1'), 'done');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('A'))?.progress).toBe('not_done');
  });
});
