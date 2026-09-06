import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyGraph, type TaskGraph } from '../domain/model';
import { buildGraph, C, edgePairs, T } from '../domain/test-helpers';
import { computeDiff } from './diff';
import { openInMemoryDatabase } from './open';
import { applyDiff, load } from './repository';

let db: DatabaseSync;
beforeEach(() => {
  db = openInMemoryDatabase();
});

/** 空の状態から graph を書き込み、読み戻す。 */
function roundTrip(graph: TaskGraph): TaskGraph {
  applyDiff(db, computeDiff(emptyGraph, graph));
  return load(db);
}

describe('load / applyDiff — 往復', () => {
  it('空のグラフを往復できる', () => {
    const after = roundTrip(emptyGraph);
    expect(after.tasks.size).toBe(0);
    expect(after.edges.size).toBe(0);
  });

  it('Task・childTask・エッジ・Project を含むグラフを往復できる', () => {
    const graph = buildGraph({
      projects: { p1: { name: 'AAA', x: 0, y: 0, w: 200, h: 200 } },
      tasks: {
        A: { progress: 'done', position: { x: 10, y: 20 }, collapsed: true, memo: '作業メモ' },
        B: { position: { x: 500, y: 500 }, children: ['b1', 'b2'] },
      },
      edges: [['A', 'B']],
    });

    const after = roundTrip(graph);

    const a = after.tasks.get(T('A'));
    expect(a?.title).toBe('A');
    expect(a?.progress).toBe('done');
    expect(a?.position).toEqual({ x: 10, y: 20 });
    expect(a?.collapsed).toBe(true);
    expect(a?.memo).toBe('作業メモ');

    expect(after.tasks.get(T('B'))?.childTaskIds).toEqual([C('b1'), C('b2')]);
    expect(edgePairs(after)).toEqual(['A->B']);
    const project = after.projects.get('p1' as never);
    expect(project?.name).toBe('AAA');
    expect(project?.position).toEqual({ x: 0, y: 0 });
    expect(project?.width).toBe(200);
    expect(project?.height).toBe(200);
  });

  it('childTask の順序が往復で保たれる', () => {
    const graph = buildGraph({ tasks: { A: { children: ['a1', 'a2', 'a3'] } } });
    const after = roundTrip(graph);
    expect(after.tasks.get(T('A'))?.childTaskIds).toEqual([C('a1'), C('a2'), C('a3')]);
  });

  it('並べ替えの差分を適用すると順序が入れ替わる', () => {
    applyDiff(
      db,
      computeDiff(emptyGraph, buildGraph({ tasks: { A: { children: ['a1', 'a2'] } } })),
    );

    const reordered = buildGraph({ tasks: { A: { children: ['a2', 'a1'] } } });
    applyDiff(db, computeDiff(load(db), reordered));

    expect(load(db).tasks.get(T('A'))?.childTaskIds).toEqual([C('a2'), C('a1')]);
  });

  it('差分適用で削除が反映される', () => {
    const before = buildGraph({
      tasks: { A: {}, B: { children: ['b1'] } },
      edges: [['A', 'B']],
    });
    applyDiff(db, computeDiff(emptyGraph, before));

    const after = buildGraph({ tasks: { A: {} } });
    applyDiff(db, computeDiff(load(db), after));

    const loaded = load(db);
    expect(loaded.tasks.has(T('B'))).toBe(false);
    expect(loaded.childTasks.size).toBe(0);
    expect(loaded.edges.size).toBe(0);
  });
});

describe('DB制約による不変条件の担保', () => {
  it('INV-1: 存在しないTaskを参照するエッジを拒否する(外部キー)', () => {
    applyDiff(db, computeDiff(emptyGraph, buildGraph({ tasks: { A: {} } })));
    expect(() =>
      db
        .prepare('INSERT INTO dependency_edges (id, from_task_id, to_task_id) VALUES (?,?,?)')
        .run('bad', 'A', 'ghost'),
    ).toThrow();
  });

  it('INV-4: 同一 from/to の重複エッジを拒否する', () => {
    applyDiff(
      db,
      computeDiff(emptyGraph, buildGraph({ tasks: { A: {}, B: {} }, edges: [['A', 'B']] })),
    );
    expect(() =>
      db
        .prepare('INSERT INTO dependency_edges (id, from_task_id, to_task_id) VALUES (?,?,?)')
        .run('dup', 'A', 'B'),
    ).toThrow();
  });

  it('INV-5: 自己ループを拒否する(CHECK制約)', () => {
    applyDiff(db, computeDiff(emptyGraph, buildGraph({ tasks: { A: {} } })));
    expect(() =>
      db
        .prepare('INSERT INTO dependency_edges (id, from_task_id, to_task_id) VALUES (?,?,?)')
        .run('loop', 'A', 'A'),
    ).toThrow();
  });

  it('不正な progress 値を拒否する(CHECK制約)', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO tasks (id,title,progress,project_id,position_x,position_y,collapsed) VALUES (?,?,?,?,?,?,?)',
        )
        .run('x', 't', 'bogus', null, 0, 0, 0),
    ).toThrow();
  });
});

describe('applyDiff のトランザクション', () => {
  it('途中で失敗したら全体がロールバックされる', () => {
    applyDiff(db, computeDiff(emptyGraph, buildGraph({ tasks: { A: {} } })));

    // 存在しないTaskを参照するエッジを含む不正な差分を作る
    const broken = {
      projects: { inserted: [], updated: [], deleted: [] },
      tasks: {
        inserted: [
          {
            id: 'B',
            title: 'B',
            progress: 'not_done' as const,
            position_x: 0,
            position_y: 0,
            collapsed: 0,
            memo: '',
          },
        ],
        updated: [],
        deleted: [],
      },
      childTasks: { inserted: [], updated: [], deleted: [] },
      edges: {
        inserted: [{ id: 'e', from_task_id: 'B', to_task_id: 'ghost' }],
        updated: [],
        deleted: [],
      },
    };

    expect(() => applyDiff(db, broken)).toThrow();
    // 同じ差分に含まれていた Task B も入っていないこと
    expect(load(db).tasks.has(T('B'))).toBe(false);
  });
});

describe('order_index の整合性検証', () => {
  it('連番が壊れていたら load で例外を投げる', () => {
    applyDiff(
      db,
      computeDiff(emptyGraph, buildGraph({ tasks: { A: { children: ['a1', 'a2'] } } })),
    );
    // UNIQUE 制約を課していないため、直接書き換えると壊せてしまう。
    // 起動時に検知できることを確認する。
    db.prepare('UPDATE child_tasks SET order_index = 5 WHERE id = ?').run('a2');
    expect(() => load(db)).toThrow(/order_index/);
  });
});

describe('破損したDBの検知', () => {
  it('循環した依存グラフを含むDBは load で拒否する(INV-3)', () => {
    // 通常の書き込み経路(ドメイン層)では循環を作れないが、DBファイルが
    // 破損・手編集された場合は循環したまま読み込めてしまう。
    // 削除時の再接続は「非循環である」前提で循環検知を省略しているため、
    // 入口で止めないとさらに壊れた状態(自己ループ等)を生む。
    applyDiff(db, computeDiff(emptyGraph, buildGraph({ tasks: { A: {}, B: {} } })));
    const insert = db.prepare(
      'INSERT INTO dependency_edges (id, from_task_id, to_task_id) VALUES (?,?,?)',
    );
    insert.run('e1', 'A', 'B');
    insert.run('e2', 'B', 'A');

    expect(() => load(db)).toThrow(/cycle/);
  });

  it('自己ループ以外の長い循環も検知する', () => {
    applyDiff(db, computeDiff(emptyGraph, buildGraph({ tasks: { A: {}, B: {}, C: {} } })));
    const insert = db.prepare(
      'INSERT INTO dependency_edges (id, from_task_id, to_task_id) VALUES (?,?,?)',
    );
    insert.run('e1', 'A', 'B');
    insert.run('e2', 'B', 'C');
    insert.run('e3', 'C', 'A');

    expect(() => load(db)).toThrow(/cycle/);
  });

  it('循環していない複雑なグラフは通す(誤検知しない)', () => {
    const graph = buildGraph({
      tasks: { A: {}, B: {}, C: {}, D: {}, E: {} },
      edges: [
        ['A', 'B'],
        ['A', 'C'],
        ['B', 'D'],
        ['C', 'D'],
        ['D', 'E'],
      ],
    });
    applyDiff(db, computeDiff(emptyGraph, graph));
    expect(() => load(db)).not.toThrow();
    expect(load(db).edges.size).toBe(5);
  });
});
