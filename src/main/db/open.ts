import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema';

/**
 * DB 接続を開き、PRAGMA を設定してマイグレーションを適用する。
 *
 * WAL を有効にするのは、アプリが書き込み中でも別プロセス(開発時のAI等)から
 * SELECT できるようにするため(design/persistence-design.md §7)。
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** テスト用のインメモリDB。WAL はファイルを伴わないため設定しない。 */
export function openInMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}
