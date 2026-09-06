# 永続化設計 v1

ステータス: 初稿。`design/domain-design.md` のモデルをSQLiteへ写像する。`design/development-process.md` Phase 2に対応。

## 前提

- DB: SQLite / ドライバ: **`node:sqlite`**(Node標準。`design/tech-stack.md` の切り替え経緯を参照)
- 規模: 数十〜百Task(NFR-1)。1Taskあたりのchild は数個〜十数個を想定。
- **AIの参照経路はアプリケーション層のツール**(FR-7.5。Phase 4 で実装予定)。直接SELECTは開発・デバッグ用の抜け道として残る。
- **書き込みは必ずドメイン層を経由する**(FR-7.5)。DBはドメインの状態を写す先であり、ロジックを持たない。

## 1. スキーマ

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Project はキャンバス上の領域(FR-4)。矩形そのものを持つ
  position_x  REAL NOT NULL,
  position_y  REAL NOT NULL,
  width       REAL NOT NULL,
  height      REAL NOT NULL,
  -- 表示側の配色表の何番目か。色の値そのものは持たない
  color_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  progress   TEXT NOT NULL
             CHECK (progress IN ('not_done', 'in_progress', 'done')),
  -- project_id は持たない。所属は矩形への含有から導出する(FR-4)
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  memo       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE child_tasks (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  progress    TEXT NOT NULL
              CHECK (progress IN ('not_done', 'in_progress', 'done')),
  order_index INTEGER NOT NULL,
  memo        TEXT NOT NULL DEFAULT ''
  -- UNIQUE (parent_id, order_index) は意図的に課さない。理由は §3 を参照
);

CREATE TABLE dependency_edges (
  id           TEXT PRIMARY KEY,
  from_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE (from_task_id, to_task_id),
  CHECK (from_task_id <> to_task_id)
);

-- アプリケーションの表示設定。タスクグラフのデータではない(FR-6)
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 例: ('hide_completed_tasks', 'false')

CREATE INDEX idx_edges_to   ON dependency_edges(to_task_id);
CREATE INDEX idx_edges_from ON dependency_edges(from_task_id);
CREATE INDEX idx_child_parent_order ON child_tasks(parent_id, order_index);
```

### 不変条件とDB制約の対応

| 不変条件 | DBでの担保 |
|---|---|
| INV-1(エッジはTaskを指す) | 外部キー制約 ✓ |
| INV-2(エッジはchildTaskを指さない) | `child_tasks` と `tasks` が別テーブルであることで構造的に保証 ✓ |
| INV-3(循環しない) | **担保できない**(グラフ探索が必要)→ ドメイン層のみ |
| INV-4(重複エッジなし) | `UNIQUE (from_task_id, to_task_id)` ✓ |
| INV-8補足(順序の一意性) | **制約を課さない**(§3参照)→ ドメイン層 + 起動時検証 |
| INV-5(自己ループなし) | `CHECK (from_task_id <> to_task_id)` ✓ |
| INV-6(childは1つの親に属す) | `parent_id NOT NULL` + 外部キー ✓ |
| INV-7(childは子を持たない) | テーブルが存在しないことで構造的に保証 ✓ |
| INV-8(配列と親参照の一致) | **DBには冗長性が存在しない**ため自動的に成立 ✓ |

INV-8について: ドメインでは `Task.childTaskIds`(配列)と `ChildTask.parentId` の2箇所に同じ関係が現れるが、DBでは `parent_id` + `order_index` の1箇所のみで表現される。**DBの方が表現に冗長性がない**ため、この不変条件は永続化層では意識する必要がない。

INV-3のみDB側で守れない。これは要件で認識済みであり(FR-7の注記)、ドメイン層が唯一の防波堤となる。**AIが直接SQLで書き込めば循環を作れてしまう**が、FR-7.5により書き込み経路をドメインに限定しているため実害はない。

**ただし破損したDBファイルという侵入経路が残る。** そのため `load()` で以下の2つを検証する。
検知した場合は「起こってはならない状態」として例外を投げ、読み込みを拒否する。

- `order_index` が各親の中で 0..n-1 の連番になっていること(UNIQUE制約を外した代償)
- 依存グラフに循環がないこと(INV-3。SQLの制約では表現できないため)

### `app_settings` はタスクグラフの外にある

「完了済みを非表示にする」トグル(FR-6)などの表示設定は、`TaskGraph` に含めない。理由:

- タスクグラフのデータではなく、見る側の都合であるため。
- **Undo/Redoの対象外**(FR-6)。グラフの差分計算(§3)にも含まれない。
- AIが関心を持つ必要がない。AIは常に全データを参照できる(表示設定は描画にのみ影響する)。

これにより、ドメイン層は表示設定の存在を一切知らなくてよい。

### 導出値は保存しない

`readiness`(軸a)のカラムは存在しない。コーディング規約4項の通り、常に導出する。**Project への所属も同様で、`tasks` にも `child_tasks` にも `project_id` を持たない** —— 矩形への含有から導出する(FR-4)。

## 2. 導出値のビュー

導出値(Ready/Blocked)を保存しない方針のもとで、参照を容易にするためのビューを定義する。

**当初はAIが直接SELECTするための仕組みとして設計したが、FR-7.5の改訂により、AIの正式な参照経路はアプリケーション層のツール(`get_ready_tasks` 等。Phase 4 で実装予定)となった。** したがってこれらのビューの第一の利用者は**アプリケーション層自身**である。AIによる直接SELECTは開発・デバッグ時の用途として残る。

ビューを設ける価値は変わらない。導出ロジックをSQL側にも持つことで、ツール実装が単純なSELECT 1文で済む。

```sql
-- 軸a(Ready/Blocked)の導出。ドメイン設計 3.3 と同一のロジック
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

-- Project への所属の導出(FR-4)。domain/project.ts の projectOfTask と同じ意味。
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

-- よく使う複合ビュー
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
```

これにより、「今着手できるもの」は1文で引ける。

```sql
-- 「今すぐ着手できるタスクは？」
SELECT * FROM task_overview WHERE readiness = 'ready' AND progress <> 'done';
```

**ビューは導出ロジックの二重実装になる**点に注意する。`task_readiness` のCASE式は、ドメイン層の `readiness()` 関数と同じ意味を持たなければならない。片方だけ変更すると齟齬が生じる。

対策として、**ドメイン層のテストと同じケースを、ビューに対しても実行する**(SQLでの結果とドメイン関数の結果が一致することを検証する)。これはPhase 2の結合テストに含める。

## 3. 書き込み戦略

### 採用: 差分適用方式

ドメイン層は操作のたびに新しい `TaskGraph` を生成する(Undoがスナップショット方式であるため)。永続化層は**変更前後のグラフを比較し、差分に対応するSQLのみを実行する**。

```ts
type EntityDiff<T> = { inserted: T[]; updated: T[]; deleted: string[] };

type GraphDiff = {
  projects:   EntityDiff<Project>;
  tasks:      EntityDiff<Task>;
  childTasks: EntityDiff<ChildTask>;
  edges:      EntityDiff<DependencyEdge>;
};

computeDiff(before: TaskGraph, after: TaskGraph): GraphDiff
applyDiff(db, diff): void   // 1トランザクション内で実行
```

**この方式を選んだ理由:**

1. **コードパスが1本で済む。** 通常の操作もUndo/Redoも「グラフAからグラフBへ移行する」という同一の処理になる。操作ごとに個別のSQLを書く方式では、Undo(スナップショット復元)のために別系統の書き込み処理が必要になってしまう。
2. **書き込み量が最小になる。** 1つのTaskのタイトルを変えただけなら、UPDATE 1文で済む。
3. **削除+再接続のような複合操作を、SQLレベルで組み立てる必要がない。** ドメインが計算した結果の差分を取るだけで、必要なDELETE/INSERTが自動的に導かれる。

比較検討した「グラフ全体を毎回DELETE + INSERTする方式」は、コードパスが1本になる利点は同じだが、1操作ごとに全行を書き込むためWALの肥大化とI/Oの無駄が大きく、採用しない。

### 適用順序

外部キー制約(`PRAGMA foreign_keys = ON`)を満たすため、以下の順で実行する。

```
BEGIN;
  -- 削除は子側から
  DELETE dependency_edges → child_tasks → tasks → projects
  -- 挿入は親側から
  INSERT projects → tasks → child_tasks → dependency_edges
  -- 更新は順序を問わない
  UPDATE ...
COMMIT;
```

### 注意: childTask並べ替え時のUNIQUE制約衝突

`child_tasks` に `UNIQUE (parent_id, order_index)` を課すと、並べ替えを個別UPDATEで行った際に一時的な重複が発生する(1番目と2番目を入れ替える途中で、両方が `order_index = 1` になる瞬間がある)。SQLiteのUNIQUE制約は遅延評価(DEFERRABLE)できないため、この回避には追加の仕組みが要る。

**対応: `UNIQUE (parent_id, order_index)` を課さず、通常のインデックスに変更する。**

```sql
-- UNIQUE (parent_id, order_index) は課さない
CREATE INDEX idx_child_parent_order ON child_tasks(parent_id, order_index);
```

- 順序の一意性はドメイン層が保証する(`Task.childTaskIds` が配列である以上、重複は構造的に発生しない)。
- FR-7.5により書き込み経路はドメインに限定されているため、DB制約を外しても実害は生じない。
- 代わりに、**起動時のロード処理で整合性を検証する**(同一親の中に `order_index` の重複や欠番がないか)。異常を検知した場合は例外を投げる(コーディング規約5項)。

並べ替え時は、対象Taskの全childTaskの `order_index` を振り直す単純な実装とする(1Taskあたり数個〜十数個であり、コストは無視できる)。

## 4. ID生成

`crypto.randomUUID()` によるUUID v4 を採用する(Node.js標準、追加依存なし)。

- 連番を採用しない理由: 全体書き換え方式ではINSERT順が変わりうるため、連番の連続性に意味を持たせられない。またAIが新規Taskを作る際、事前にIDを決められる方が扱いやすい。
- ドメイン層のbranded type(`TaskId` 等)は、生成時にキャストする。生成箇所を1箇所に集約する。

## 5. DBファイルの配置

Electronの `app.getPath('userData')` 配下に置く。

```
~/Library/Application Support/taskdag/taskdag.db   (macOS)
```

開発・デバッグ時に直接 SELECT する場合にこのパスが要る。アプリ内から現在のDBパスを確認できる導線(設定画面への表示など)を用意する。UI設計時の考慮事項として引き継ぐ。

## 6. マイグレーション

`PRAGMA user_version` によるバージョン管理を採用する。追加のライブラリを導入しない。

**上に載せたスキーマは現行(user_version = 5)のもの。** 以下は、そこへ至るまでの変更。

```
user_version = 1  : 初期スキーマ
user_version = 2  : Project を「タグ」から「領域」へ(FR-4)
                    - projects に position_x / position_y / width / height を追加
                    - tasks.project_id を削除(所属は導出値になったため)
                    - task_project ビューを追加(所属の導出)
user_version = 3  : projects.color_index を追加(FR-4)
user_version = 4  : tasks.memo を追加(FR-10)
user_version = 5  : child_tasks.memo を追加(FR-10)
```

**v2 の適用順序には制約がある。** SQLite は列を落とす際に既存ビューを検証するため、
その列を参照しているビューを先に落とす必要がある。また索引のある列は落とせないので、
インデックスも先に外す。順序は「ビュー → インデックス → 列」。

起動時に `user_version` を読み、必要なマイグレーションを順に適用する。

**`user_version` がアプリの想定より新しい場合は、開かずに落とす。** 新しい版が書いたDBを古い版で
黙って開くと、知らない列や制約を無視したまま書き込んでデータを壊すため。Phase 2で緩やかな依存エッジを追加する際は `ALTER TABLE dependency_edges ADD COLUMN kind TEXT NOT NULL DEFAULT 'strict'` となる見込み(ドメイン設計 1項の判断に対応)。

## 7. WALモードとAIの同時アクセス

`journal_mode = WAL` を設定する。アプリが書き込み中でも、AIが別プロセスからSELECTを実行できるようにするため。

- WALでは書き込み1つと読み取り複数が同時に可能。今回の用途(アプリが書き、AIが読む)に合致する。
- 全体書き換えはトランザクション内で行われるため、AIが中間状態(全テーブルが空の瞬間)を読むことはない。

## 8. 未決定・次工程へ

- アプリ未起動時にAIがDBを読む場合の扱い。読み取り専用であれば問題ないが、**アプリ起動中にAIが読んだ内容が古くなる**可能性はある(アプリ側の書き込み後)。AIが都度SELECTする運用であれば実害は小さいと考えられる。
- MCPサーバーの起動形態(`design/tech-stack.md` の未決定事項)と関連: アプリ未起動時に書き込みを受け付ける必要があるか。必要ならMCPサーバーを独立プロセス化する検討が要る。
- エクスポート(FR-9)の実装方法。要件としては確定しているが、DBファイルをコピーする導線をどこに置くかは未定。
