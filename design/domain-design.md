# ドメイン設計 v1

ステータス: 初稿。`vision/requirements.md` のv1(MVP)スコープを対象とする。永続化(SQLite)・UI・MCPは扱わず、**Electron非依存の純粋なTypeScript層**として設計する(`design/development-process.md` Phase 1)。

## 設計の前提

- このレイヤーは、UI経由の操作とAI(MCP)経由の操作の**唯一の合流点**である(FR-7.5)。ここに書かれていないルールは、どちらの経路からも守られない。
- 外部依存を持たない。SQLite・Electron・Reactを参照しない。グラフ全体をメモリ上のデータとして受け取り、結果を返す。
- 規模の前提は数十〜百Task(NFR-1)。アルゴリズムの計算量は実用上ボトルネックにならないため、**単純さを優先する**。

## 1. ドメインモデル

```ts
type TaskId      = string & { readonly __brand: 'TaskId' };
type ChildTaskId = string & { readonly __brand: 'ChildTaskId' };
type ProjectId   = string & { readonly __brand: 'ProjectId' };
type EdgeId      = string & { readonly __brand: 'EdgeId' };

/** 軸b: 本人が申告する状態(FR-5) */
type Progress = 'not_done' | 'in_progress' | 'done';

/** 軸a: 依存グラフから導出される状態(FR-5)。永続化しない */
type Readiness = 'ready' | 'blocked';

type Position = { x: number; y: number };

type Task = {
  id: TaskId;
  title: string;
  progress: Progress;
  projectId: ProjectId | null;   // 0 or 1(FR-4)
  position: Position;            // 手動配置(FR-6)
  collapsed: boolean;            // 折りたたみ状態(FR-6)
  childTaskIds: ChildTaskId[];   // 配列の順序が childTask の表示順(FR-2)
};

type ChildTask = {
  id: ChildTaskId;
  parentId: TaskId;
  title: string;
  progress: Progress;
  // projectId を持たない  → 親から導出(FR-4)
  // position を持たない   → 親ノード内に描画される
  // readiness を持たない  → v1では軸aを持たない(FR-5)
};

type DependencyEdge = {
  id: EdgeId;
  from: TaskId;  // 先行(こちらがDoneになると to が解放される)
  to: TaskId;    // 後続
};

type Project = {
  id: ProjectId;
  name: string;
};

type TaskGraph = {
  tasks: ReadonlyMap<TaskId, Task>;
  childTasks: ReadonlyMap<ChildTaskId, ChildTask>;
  edges: ReadonlyMap<EdgeId, DependencyEdge>;
  projects: ReadonlyMap<ProjectId, Project>;
};
```

### 設計判断: `DependencyEdge` に `kind` を持たせない

v1は厳密(strict)な依存のみ(要件・用語)。Phase 2で緩やか(loose)が追加されることは既知だが、**v1では持たせない**。

- 理由: 常に同じ値しか取らないフィールドは、読み手に「他の値があるのでは」と誤読させる。
- 拡張時の影響範囲を最小化するため、**緩やかな依存が影響しうる唯一の箇所であるReadiness導出を、単一の関数に閉じ込める**(後述)。Phase 2ではその関数と、エッジのフィルタ条件だけを変更すればよい。
- SQLiteの `ALTER TABLE ADD COLUMN` はデフォルト値付きで容易であり、後付けのコストは低い。

## 2. 不変条件(Invariants)

ドメイン層が常に保証する。破れた場合は例外を投げる(コーディング規約 5項)。

| # | 不変条件 | 根拠 |
|---|---|---|
| INV-1 | 依存エッジの `from` / `to` は、いずれも存在するTaskを指す | FR-3 |
| INV-2 | 依存エッジは childTask を指さない | FR-3(childTaskは依存グラフに参加しない) |
| INV-3 | 依存グラフに循環が存在しない | FR-3 |
| INV-4 | 同一の `(from, to)` を持つエッジは高々1本 | FR-3(重複エッジの禁止) |
| INV-5 | `from === to` のエッジは存在しない | INV-3の特殊ケース |
| INV-6 | childTask は必ず1つの親Taskに属する | FR-2 |
| INV-7 | childTask は childTask を持たない | FR-2(深さ1の上限) |
| INV-8 | `Task.childTaskIds` は、その親を指す childTask の集合と過不足なく一致する | FR-2(順序と実体の整合) |

INV-7は**型で表現されている**(`ChildTask` に子を持つフィールドがない)ため、実行時チェックを必要としない。型で防げるものは型で防ぐ。

INV-8は「順序を持つ配列」と「親への参照」という2つの表現が同じ関係を指すことによる冗長性から生じる。childTaskの追加・削除・並べ替えの全てで両者を同時に更新する必要がある。

## 3. 主要ロジック

### 3.1 循環検知(FR-3)

エッジ `A → B` を追加してよいかの判定:

```
canConnect(graph, A, B):
  A === B            → 不可(INV-5)
  既に A→B が存在     → 不可(INV-4)
  B から A へ到達可能  → 不可(循環になるため)
  それ以外            → 可
```

「BからAへ到達可能か」は、Bを起点に有向エッジを辿る深さ優先探索で判定する。到達可能であれば `A→B` の追加は `A→B→…→A` の循環を作る。

React Flow の `isValidConnection` から呼び出せるよう、**副作用のない純粋な判定関数として独立させる**(接続を確定する前に呼ばれるため)。

### 3.2 Task削除と依存エッジの再接続(FR-3)

削除対象Task `T` について:

- `P` = `T` を指すエッジの `from` の集合(先行Task群)
- `S` = `T` から出るエッジの `to` の集合(後続Task群)

| 条件 | 挙動 |
|---|---|
| `|P| = 1` かつ `|S| = 1` | `P[0] → S[0]` を再接続 |
| `|P| > 1` かつ `|S| = 1` | 各 `p ∈ P` について `p → S[0]` を再接続 |
| `|P| = 1` かつ `|S| > 1` | 各 `s ∈ S` について `P[0] → s` を再接続 |
| `|P| > 1` かつ `|S| > 1` | 再接続しない |
| `|P| = 0` または `|S| = 0` | 再接続しない(繋ぐ相手が存在しない) |

再接続で作るエッジが既存エッジと重複する場合は、**新規作成せず既存を維持する**(INV-4、冪等)。

削除は以下を1つの不可分な操作として行う:
1. `T` に接続する全エッジを削除
2. 上表に従って再接続
3. `T` の childTask を全て削除(FR-1)
4. `T` を削除

#### 再接続は循環を作らない(証明)

**主張**: 上記の再接続によって循環が生じることはない。したがって削除操作で循環検知を行う必要はない。

**証明**: 再接続で追加されるエッジ `p → s` は、削除前に `p → T → s` という経路が存在していたペアに限られる。すなわち削除前から `p` は `s` へ到達可能であった。よって再接続は**新たな到達可能性を一切増やさない**。削除前のグラフが非循環(INV-3)であり、到達可能性が増えない以上、削除後も非循環である。∎

系として、`p = s` となることもない(`p → T → p` は削除前に循環が存在したことを意味し、INV-3に反するため)。したがってINV-5も保たれる。

**ただしテストでは明示的に検証する。** 証明は前提(INV-3)が守られている限り正しいが、実装のミスは証明では防げない。

**前提が破れた場合の扱い(敵対的レビューを受けて追加)**: この証明は INV-3 が成立していることに依存する。
公開APIからは循環を作れないため通常は問題ないが、**DBファイルが破損・手編集された場合**は循環したまま
読み込めてしまい、そこから削除すると自己ループ等のさらに壊れた状態を生む。
そのため**永続化層の `load()` で循環を検証し、検知したら読み込みを拒否する**(`db/repository.ts`)。
ドメイン層の削除処理自体は、証明どおり循環検知を行わない。

### 3.3 Readiness(Ready/Blocked)の導出(FR-5)

```
readiness(graph, T):
  incoming = T を指す全エッジ
  incoming が空                                → 'ready'
  incoming の全ての from が progress === 'done' → 'ready'
  それ以外                                      → 'blocked'
```

- **永続化しない**(コーディング規約 4項)。常に導出する。
- 入力エッジを持たないTaskは `ready`(FR-5で明示済み)。
- 判定は**直接の先行Taskのみ**を見る。推移的に辿る必要はない。`A→B→C` で `A` が未Doneなら `B` は blocked、`B` が未Doneなら `C` も blocked となり、結果として正しく伝播する。
- **この関数がPhase 2(緩やかな依存)で変更される唯一の箇所**。緩やかなエッジは `incoming` から除外することになる。

#### 意図的な帰結: 「Blocked かつ Done」が起こりうる

軸aと軸bは独立している(FR-5)。したがって `A → B` で `A` が未Doneのまま、ユーザーが `B` を Done にすることは**許可されている**。この場合:

- `B` は「Blocked かつ Done」という状態になる
- `B` の後続 `C` は、`B` が Done であるため **Ready になる**

これは不具合ではなく、2軸独立モデルの正しい帰結である。ユーザーが「先行タスクは終わっていないが、この作業は完了した」と判断した場合を表現できる。UIはこの状態を破綻なく表示できる必要がある。

### 3.4 childTaskの順序(FR-2)

順序は `Task.childTaskIds` の**配列順**として表現する。`ChildTask` 側に順序番号を持たせない。

- 理由: 順序番号を各childTaskが持つと、並べ替えのたびに複数レコードの番号を振り直す必要があり、番号の重複・欠番といった不整合の余地が生まれる。配列は順序を一意に表現でき、不整合が構造的に発生しない。
- 「1番目・2番目」という番号は、配列のインデックスから表示時に導出する。**保持しない**(Readinessと同じく、導出できるものは導出する)。

`reorderChildTask(id, newIndex)` は、対象を配列から取り出し、指定位置に挿入し直す。

**永続化時の注意**: SQLiteには配列型がないため、`child_tasks` テーブルに `order_index` カラムを持たせて表現することになる(永続化設計で扱う)。その際、**DBの表現とドメインの表現が異なる**点に注意する。ドメイン層は常に配列を正とし、DBとの変換は永続化層の責務とする。この規模(1Taskあたり数個〜十数個のchildTask)では、並べ替え時に該当Taskの全childTaskの `order_index` を振り直す単純な実装で十分。

### 3.5 Project への所属の導出(FR-4)

**Project はキャンバス上の領域であり、タグではない**(Phase 3 で訂正)。
所属は Task が矩形に含まれているかで決まり、**保存しない**。

```
projectOfTask(graph, T):
  T の左上の点を含む Project のうち、面積が最小のもの
  同面積なら id の小さいもの
  含むものがなければ null
```

- **判定は Task の左上の点で行う。** 中心点のほうが直感には近いが、それには描画サイズが
  必要で、サイズは表示側の都合であってドメインが知るべきものではない。
- **面積の小さいほうを選ぶ**のは、大きな枠の中に小さな枠を置いたとき、より限定的なほうが
  意図に近いため。同面積での決着を id 順にしているのは、SQL 側のビューと同じ順序に
  しないと同じ問い合わせで違う答えが出るため。
- childTask は親の位置から導出される。親を動かせば子の所属も自動的に追従する。

`moveProject` は枠と中身を一緒に動かす。中身を置き去りにすると枠から外れて所属が消えるため。
`resizeProject` は枠だけを変える —— 広げれば取り込み、狭めれば外れる。

## 4. Undo / Redo(FR-8)

### 方式: スナップショット方式を採用する

2つの選択肢を比較した。

| | コマンドパターン(逆操作を保持) | **スナップショット方式** |
|---|---|---|
| 実装の複雑さ | 操作ごとに正しい逆操作を実装する必要がある。削除+再接続の逆操作は特に複雑 | グラフ全体をコピーして積むだけ |
| 正しさ | 逆操作の実装ミスが状態を壊す。全操作分の検証が必要 | 構造的に間違えようがない |
| メモリ | 小さい | グラフ全体 × 履歴数 |

**スナップショット方式を採用する。** 規模の前提(数十〜百Task)ではグラフ全体が数百KB程度に収まり、履歴50件でも実用上問題にならない。削除+再接続という複雑な操作の逆操作を正しく書くリスクを負う理由がない。

```
UndoStack = {
  past:   TaskGraph[];   // 直近が末尾
  present: TaskGraph;
  future: TaskGraph[];   // Redo用
}
```

操作実行時: `past.push(present)` → `present = 新しいグラフ` → `future = []`(新しい操作でRedo履歴は破棄)

### 決定事項(要件の「要決定」への回答)

- **深さ**: 50。それを超えたら古いものから破棄する。
- **セッション跨ぎ**: **v1では対応しない**(アプリ再起動でUndo履歴は消える)。FR-8の主目的は「AIの予想外の操作からの復旧」であり、これはセッション内で発生する。永続化は複雑さに見合わない。
- **1操作の粒度**: **ドメインAPIの1回の呼び出し = Undo 1回分**。
  - ただし、複数の変更を1単位にまとめる `batch()` を提供する。AIが「5つのTaskをまとめて削除」を1回のMCP呼び出しで行った場合、Undo 1回で全て戻せるようにするため。
  - AIが5回に分けて呼んだ場合は、Undoも5回必要になる。これは操作の実態に即しており、妥当と判断する。

### 注意: ドラッグ操作をUndo履歴に積まない

ノードのドラッグ中は座標変更が高頻度で発生する。これを毎回スナップショットすると、履歴がドラッグの中間状態で埋まりUndoが機能しなくなる。

**ドラッグ確定時(マウスを離した時)にのみ1回スナップショットを取る。** 中間状態はドメインに渡さず、renderer側で保持する。これは「rendererにロジックを書かない」規約の例外ではなく、**確定していない一時的な表示状態はrendererが持ってよい**という整理による。

整列操作(FR-6)は1回の確定操作なので、通常通り1回分の履歴として積む。

## 5. ドメインAPI

全ての書き込み操作はここを通る(FR-7.5)。

### コマンド(状態を変える)

失敗しうる操作は `Result` を返す(コーディング規約 5項)。

```ts
type DomainError =
  | { type: 'task_not_found'; id: TaskId }
  | { type: 'child_task_not_found'; id: ChildTaskId }
  | { type: 'edge_not_found'; id: EdgeId }
  | { type: 'would_create_cycle'; from: TaskId; to: TaskId }
  | { type: 'edge_already_exists'; from: TaskId; to: TaskId }
  | { type: 'self_loop'; id: TaskId }
  | { type: 'project_not_found'; id: ProjectId }
  | { type: 'index_out_of_range'; index: number; length: number };
```

| 操作 | 失敗しうるか |
|---|---|
| `createTask(title, position, projectId?)` | projectId が存在しない場合 |
| `updateTaskTitle(id, title)` | Task不在 |
| `deleteTask(id)` | Task不在 |
| `setTaskProgress(id, progress)` | Task不在 |
| `moveTask(id, position)` | Task不在 |
| `setTaskCollapsed(id, collapsed)` | Task不在 |
| `setTaskProject(id, projectId \| null)` | Task不在 / Project不在 |
| `createChildTask(parentId, title)` | 親Task不在(末尾に追加する) |
| `updateChildTaskTitle(id, title)` | childTask不在 |
| `deleteChildTask(id)` | childTask不在 |
| `setChildTaskProgress(id, progress)` | childTask不在 |
| `reorderChildTask(id, newIndex)` | childTask不在 / インデックスが範囲外 |
| `connect(from, to)` | 循環 / 重複 / 自己ループ / Task不在 |
| `disconnect(edgeId)` | エッジ不在 |
| `applyLayout(positions)` | 含まれるTaskが不在 |
| `batch(fn)` | 内部の操作に従う |
| `undo()` / `redo()` | 履歴がない場合は何もしない(エラーではない) |

### クエリ(状態を変えない)

```ts
getGraph(): TaskGraph
getReadiness(taskId): Readiness
getAllReadiness(): ReadonlyMap<TaskId, Readiness>
canConnect(from, to): boolean       // UIの接続可否判定用(3.1)
projectOf(childTaskId): ProjectId | null
```

`canConnect` は React Flow の `isValidConnection` から同期的に呼ばれるため、**必ず副作用を持たない**こと。

## 6. テスト観点(TDDで先に書くもの)

`design/development-process.md` の方針に従い、以下は実装前にテストを書く。

**循環検知(FR-3)**
- 自己ループを拒否する
- 既存エッジと重複する接続を拒否する
- 直接の逆方向(`B→A` がある時の `A→B`)を拒否する
- 間接的な循環(`A→B→C` がある時の `C→A`)を拒否する
- 循環にならない接続は許可する

**削除と再接続(FR-3)**
- 入力1・出力1 → 再接続する
- 入力複数・出力1 → 全て再接続する
- 入力1・出力複数 → 全て再接続する
- 入力複数・出力複数 → 再接続しない
- 入力なし / 出力なし → 再接続しない
- 再接続先が既存エッジと重複する場合、重複を作らない
- **再接続後も循環が存在しない**(3.2の証明の検証)
- childTaskも同時に削除される(FR-1)

**Readiness導出(FR-5)**
- 入力エッジなし → ready
- 全先行がDone → ready
- 1つでも not_done → blocked
- 1つでも in_progress → blocked(Doneのみが解放条件)
- 「Blocked かつ Done」のTaskの後続が ready になる(3.3の意図的な帰結)

**childTaskの順序(FR-2)**
- 追加したchildTaskが末尾に入る
- 並べ替えが配列順に反映される(先頭へ / 末尾へ / 中間へ)
- 範囲外のインデックスを拒否する
- childTask削除後も残りの順序が保たれる
- 並べ替え後もINV-8(配列と親参照の一致)が保たれる

**Undo/Redo(FR-8)**
- 削除+再接続が1回のUndoで完全に戻る
- `batch()` でまとめた複数操作が1回のUndoで戻る
- Undo後に新しい操作を行うとRedo履歴が破棄される
- 深さ50を超えると古い履歴が破棄される

**不変条件**
- 各操作の後にINV-1〜INV-6が保たれる(プロパティベーステストの候補)

## 7. 未決定・次工程へ

- Task / childTask / Project のIDの生成方式(UUID / 連番)。永続化設計で決める。
- `applyLayout` に渡す座標を計算するレイアウトアルゴリズム(ELK)の呼び出し位置。ドメイン外(renderer側)で計算し、結果の座標だけをドメインに渡す想定。**レイアウト計算はドメインロジックではない**(正しさの問題ではなく見た目の問題であるため)。
(なし)

## 8. childTaskの順序と、緩やかな依存エッジは別概念である

**childTaskの順序は、意味論的に中立である。** ユーザーによって「単なる並び」を意味することも、「この順にやる」を意味することもあり、**同じ表現の中に両方が混在する**。これは設計の欠陥ではなく、意図された性質である。

**この曖昧さを、Phase 2で導入する緩やかな依存エッジ(H1)と統合してはならない。** 両者は別の概念である。

| | childTaskの順序 | 緩やかな依存エッジ(Phase 2) |
|---|---|---|
| 対象 | 1つのTask内のchildTask間 | トップレベルのTask間 |
| 意味 | 中立(ユーザーの解釈に委ねる) | 明示的に「順序関係がある」と宣言したもの |
| 表現 | 配列の順序(暗黙) | エッジ(明示) |

ブレスト時の整理として、トップレベルのTask間の関係については「意味がユーザーの頭の中にあるのは良くない(記憶のリソースを使わせない)」という方針が確認されている。一方、1つのTask内のチェックリストの並びについては、その厳密さを求めない。**スコープが違えば要求される明示性も違う**、という整理である。

したがって実装上も、childTaskの順序から依存関係を導出したり、緩やかな依存エッジをchildTaskの順序で代替したりしてはならない。
