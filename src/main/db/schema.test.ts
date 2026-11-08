import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openInMemoryDatabase } from './open';
import { load } from './repository';
import { migrate, SCHEMA_VERSION } from './schema';

describe('migrate', () => {
  it('空のDBに初期スキーマを適用し、user_version を進める', () => {
    const db = openInMemoryDatabase();
    const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
    expect(row.user_version).toBe(SCHEMA_VERSION);
  });

  it('適用済みのDBに対しては何もしない(冪等)', () => {
    const db = openInMemoryDatabase();
    expect(() => migrate(db)).not.toThrow();
    const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
    expect(row.user_version).toBe(SCHEMA_VERSION);
  });

  it('将来のバージョンで書かれたDBは開かずに落とす', () => {
    // 新しい版のアプリが書いたDBを古い版で開くと、知らない列や制約を無視した
    // まま書き込んでデータを壊す。黙って進まないこと。
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this app supports/);
  });

  it('FR-11: アーカイブの記録のテーブルが作られる', () => {
    const db = openInMemoryDatabase();
    const cols = (
      db.prepare('PRAGMA table_info(archived_tasks)').all() as unknown as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual(['id', 'title', 'memo', 'child_tasks', 'archived_at', 'project_name']);
  });

  it('FR-11: v5 の既存 DB が、データを保ったまま v6 へ上がる', () => {
    // 旧版のアプリが書いた DB を再現する: v5 で止め、データを入れてから最新へ上げる
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, 5);
    const version = () =>
      (db.prepare('PRAGMA user_version').get() as unknown as { user_version: number }).user_version;
    expect(version()).toBe(5);

    db.exec(`
      INSERT INTO tasks (id, title, progress, position_x, position_y, collapsed, memo)
        VALUES ('t1', '既存の Task', 'done', 1, 2, 0, 'メモ'), ('t2', '後続', 'not_done', 3, 4, 0, '');
      INSERT INTO dependency_edges (id, from_task_id, to_task_id) VALUES ('e1', 't1', 't2');
    `);

    migrate(db);

    expect(version()).toBe(SCHEMA_VERSION);
    const tasks = db.prepare('SELECT id, title FROM tasks ORDER BY id').all() as unknown as {
      id: string;
      title: string;
    }[];
    expect(tasks).toEqual([
      { id: 't1', title: '既存の Task' },
      { id: 't2', title: '後続' },
    ]);
    const edges = db.prepare('SELECT COUNT(*) n FROM dependency_edges').get() as unknown as {
      n: number;
    };
    expect(edges.n).toBe(1);
    // 新しいテーブルは空で使える
    const archived = db.prepare('SELECT COUNT(*) n FROM archived_tasks').get() as unknown as {
      n: number;
    };
    expect(archived.n).toBe(0);
    // 既存の DB が、読み込みも通る
    expect(load(db).tasks.size).toBe(2);
  });

  it('導出用のビューが作られる', () => {
    const db = openInMemoryDatabase();
    const views = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
        .all() as unknown as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(views).toEqual(['child_task_view', 'task_overview', 'task_project', 'task_readiness']);
  });
});
