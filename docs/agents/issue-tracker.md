# Issue の管理先: GitHub

Issue とスペックは GitHub Issues で管理する。操作はすべて `gh` CLI 経由。

## 規約

- **Issue を作る**: `gh issue create --title "..." --body "..."`。複数行の本文はヒアドキュメントで。
- **Issue を読む**: `gh issue view <number> --comments`。コメントは `jq` でフィルタし、ラベルも一緒に取得する。
- **Issue を一覧する**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`。`--label` と `--state` で絞り込む。
- **Issue にコメントする**: `gh issue comment <number> --body "..."`
- **ラベルを付ける・外す**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **閉じる**: `gh issue close <number> --comment "..."`

リポジトリは `git remote -v` から推測される。クローン内で実行すれば `gh` が自動でそれをやる。

## Pull Request はトリアージ対象に含めない

外部からの PR は「機能要望」としてトリアージしない。通常の PR レビューを通す。

GitHub は Issue と PR で番号空間を共有しているため、`#42` のような番号だけではどちらか判別できない。`gh pr view 42` を試し、失敗したら `gh issue view 42` にフォールバックする。

## Skill が「issue tracker に publish する」と言うとき

GitHub issue を作成する。

## Skill が「関連する ticket を取得する」と言うとき

`gh issue view <number> --comments` を実行する。

## Wayfinding での運用

`/wayfinder` が使う。**map** は1つの issue で、**child** issue がチケットになる。

- **Map**: `wayfinder:map` ラベルの単一 issue。Notes / Decisions-so-far / Fog を本文に持つ。`gh issue create --label wayfinder:map`。
- **Child ticket**: map に GitHub の sub-issue としてリンクされた issue(`gh api` の sub-issues エンドポイント)。sub-issue が使えない場合は、map 本文のタスクリストに追加し、child 本文の先頭に `Part of #<map>` と書く。ラベルは `wayfinder:<type>`(`research`/`prototype`/`grilling`/`task`)。claim されたら、実装者にアサインする。
- **ブロッキング**: GitHub の**ネイティブな issue dependencies**を正とする(UI 上でも見える)。`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` でエッジを追加する。`<blocker-db-id>` はブロッカーの数値の**database id**(`gh api repos/<owner>/<repo>/issues/<n> --jq .id`。`#number` や `node_id` ではない)。GitHub は `issue_dependencies_summary.blocked_by`(開いているブロッカーのみ、リアルタイムのゲート)を返す。dependencies が使えない環境では、child 本文先頭の `Blocked by: #<n>, #<n>` にフォールバックする。すべてのブロッカーが閉じたら unblocked。
- **Frontier query**: map の開いている child(`gh issue list --state open`、map の sub-issue / タスクリストに絞る)を一覧し、開いているブロッカーがあるもの(`issue_dependencies_summary.blocked_by > 0`、または `Blocked by` 行に開いている issue がある)や assignee があるものを除く。map の順で最初のものが選ばれる。
- **Claim**: `gh issue edit <n> --add-assignee @me`。そのセッションの最初の書き込み。
- **解決**: `gh issue comment <n> --body "<answer>"` の後 `gh issue close <n>`、そして map の Decisions-so-far にコンテキストへのポインタ(gist + リンク)を追記する。
