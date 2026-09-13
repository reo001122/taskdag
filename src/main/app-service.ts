import type { DatabaseSync } from 'node:sqlite';
import { computeDiff, isEmptyDiff } from './db/diff';
import { applyDiff, load } from './db/repository';
import type { TaskGraph } from './domain/model';
import { TaskGraphStore } from './domain/store';
import { uuidIds } from './uuid-ids';

/**
 * ドメイン層と永続化層の配線(design/coding-standards.md §1 の補足)
 *
 * ドメイン層は外部依存を持たないため、自分から DB を呼べない。
 * かわりにこの層が「操作を実行し、生じた差分を書き出す」ことを担う。
 *
 * IPC(UI)と MCP(AI)はどちらもこの層を経由する。ここを通らない書き込み経路を
 * 作ってはならない — FR-7.5 が要求する再接続ルール・循環防止・Undo への記録が、
 * すべてこの経路の内側にあるため。
 */

/** 永続化に失敗し、メモリ上の状態を DB に合わせて巻き戻したことを表す。 */
export class PersistenceError extends Error {
  constructor(
    message: string,
    readonly recovered: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PersistenceError';
  }
}

export class AppService {
  readonly #db: DatabaseSync;
  readonly #store: TaskGraphStore;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#store = new TaskGraphStore(load(db), uuidIds);
  }

  get graph(): TaskGraph {
    return this.#store.graph;
  }

  /** 参照のみの問い合わせ。永続化は行わない。 */
  query<T>(fn: (store: TaskGraphStore) => T): T {
    return fn(this.#store);
  }

  /**
   * 状態を変える操作を実行し、生じた差分を DB に書き出す。
   *
   * undo / redo も含めてすべてここを通る。どの操作も「グラフAからグラフBへ」
   * という同じ形に落ちるため、書き込み経路は1本で済む。
   *
   * 永続化に失敗した場合はメモリ上の状態を DB に合わせて巻き戻す。
   * 巻き戻さないと、DB に届かなかった変更がメモリ上に残り、それが次回以降の
   * 差分計算の基準になってしまう。その結果、失敗した変更は二度と再試行されず、
   * 再起動時に無言で消える。DB を唯一の正とすることでこれを防ぐ。
   */
  mutate<T>(fn: (store: TaskGraphStore) => T): T {
    const before = this.#store.graph;
    const result = fn(this.#store);

    const diff = computeDiff(before, this.#store.graph);
    if (isEmptyDiff(diff)) return result;

    try {
      applyDiff(this.#db, diff);
    } catch (cause) {
      this.#recoverFromPersistenceFailure(cause);
    }

    return result;
  }

  /**
   * DB を読み直してメモリ上の状態を合わせる。
   *
   * Undo 履歴は破棄する。DB に存在しない状態へ Undo できてしまうため。
   * 読み直しにも失敗した場合は、整合性を回復する手段がないので落とす
   * (design/coding-standards.md §5: 起こってはならない状態は握りつぶさない)。
   */
  #recoverFromPersistenceFailure(cause: unknown): never {
    try {
      this.#store.resetTo(load(this.#db));
    } catch (reloadFailure) {
      throw new PersistenceError(
        `failed to persist changes, and could not reload the database to recover; in-memory state and database have diverged: ${String(reloadFailure)}`,
        false,
        { cause },
      );
    }

    throw new PersistenceError(
      `failed to persist changes; in-memory state was rolled back to match the database: ${String(cause)}`,
      true,
      { cause },
    );
  }
}
