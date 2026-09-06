import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyGraph, type TaskGraph } from '../domain/model';
import { getAllTaskProjects } from '../domain/project';
import { getAllReadiness } from '../domain/readiness';
import { buildGraph, T } from '../domain/test-helpers';
import { computeDiff } from './diff';
import { openInMemoryDatabase } from './open';
import { applyDiff } from './repository';

/**
 * SQL ビューとドメイン関数の一致検証(design/persistence-design.md §2)
 *
 * task_readiness ビューは domain/readiness.ts の導出ロジックの二重実装である。
 * 片方だけ変更すると齟齬が生じるため、同じケースを両方に通して一致を確認する。
 */

let db: DatabaseSync;
beforeEach(() => {
  db = openInMemoryDatabase();
});

function persist(graph: TaskGraph): void {
  applyDiff(db, computeDiff(emptyGraph, graph));
}

function readinessFromView(): Map<string, string> {
  const rows = db.prepare('SELECT task_id, readiness FROM task_readiness').all() as unknown as {
    task_id: string;
    readiness: string;
  }[];
  return new Map(rows.map((r) => [r.task_id, r.readiness]));
}

/** 同じグラフに対して、ビューとドメイン関数が同一の結果を返すこと。 */
function expectViewMatchesDomain(graph: TaskGraph): void {
  persist(graph);
  const fromView = readinessFromView();
  const fromDomain = getAllReadiness(graph);

  expect(fromView.size).toBe(fromDomain.size);
  for (const [id, readiness] of fromDomain) {
    expect(`${id}: ${fromView.get(id)}`).toBe(`${id}: ${readiness}`);
  }
}

describe('task_readiness ビューが domain/readiness.ts と一致する', () => {
  it('入力エッジなし(すべて ready)', () => {
    expectViewMatchesDomain(buildGraph({ tasks: { A: {}, B: {} } }));
  });

  it('全先行が Done', () => {
    expectViewMatchesDomain(
      buildGraph({
        tasks: { A: 'done', B: 'done', C: 'not_done' },
        edges: [
          ['A', 'C'],
          ['B', 'C'],
        ],
      }),
    );
  });

  it('先行が1つでも not_done', () => {
    expectViewMatchesDomain(
      buildGraph({
        tasks: { A: 'done', B: 'not_done', C: 'not_done' },
        edges: [
          ['A', 'C'],
          ['B', 'C'],
        ],
      }),
    );
  });

  it('先行が in_progress でも blocked', () => {
    expectViewMatchesDomain(
      buildGraph({ tasks: { A: 'in_progress', B: 'not_done' }, edges: [['A', 'B']] }),
    );
  });

  it('鎖状の伝播', () => {
    expectViewMatchesDomain(
      buildGraph({
        tasks: { A: 'not_done', B: 'not_done', C: 'not_done' },
        edges: [
          ['A', 'B'],
          ['B', 'C'],
        ],
      }),
    );
  });

  it('「Blocked かつ Done」の後続が ready になる(意図的な帰結)', () => {
    const graph = buildGraph({
      tasks: { A: 'not_done', B: 'done', C: 'not_done' },
      edges: [
        ['A', 'B'],
        ['B', 'C'],
      ],
    });
    expectViewMatchesDomain(graph);

    // 念のため具体値も確認する
    const view = readinessFromView();
    expect(view.get(T('B'))).toBe('blocked');
    expect(view.get(T('C'))).toBe('ready');
  });

  it('ダイヤモンド型の合流', () => {
    expectViewMatchesDomain(
      buildGraph({
        tasks: { A: 'done', B: 'done', C: 'not_done', D: 'not_done' },
        edges: [
          ['A', 'B'],
          ['A', 'C'],
          ['B', 'D'],
          ['C', 'D'],
        ],
      }),
    );
  });
});

describe('task_project ビューが domain/project.ts と一致する', () => {
  /**
   * 所属の導出も SQL 側に同じ意味の式を持っている。
   * readiness と同様、片方だけ変えると齟齬が出るため一致を確認する。
   */
  function expectProjectViewMatchesDomain(graph: TaskGraph): void {
    persist(graph);
    const rows = db.prepare('SELECT task_id, project_id FROM task_project').all() as unknown as {
      task_id: string;
      project_id: string | null;
    }[];
    const fromView = new Map(rows.map((r) => [r.task_id, r.project_id]));
    const fromDomain = getAllTaskProjects(graph);

    expect(fromView.size).toBe(fromDomain.size);
    for (const [id, projectId] of fromDomain) {
      expect(`${id}: ${fromView.get(id) ?? 'null'}`).toBe(`${id}: ${projectId ?? 'null'}`);
    }
  }

  it('枠の中と外', () => {
    expectProjectViewMatchesDomain(
      buildGraph({
        projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
        tasks: {
          inside: { position: { x: 20, y: 20 } },
          outside: { position: { x: 500, y: 500 } },
        },
      }),
    );
  });

  it('境界上の点', () => {
    expectProjectViewMatchesDomain(
      buildGraph({
        projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
        tasks: {
          corner: { position: { x: 100, y: 100 } },
          origin: { position: { x: 0, y: 0 } },
          just_outside: { position: { x: 101, y: 100 } },
        },
      }),
    );
  });

  it('入れ子の枠(面積の小さいほうが勝つ)', () => {
    expectProjectViewMatchesDomain(
      buildGraph({
        projects: {
          big: { name: '大', x: 0, y: 0, w: 500, h: 500 },
          small: { name: '小', x: 10, y: 10, w: 100, h: 100 },
        },
        tasks: { t: { position: { x: 50, y: 50 } }, u: { position: { x: 300, y: 300 } } },
      }),
    );
  });

  it('同じ面積で重なる枠(id の小さいほうが勝つ)', () => {
    expectProjectViewMatchesDomain(
      buildGraph({
        projects: {
          aaa: { name: 'A', x: 0, y: 0, w: 100, h: 100 },
          bbb: { name: 'B', x: 0, y: 0, w: 100, h: 100 },
        },
        tasks: { t: { position: { x: 50, y: 50 } } },
      }),
    );
  });

  it('Project が1つもない', () => {
    expectProjectViewMatchesDomain(buildGraph({ tasks: { a: {}, b: {} } }));
  });
});

describe('task_overview ビュー', () => {
  it('childTask の総数と完了数を返す', () => {
    persist(
      buildGraph({
        projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
        tasks: {
          A: {
            position: { x: 10, y: 10 },
            children: [
              { id: 'a1', progress: 'done' },
              { id: 'a2' },
              { id: 'a3', progress: 'done' },
            ],
          },
        },
      }),
    );

    const row = db.prepare('SELECT * FROM task_overview WHERE id = ?').get('A') as unknown as {
      child_total: number;
      child_done: number;
      project_name: string;
    };

    expect(row.child_total).toBe(3);
    expect(row.child_done).toBe(2);
    expect(row.project_name).toBe('AAA');
  });

  it('「今着手できるもの」を1クエリで抽出できる', () => {
    persist(
      buildGraph({
        tasks: { A: 'done', B: 'not_done', C: 'not_done', D: 'done' },
        edges: [
          ['A', 'B'],
          ['B', 'C'],
        ],
      }),
    );

    const rows = db
      .prepare("SELECT id FROM task_overview WHERE readiness = 'ready' AND progress <> 'done'")
      .all() as unknown as { id: string }[];

    expect(rows.map((r) => r.id).sort()).toEqual(['B']);
  });
});

describe('child_task_view ビュー', () => {
  it('childTask が親の Project タグを継承して見える(FR-4)', () => {
    persist(
      buildGraph({
        projects: { p1: { name: 'AAA', x: 0, y: 0, w: 100, h: 100 } },
        tasks: {
          A: { position: { x: 10, y: 10 }, children: ['a1'] },
          B: { position: { x: 500, y: 500 }, children: ['b1'] },
        },
      }),
    );

    const rows = db
      .prepare('SELECT id, project_id FROM child_task_view ORDER BY id')
      .all() as unknown as { id: string; project_id: string | null }[];

    expect(rows).toEqual([
      { id: 'a1', project_id: 'p1' },
      { id: 'b1', project_id: null },
    ]);
  });
});
