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
