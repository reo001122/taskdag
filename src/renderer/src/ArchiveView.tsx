import type { ArchivedTaskSnapshot, Progress } from '../../shared/ipc';

/**
 * アーカイブの一覧(FR-11)
 *
 * キャンバスの代わりに出す、読むだけの画面。編集・削除・戻す操作は持たない。
 * アーカイブした日時の新しい順に並べる。
 */

const PROGRESS_LABEL: Record<Progress, string> = {
  not_done: '未着手',
  in_progress: '着手中',
  done: '完了',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 新しい順。同時刻(まとめてアーカイブ)は id で決着をつけ、並びを安定させる。 */
export function sortNewestFirst(items: readonly ArchivedTaskSnapshot[]): ArchivedTaskSnapshot[] {
  return [...items].sort((a, b) => b.archivedAt - a.archivedAt || a.id.localeCompare(b.id));
}

export function ArchiveView({
  archived,
}: {
  archived: readonly ArchivedTaskSnapshot[];
}): React.JSX.Element {
  const items = sortNewestFirst(archived);

  return (
    <div className="archive-view">
      <div className="archive-inner">
        <h2 className="archive-heading">アーカイブ</h2>
        {items.length === 0 ? (
          <p className="archive-empty">アーカイブした Task はありません。</p>
        ) : (
          <ul className="archive-list">
            {items.map((item) => (
              <li key={item.id} className="archive-item">
                <div className="archive-item-head">
                  <span className="archive-title">{item.title}</span>
                  {item.projectName !== null && (
                    <span className="archive-project">{item.projectName}</span>
                  )}
                  <span className="archive-date">{formatDate(item.archivedAt)}</span>
                </div>
                {item.memo !== '' && <p className="archive-memo">{item.memo}</p>}
                {item.childTasks.length > 0 && (
                  <ul className="archive-children">
                    {item.childTasks.map((child, index) => (
                      // 写しで id を持たない。並びが表示順で、並べ替えは起きないので index で足りる。
                      // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の固定の列
                      <li key={index}>
                        <span className={`archive-progress is-${child.progress}`}>
                          {PROGRESS_LABEL[child.progress]}
                        </span>
                        <span className="archive-child-title">{child.title}</span>
                        {child.memo !== '' && <span className="archive-memo">{child.memo}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
