import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openInMemoryDatabase } from './open';
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
