import { describe, expect, it } from 'vitest';
import {
  createProject,
  deleteProject,
  moveProject,
  projectOfTask,
  renameProject,
  resizeProject,
  setProjectColor,
  tasksInProject,
} from './project';
import { buildGraph, P, T } from './test-helpers';
import { sequentialIds } from './test-ids';

/** 100x100 の枠 p1 を (0,0) に置いたグラフ。 */
const withFrame = () =>
  buildGraph({
    projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
    tasks: {
      inside: { position: { x: 20, y: 20 } },
      outside: { position: { x: 500, y: 500 } },
    },
  });

describe('所属の導出(FR-4)', () => {
  it('枠の中にある Task は、その Project に属する', () => {
    expect(projectOfTask(withFrame(), T('inside'))).toBe(P('p1'));
  });

  it('枠の外にある Task は、どの Project にも属さない', () => {
    expect(projectOfTask(withFrame(), T('outside'))).toBeNull();
  });

  it('境界上の点は含まれるものとして扱う', () => {
    const graph = buildGraph({
      projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
      tasks: { corner: { position: { x: 100, y: 100 } } },
    });
    expect(projectOfTask(graph, T('corner'))).toBe(P('p1'));
  });

  it('枠が重なっている場合、面積の小さいほうに属する', () => {
    // 大きな枠の中に小さな枠がある。より限定的なほうが意図に近い。
    const graph = buildGraph({
      projects: {
        big: { name: '大', x: 0, y: 0, w: 500, h: 500 },
        small: { name: '小', x: 10, y: 10, w: 100, h: 100 },
      },
      tasks: { t: { position: { x: 50, y: 50 } } },
    });
    expect(projectOfTask(graph, T('t'))).toBe(P('small'));
  });

  it('Project に属する Task を列挙できる', () => {
    const graph = buildGraph({
      projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
      tasks: {
        a: { position: { x: 10, y: 10 } },
        b: { position: { x: 90, y: 90 } },
        c: { position: { x: 300, y: 300 } },
      },
    });
    expect(tasksInProject(graph, P('p1')).sort()).toEqual([T('a'), T('b')]);
  });
});

describe('createProject / renameProject / deleteProject(FR-4)', () => {
  it('矩形として作成される', () => {
    const result = createProject(
      buildGraph({}),
      'AAA',
      { x: 10, y: 20 },
      300,
      200,
      3,
      sequentialIds(),
    );
    if (!result.ok) throw new Error('expected success');
    const project = [...result.value.projects.values()][0];
    expect(project?.name).toBe('AAA');
    expect(project?.colorIndex).toBe(3);
    expect(project?.position).toEqual({ x: 10, y: 20 });
    expect(project?.width).toBe(300);
    expect(project?.height).toBe(200);
  });

  it('色を後から変更できる', () => {
    const result = setProjectColor(withFrame(), P('p1'), 5);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.projects.get(P('p1'))?.colorIndex).toBe(5);
  });

  it('名前を変更できる', () => {
    const result = renameProject(withFrame(), P('p1'), 'BBB');
    if (!result.ok) throw new Error('expected success');
    expect(result.value.projects.get(P('p1'))?.name).toBe('BBB');
  });

  it('枠を消しても Task は消えない。所属が外れるだけ', () => {
    const result = deleteProject(withFrame(), P('p1'));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.size).toBe(2);
    expect(projectOfTask(result.value, T('inside'))).toBeNull();
  });

  it('存在しない Project の操作は project_not_found', () => {
    for (const result of [
      renameProject(buildGraph({}), P('ghost'), 'x'),
      deleteProject(buildGraph({}), P('ghost')),
      moveProject(buildGraph({}), P('ghost'), { x: 0, y: 0 }),
      resizeProject(buildGraph({}), P('ghost'), { x: 0, y: 0 }, 10, 10),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.type).toBe('project_not_found');
    }
  });
});

describe('moveProject — 中身も一緒に動く', () => {
  it('枠の中の Task が同じだけ移動する', () => {
    const result = moveProject(withFrame(), P('p1'), { x: 200, y: 100 });
    if (!result.ok) throw new Error('expected success');

    // 枠が (0,0) -> (200,100) なので、中の Task も +200/+100
    expect(result.value.tasks.get(T('inside'))?.position).toEqual({ x: 220, y: 120 });
    // 外の Task は動かない
    expect(result.value.tasks.get(T('outside'))?.position).toEqual({ x: 500, y: 500 });
  });

  it('移動しても、中にいた Task の所属は変わらない', () => {
    const result = moveProject(withFrame(), P('p1'), { x: 800, y: 800 });
    if (!result.ok) throw new Error('expected success');
    expect(projectOfTask(result.value, T('inside'))).toBe(P('p1'));
  });
});

describe('resizeProject — 中身は動かない', () => {
  it('狭めると、外れた Task の所属がなくなる', () => {
    const result = resizeProject(withFrame(), P('p1'), { x: 0, y: 0 }, 10, 10);
    if (!result.ok) throw new Error('expected success');
    // inside は (20,20) にいるので 10x10 の枠からは外れる
    expect(projectOfTask(result.value, T('inside'))).toBeNull();
  });

  it('広げると、新たに入った Task が所属する', () => {
    const result = resizeProject(withFrame(), P('p1'), { x: 0, y: 0 }, 1000, 1000);
    if (!result.ok) throw new Error('expected success');
    expect(projectOfTask(result.value, T('outside'))).toBe(P('p1'));
  });

  it('Task の位置は変わらない', () => {
    const result = resizeProject(withFrame(), P('p1'), { x: 0, y: 0 }, 1000, 1000);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.tasks.get(T('inside'))?.position).toEqual({ x: 20, y: 20 });
  });
});
