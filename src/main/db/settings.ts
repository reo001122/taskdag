import type { DatabaseSync } from 'node:sqlite';

/**
 * アプリケーションの表示設定(design/persistence-design.md)
 *
 * タスクグラフのデータではないため、`TaskGraph` にも差分計算にも含めない。
 * Undo/Redo の対象外(FR-6)。ドメイン層はこの存在を知らなくてよい。
 */

const HIDE_COMPLETED = 'hide_completed_tasks';

export function getHideCompleted(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(HIDE_COMPLETED) as
    | { value: string }
    | undefined;
  return row?.value === 'true';
}

export function setHideCompleted(db: DatabaseSync, value: boolean): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(HIDE_COMPLETED, value ? 'true' : 'false');
}
