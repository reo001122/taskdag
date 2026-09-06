import type { DatabaseSync } from 'node:sqlite';

/**
 * SQLite スキーマとマイグレーション(design/persistence-design.md §1, §6)
 *
 * バージョン管理は PRAGMA user_version で行い、追加のライブラリを導入しない。
 */

export const SCHEMA_VERSION = 5;

/**
 * v1 の初期スキーマ。
 *
 * 不変条件のうち DB 制約で担保できるものはここで表現する。
 * ただし INV-3(循環しない)はグラフ探索が必要なため SQL では表現できず、
 * ドメイン層のみが防波堤となる(FR-7.5 が書き込み経路をドメインに限定している前提)。
 */
const MIGRATION_1 = `
CREATE TABLE projects (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  progress   TEXT NOT NULL
             CHECK (progress IN ('not_done', 'in_progress', 'done')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1))
);

CREATE TABLE child_tasks (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  progress    TEXT NOT NULL
              CHECK (progress IN ('not_done', 'in_progress', 'done')),
  order_index INTEGER NOT NULL
  -- UNIQUE (parent_id, order_index) は意図的に課さない。
  -- 並べ替えを個別UPDATEで行うと一時的に重複が生じ、SQLite の UNIQUE は
  -- 遅延評価できないため。順序の一意性はドメイン層 + 起動時検証で担保する
  -- (design/persistence-design.md §3)。
);

CREATE TABLE dependency_edges (
  id           TEXT PRIMARY KEY,
  from_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE (from_task_id, to_task_id),           -- INV-4
  CHECK (from_task_id <> to_task_id)           -- INV-5
);

-- アプリケーションの表示設定。タスクグラフのデータではない(FR-6)。
-- Undo 対象外であり、差分計算にも含まれない。
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_edges_to           ON dependency_edges(to_task_id);
CREATE INDEX idx_edges_from         ON dependency_edges(from_task_id);
CREATE INDEX idx_tasks_project      ON tasks(project_id);
CREATE INDEX idx_child_parent_order ON child_tasks(parent_id, order_index);

-- 軸a(Ready/Blocked)の導出。domain/readiness.ts と同じ意味を持たなければならない。
-- 両者が一致することは結合テストで検証する(design/persistence-design.md §2)。
CREATE VIEW task_readiness AS
SELECT
  t.id AS task_id,
  CASE WHEN EXISTS (
    SELECT 1
    FROM dependency_edges e
    JOIN tasks p ON p.id = e.from_task_id
    WHERE e.to_task_id = t.id
      AND p.progress <> 'done'
  ) THEN 'blocked' ELSE 'ready' END AS readiness
FROM tasks t;

-- AI / アプリケーション層がよく使う複合ビュー。
CREATE VIEW task_overview AS
SELECT
  t.id, t.title, t.progress,
  r.readiness,
  p.name AS project_name,
  (SELECT COUNT(*) FROM child_tasks c WHERE c.parent_id = t.id) AS child_total,
  (SELECT COUNT(*) FROM child_tasks c WHERE c.parent_id = t.id
     AND c.progress = 'done') AS child_done
FROM tasks t
JOIN task_readiness r ON r.task_id = t.id
LEFT JOIN projects p ON p.id = t.project_id;

-- childTask の Project タグ継承(FR-4)を反映したビュー。
CREATE VIEW child_task_view AS
SELECT c.*, t.project_id
FROM child_tasks c
JOIN tasks t ON t.id = c.parent_id;
`;

/**
 * v2: Project を「タグ」から「キャンバス上の領域」へ変更する(FR-4)。
 *
 * 所属は Task が矩形に含まれているかで導出するようになったため、
 * tasks.project_id は不要になった。導出値を保存しない方針に合わせる
 * (design/coding-standards.md §4)。
 */
const MIGRATION_2 = `
-- 依存しているビューを先に落とす。SQLite は列を落とす際に既存ビューを
-- 検証するため、古い列を参照したままだと DROP COLUMN が失敗する。
DROP VIEW task_overview;
DROP VIEW child_task_view;

-- 索引のある列は DROP COLUMN できないので、インデックスも先に外す
DROP INDEX idx_tasks_project;
ALTER TABLE tasks DROP COLUMN project_id;

ALTER TABLE projects ADD COLUMN position_x REAL NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN position_y REAL NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN width      REAL NOT NULL DEFAULT 400;
ALTER TABLE projects ADD COLUMN height     REAL NOT NULL DEFAULT 300;

-- 所属の導出。domain/project.ts の projectOfTask と同じ意味でなければならない。
-- 判定は Task の左上の点。重なりは面積の小さいほう、同面積なら id の小さいほう。
CREATE VIEW task_project AS
SELECT
  t.id AS task_id,
  (SELECT p.id
     FROM projects p
    WHERE t.position_x >= p.position_x AND t.position_x <= p.position_x + p.width
      AND t.position_y >= p.position_y AND t.position_y <= p.position_y + p.height
    ORDER BY p.width * p.height ASC, p.id ASC
    LIMIT 1) AS project_id
FROM tasks t;

CREATE VIEW task_overview AS
SELECT
  t.id, t.title, t.progress,
  r.readiness,
  (SELECT name FROM projects WHERE id = tp.project_id) AS project_name,
  (SELECT COUNT(*) FROM child_tasks c WHERE c.parent_id = t.id) AS child_total,
  (SELECT COUNT(*) FROM child_tasks c WHERE c.parent_id = t.id
     AND c.progress = 'done') AS child_done
FROM tasks t
JOIN task_readiness r ON r.task_id = t.id
JOIN task_project tp ON tp.task_id = t.id;

-- childTask は親の所属を引き継ぐ(FR-4)。親の位置から導出される。
CREATE VIEW child_task_view AS
SELECT c.*, tp.project_id
FROM child_tasks c
JOIN task_project tp ON tp.task_id = c.parent_id;
`;

/**
 * v3: Project に色を持たせる(FR-4)。
 *
 * 色そのものではなく、表示側の配色表の何番目かを持つ。見た目の値を
 * データに焼き付けると、配色を変えたときに既存の Project だけ取り残される。
 */
const MIGRATION_3 = `
ALTER TABLE projects ADD COLUMN color_index INTEGER NOT NULL DEFAULT 0;
`;

/**
 * v4: Task に自由記述のメモを持たせる(FR-10)。
 *
 * 中断して戻ってきたときに読み返すためのもの。空文字がメモなしを表す。
 */
const MIGRATION_4 = `
ALTER TABLE tasks ADD COLUMN memo TEXT NOT NULL DEFAULT '';
`;

/** v5: childTask にもメモを持たせる(FR-10)。Task と同じ扱い。 */
const MIGRATION_5 = `
DROP VIEW child_task_view;
ALTER TABLE child_tasks ADD COLUMN memo TEXT NOT NULL DEFAULT '';
CREATE VIEW child_task_view AS
SELECT c.*, tp.project_id
FROM child_tasks c
JOIN task_project tp ON tp.task_id = c.parent_id;
`;

const MIGRATIONS: readonly string[] = [
  MIGRATION_1,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
];

function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * 未適用のマイグレーションを順に適用する。
 * 各マイグレーションはトランザクション内で実行し、途中で失敗したら巻き戻す。
 */
export function migrate(db: DatabaseSync): void {
  const from = currentVersion(db);

  // 将来のバージョンで書かれた DB を、古いスキーマ想定で読んではならない。
  // 黙って進むと、知らない列や制約を無視したまま書き込んでデータを壊す。
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `database schema version ${from} is newer than this app supports (${SCHEMA_VERSION}); refusing to open`,
    );
  }

  for (let version = from; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) continue;

    db.exec('BEGIN');
    try {
      db.exec(sql);
      // user_version はパラメータバインドできないため、数値を直接埋め込む。
      // version + 1 は内部で生成した整数であり、外部入力ではない。
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
