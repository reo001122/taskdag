import { useEffect, useRef, useState } from 'react';
import type { ArchivePlan, DeletePlan, GraphSnapshot } from '../../shared/ipc';

/**
 * 文字列を1つ受け取るダイアログ。
 *
 * Electron は window.prompt を実装していないため、自前で用意する必要がある。
 * native <dialog> を使うのは、Escape での閉じ・フォーカストラップ・背景の
 * 不活性化が標準で得られるため。
 */
export function TextPromptDialog({
  title,
  placeholder,
  onCancel,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    ref.current?.showModal();
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div>
        <h2>{title}</h2>
        <input
          className="text-input wide"
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 変換確定の Enter を送信と取り違えない
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" onClick={submit}>
            作成
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * 削除確認(FR-1)
 *
 * 再接続ルールは条件によって挙動が変わり、特に入力・出力とも複数の場合は
 * 再接続されない。何が失われるかを見せてから確定させる。
 */
export function DeleteDialog({
  plan,
  snapshot,
  onCancel,
  onConfirm,
}: {
  plan: DeletePlan;
  snapshot: GraphSnapshot;
  onCancel: () => void;
  onConfirm: (keepReconnections: { from: string; to: string }[]) => void;
}): React.JSX.Element {
  const titleOf = (id: string): string => snapshot.tasks.find((t) => t.id === id)?.title ?? id;
  const target = titleOf(plan.taskId);
  const ref = useRef<HTMLDialogElement>(null);

  /*
    繋ぎ直しは、外したいものを外せるようにする(FR-1)。

    FR-3 の規則は「繋がっていた相手どうしを繋ぐ」であって、**それがいつも
    利用者の意図と一致するとは限らない。** 既定は全て繋ぐ —— 規則どおりの
    結果を、確認の場で削るだけにする。
  */
  const key = (edge: { from: string; to: string }): string => `${edge.from}->${edge.to}`;
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (edge: { from: string; to: string }): void =>
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(key(edge))) next.delete(key(edge));
      else next.add(key(edge));
      return next;
    });

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div>
        <h2>
          「<span className="doomed">{target}</span>」を削除しますか？
        </h2>

        {plan.removedChildTaskIds.length > 0 && (
          <p className="dialog-lead">
            子タスク {plan.removedChildTaskIds.length} 件も一緒に削除されます。
          </p>
        )}

        {/*
          なくなるものと、代わりにできるものを、色で見分けられるようにする。
          再接続の規則は条件で変わる(FR-3)ので、読み比べる場面が必ず来る。
        */}
        {plan.removedEdges.length > 0 && (
          <section className="dialog-section">
            <h3 className="dialog-label">なくなる依存関係</h3>
            <ul className="edge-list is-removed">
              {plan.removedEdges.map((e) => (
                <li key={`${e.from}->${e.to}`}>
                  {/* 消える当人を赤くする。どちら側が居なくなるのかが一目で分かる。 */}
                  <span className={e.from === plan.taskId ? 'doomed' : undefined}>
                    {titleOf(e.from)}
                  </span>
                  <span className="arrow">→</span>
                  <span className={e.to === plan.taskId ? 'doomed' : undefined}>
                    {titleOf(e.to)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.addedEdges.length > 0 ? (
          <section className="dialog-section">
            <h3 className="dialog-label">つなぎ直される依存関係</h3>
            <ul className="edge-list is-added">
              {plan.addedEdges.map((e) => (
                <li key={key(e)} className={dropped.has(key(e)) ? 'is-dropped' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      className="edge-check"
                      checked={!dropped.has(key(e))}
                      onChange={() => toggle(e)}
                    />
                    <span className="edge-box" aria-hidden="true" />
                    <span>{titleOf(e.from)}</span>
                    <span className="arrow">→</span>
                    <span>{titleOf(e.to)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="dialog-hint">外したものは繋ぎ直されません。</p>
          </section>
        ) : (
          plan.removedEdges.length > 0 && (
            <p className="dialog-warning">つなぎ直しは行われません。上の依存関係は失われます。</p>
          )
        )}

        <div className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onConfirm(plan.addedEdges.filter((e) => !dropped.has(key(e))))}
          >
            削除
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * アーカイブの確認(FR-11)
 *
 * 削除の確認(DeleteDialog)と見せ方を揃えている。依存の扱いが削除と同じ(FR-3)で、
 * 何がなくなり何が繋ぎ直されるかを同じ形で読めるようにするため。
 *
 * 繋ぎ直しは、削除と同じく1本ずつ外せる(FR-11)。まとめて移すときに出る繋ぎ直しは、
 * 全体を順に適用した最終形(planArchive)なので、外した分を除いた「残す集合」を返す。
 */
export function ArchiveDialog({
  plan,
  snapshot,
  bulk,
  onCancel,
  onConfirm,
}: {
  plan: ArchivePlan;
  snapshot: GraphSnapshot;
  /** ツールバーからまとめて移すとき。1件ずつなら対象の名前を見出しに出す。 */
  bulk: boolean;
  onCancel: () => void;
  onConfirm: (keepReconnections: { from: string; to: string }[]) => void;
}): React.JSX.Element {
  const titleOf = (id: string): string => snapshot.tasks.find((t) => t.id === id)?.title ?? id;
  const moving = new Set(plan.taskIds);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const edgeKey = (edge: { from: string; to: string }): string => `${edge.from}->${edge.to}`;
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (edge: { from: string; to: string }): void =>
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(edgeKey(edge))) next.delete(edgeKey(edge));
      else next.add(edgeKey(edge));
      return next;
    });

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div>
        <h2>
          {bulk ? (
            <>完了した {plan.taskIds.length} 件をアーカイブしますか？</>
          ) : (
            <>
              「<span className="doomed">{plan.taskIds[0] ? titleOf(plan.taskIds[0]) : ''}</span>
              」をアーカイブしますか？
            </>
          )}
        </h2>

        <p className="dialog-lead">
          キャンバスから外れ、アーカイブの一覧に残ります。一覧から戻す操作はありません(直後なら
          Cmd+Z で戻せます)。
        </p>
        {plan.childTaskCount > 0 && (
          <p className="dialog-lead">子タスク {plan.childTaskCount} 件も一緒に移ります。</p>
        )}

        {bulk && (
          <section className="dialog-section">
            <h3 className="dialog-label">アーカイブする Task</h3>
            <ul className="edge-list">
              {plan.taskIds.map((id) => (
                <li key={id}>{titleOf(id)}</li>
              ))}
            </ul>
          </section>
        )}

        {plan.removedEdges.length > 0 && (
          <section className="dialog-section">
            <h3 className="dialog-label">なくなる依存関係</h3>
            <ul className="edge-list is-removed">
              {plan.removedEdges.map((e) => (
                <li key={edgeKey(e)}>
                  <span className={moving.has(e.from) ? 'doomed' : undefined}>
                    {titleOf(e.from)}
                  </span>
                  <span className="arrow">→</span>
                  <span className={moving.has(e.to) ? 'doomed' : undefined}>{titleOf(e.to)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.addedEdges.length > 0 ? (
          <section className="dialog-section">
            <h3 className="dialog-label">つなぎ直される依存関係</h3>
            <ul className="edge-list is-added">
              {plan.addedEdges.map((e) => (
                <li key={edgeKey(e)} className={dropped.has(edgeKey(e)) ? 'is-dropped' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      className="edge-check"
                      checked={!dropped.has(edgeKey(e))}
                      onChange={() => toggle(e)}
                    />
                    <span className="edge-box" aria-hidden="true" />
                    <span>{titleOf(e.from)}</span>
                    <span className="arrow">→</span>
                    <span>{titleOf(e.to)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="dialog-hint">外したものは繋ぎ直されません。</p>
          </section>
        ) : (
          plan.removedEdges.length > 0 && (
            <p className="dialog-warning">つなぎ直しは行われません。上の依存関係は失われます。</p>
          )
        )}

        <div className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onConfirm(plan.addedEdges.filter((e) => !dropped.has(edgeKey(e))))}
          >
            アーカイブ
          </button>
        </div>
      </div>
    </dialog>
  );
}
